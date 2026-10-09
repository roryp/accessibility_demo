// Creates a Copilot SDK session that runs on HydraFusion and executes one task with full cost tracking.
import fs from "node:fs";
import path from "node:path";
import { parseArgs, styleText } from "node:util";
import { CopilotClient, ToolSet, defineTool } from "@github/copilot-sdk";
import { ROOT, REPORTS_DIR, isInside, rel } from "./paths.mjs";
import { runAccessibilityTests, toToolResult } from "./a11y-test.mjs";
import { CostTracker, loadPriceTable, fmtCredits, fmtUsd, toCredits } from "./cost-tracker.mjs";
import { FusionProgressDisplay } from "./fusion-display.mjs";

/** The Copilot runtime rejects session limits (sessionLimits.maxAiCredits) below this many AI credits ($0.30). */
export const MIN_SESSION_LIMIT_CREDITS = 30;

/**
 * Session settings that turn on HydraFusion (research preview) in the Copilot SDK.
 * - model "hydrafusion" is a synthetic model: HydraFusion orchestrates real models behind it.
 * - It is an experimental feature, so experimental mode must be on and the host must resolve the
 *   HYDRAFUSION_ROLLOUT feature flag (the same switch `copilot --experimental` / VS Code flip for you).
 * - HydraFusion does not support context tiers, so pin the default tier (overrides a saved "long_context").
 */
export const HYDRAFUSION_SESSION = {
  model: "hydrafusion",
  enableExperimentalMode: true,
  featureFlags: { HYDRAFUSION_ROLLOUT: true },
  contextTier: "default",
};

// Built-in file tools only (names differ slightly per model family). No shell, web or sub-agents.
const FILE_TOOLS = ["view", "glob", "grep", "rg", "edit", "create", "apply_patch"];

// skipPermission is safe here because the test browser is sandboxed to site/ (see a11y-test.mjs).
export const accessibilityTestTool = defineTool("run_accessibility_tests", {
  description:
    "Runs the website's automated WCAG 2.2 A/AA test suite in a real Chromium browser: axe-core plus custom checks for keyboard " +
    "operability, visible focus, alt-text quality and table headers. Returns JSON with failures (must fix), advisories " +
    "(best practice) and items that need manual review. Re-run it after every round of fixes.",
  parameters: {
    type: "object",
    properties: { file: { type: "string", description: 'Page to test, relative to the site/ folder, e.g. "index.html" (default) or "map.html".' } },
    additionalProperties: false,
  },
  skipPermission: true,
  handler: async ({ file } = {}) => toToolResult(await runAccessibilityTests({ file: file || "index.html" })),
});

/** Permission handler: reads anywhere in the workshop folder, writes only where this run allows (real paths are compared). */
export function createWorkshopGuard({ writableDirs = [] } = {}) {
  const approve = { kind: "approve-once" };
  const reject = (feedback) => {
    console.log(styleText("yellow", `   🛡  Blocked: ${feedback}`));
    return { kind: "reject", feedback };
  };
  const writable = (p) => writableDirs.some((dir) => isInside(p, dir));
  return (request) => {
    switch (request.kind) {
      case "read":
        return isInside(request.resolvedPath ?? request.path, ROOT) ? approve : reject(`reading ${request.path} (outside the workshop folder)`);
      case "write": {
        // Every path the edit touches must be writable (a move has both a before and an after path).
        const targets = [request.fileName, request.resolvedPath, ...(request.fileEdits ?? []).flatMap((e) => [e.before?.path, e.after?.path])].filter(Boolean);
        return targets.length && targets.every(writable)
          ? approve
          : reject(`writing ${request.fileName}. This run may only change: ${writableDirs.map((d) => `${rel(d)}/`).join(", ") || "nothing (read-only)"}`);
      }
      case "custom-tool":
        return approve;
      default:
        return reject(`'${request.kind}' permission is disabled in this workshop`);
    }
  };
}

/** Parses --budget / --soft-budget / --model for the lab scripts. */
export function parseRunArgs({ defaultBudget }) {
  const { values } = parseArgs({
    options: {
      budget: { type: "string", default: String(defaultBudget) },
      "soft-budget": { type: "string" },
      model: { type: "string", default: "hydrafusion" },
    },
  });
  const budget = values.budget === "none" ? undefined : Number(values.budget);
  if (budget !== undefined && !(budget >= MIN_SESSION_LIMIT_CREDITS)) {
    console.error(`--budget must be at least ${MIN_SESSION_LIMIT_CREDITS} AI credits ($0.30), the Copilot runtime minimum, or "none". For smaller limits use --soft-budget.`);
    process.exit(1);
  }
  const softBudget = values["soft-budget"] === undefined ? undefined : Number(values["soft-budget"]);
  if (softBudget !== undefined && !(softBudget > 0)) {
    console.error("--soft-budget must be a positive number of AI credits, e.g. --soft-budget 1");
    process.exit(1);
  }
  return { budget, softBudget, model: values.model };
}

/** Names of the MCP servers in the user's own Copilot config (so a session can switch them off). */
export async function listPersonalMcpServers(client) {
  try {
    return Object.keys((await client.rpc.mcp.config.list()).servers ?? {});
  } catch {
    return [];
  }
}

function waitForIdle(session, ms) {
  return new Promise((resolve) => {
    let off = () => {};
    const timer = setTimeout(() => {
      off();
      resolve(false);
    }, ms);
    off = session.on("session.idle", (event) => {
      if (event.agentId) return; // only the main agent going idle means the turn is over
      clearTimeout(timer);
      off();
      resolve(true);
    });
  });
}

/**
 * Runs one prompt on HydraFusion (or any model, for comparisons) and tracks every credit it spends.
 * Two cost guardrails:
 *  - budgetCredits: hard cap enforced by the Copilot runtime (sessionLimits.maxAiCredits, minimum 30 credits).
 *  - softBudgetCredits: app-side cap of any size; we watch live usage events and abort the session once it is crossed.
 */
export async function runHydraFusionTask({
  run,
  prompt,
  instructions,
  writableDirs = [],
  budgetCredits,
  softBudgetCredits,
  model = "hydrafusion",
  timeoutMinutes = 30,
}) {
  if (budgetCredits && budgetCredits < MIN_SESSION_LIMIT_CREDITS) {
    throw new Error(`The session budget must be at least ${MIN_SESSION_LIMIT_CREDITS} AI credits (the runtime minimum). Use a soft budget for smaller limits.`);
  }

  const client = new CopilotClient({ logLevel: "error" });
  await client.start();
  let session;
  let eventLog;
  try {
    const tracker = new CostTracker({ run, requestedModel: model, prices: await loadPriceTable(client), budgetCredits });
    const display = new FusionProgressDisplay(tracker);
    // Don't start the participant's personal MCP servers: the agent only gets the tools this workshop allows.
    const personalMcpServers = await listPersonalMcpServers(client);
    let budgetExhausted = null;
    let softBudgetStopped = null;
    let forcedStop = false;
    let abortPromise = null;
    // Stop the agent. If the runtime refuses, kill it so that no further credits can be spent.
    const abortRun = () =>
      (abortPromise ??= session.abort().then(
        () => true,
        async (err) => {
          console.log(styleText("red", `   Could not abort the session (${err.message}); force-stopping the Copilot runtime.`));
          forcedStop = true;
          await client.forceStop().catch(() => {});
          return false;
        },
      ));

    // Raw event log for exploration (skips high-volume progress/streaming events).
    const eventsFile = path.join(REPORTS_DIR, "events", `${run}.jsonl`);
    fs.mkdirSync(path.dirname(eventsFile), { recursive: true });
    eventLog = fs.createWriteStream(eventsFile);
    eventLog.on("error", (err) => console.log(styleText("yellow", `   (event log disabled: ${err.message})`)));

    try {
      session = await client.createSession({
        ...(model === "hydrafusion" ? HYDRAFUSION_SESSION : { model, contextTier: "default" }),
        clientName: "hydrafusion-a11y-workshop",
        workingDirectory: ROOT,
        systemMessage: { mode: "append", content: instructions },
        skipCustomInstructions: true,
        tools: [accessibilityTestTool],
        availableTools: new ToolSet().addBuiltIn(FILE_TOOLS).addCustom("*"),
        disabledMcpServers: personalMcpServers,
        enableSkills: false,
        onPermissionRequest: createWorkshopGuard({ writableDirs }),
        ...(budgetCredits ? { sessionLimits: { maxAiCredits: budgetCredits } } : {}),
        onEvent: (event) => {
          if (event.type !== "assistant.fusion_phase_activity" && !event.type.endsWith("_delta")) eventLog.write(`${JSON.stringify(event)}\n`);
          const call = tracker.handle(event);
          display.handle(event, call);
          if (call && softBudgetCredits && !softBudgetStopped && toCredits(tracker.totalNanoAiu) >= softBudgetCredits) {
            softBudgetStopped = { softBudgetCredits, usedCredits: toCredits(tracker.totalNanoAiu) };
            console.log(styleText(["bold", "red"], `\n⛔ Soft budget reached: ${fmtCredits(tracker.totalNanoAiu)} spent (limit ${softBudgetCredits}). Aborting the run.`));
            abortRun();
          }
        },
      });
    } catch (err) {
      if (model === "hydrafusion" && /not available/i.test(err.message)) {
        err.message += " HydraFusion is a research preview: run `npm run models` to check access, and see the Troubleshooting section of the README.";
      }
      throw err;
    }
    tracker.sessionId = session.sessionId;

    // Hard budget: when the session hits maxAiCredits the runtime asks what to do; we stop instead of spending more.
    session.on("session_limits_exhausted.requested", async (event) => {
      budgetExhausted = event.data;
      console.log(styleText(["bold", "red"], `\n⛔ Budget reached: ${event.data.usedAiCredits} of ${event.data.maxAiCredits} AI credits used. Stopping this run.`));
      try {
        await session.rpc.ui.handlePendingSessionLimitsExhausted({ requestId: event.data.requestId, response: { action: "cancel" } });
      } catch (err) {
        console.log(styleText("red", `   Could not answer the budget prompt (${err.message}); aborting instead.`));
        abortRun();
      }
    });

    console.log(
      styleText(
        "dim",
        `Session ${session.sessionId} · model=${model} · budget=${budgetCredits ? `${budgetCredits} credits ($${(budgetCredits / 100).toFixed(2)})` : "none"}` +
          `${softBudgetCredits ? ` · soft budget=${softBudgetCredits} credits` : ""} · writable: ${writableDirs.map((d) => `${rel(d)}/`).join(", ") || "none"}`,
      ),
    );

    let reply;
    let error;
    let settled = true;
    try {
      reply = (await session.sendAndWait({ prompt }, timeoutMinutes * 60_000))?.data?.content;
    } catch (err) {
      // A sendAndWait timeout only stops waiting, so stop the agent too and let in-flight calls report their usage.
      error = err;
      console.log(styleText("red", `\n✖ ${err.message}`));
      if (!forcedStop) {
        const idle = waitForIdle(session, 60_000); // subscribe before aborting so a fast idle event is not missed
        await abortRun();
        settled = !forcedStop && (await idle);
      }
    }
    if (abortPromise) await abortPromise;
    if (forcedStop) settled = false;

    let metrics = null;
    if (!forcedStop) {
      try {
        metrics = await session.rpc.usage.getMetrics();
      } catch (err) {
        console.log(styleText("yellow", `   Could not read session metrics: ${err.message}`));
      }
    }
    if (!settled) console.log(styleText("yellow", "   The session did not finish cleanly: the ledger holds every call billed so far, but the runtime total may be incomplete."));

    const stopped = budgetExhausted ? "stopped: budget" : softBudgetStopped ? "stopped: soft budget" : null;
    const outcome = (error && !stopped ? "failed" : stopped ?? (reply ? "completed" : "no reply")) + (forcedStop ? " (runtime force-stopped)" : "");
    const reconciliation = tracker.reconcile(metrics);
    console.log(
      `\n💰 Run cost: ${styleText(["bold", "green"], `${fmtCredits(tracker.totalNanoAiu)} = ${fmtUsd(tracker.totalNanoAiu)}`)} over ${tracker.calls.length} model calls` +
        (reconciliation.runtimeNanoAiu != null ? styleText("dim", ` (runtime says ${fmtUsd(reconciliation.runtimeNanoAiu)})`) : "") +
        (outcome === "completed" ? "" : styleText("yellow", ` · outcome: ${outcome}`)),
    );
    return { reply, error, outcome, settled, tracker, metrics, reconciliation, sessionId: session.sessionId, budgetExhausted, softBudgetStopped };
  } finally {
    if (session) await session.disconnect().catch(() => {});
    await client.stop().catch(() => {});
    if (eventLog) await new Promise((resolve) => eventLog.end(resolve));
  }
}
