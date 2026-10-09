// Prints a live, human-readable view of what HydraFusion is doing and what it costs.
import path from "node:path";
import { styleText } from "node:util";
import { ROOT } from "./paths.mjs";
import { fmtCredits, fmtUsd, fmtTokens } from "./cost-tracker.mjs";

const s = (format, text) => styleText(format, String(text));

const PATTERN_EXPLAINED = {
  single: "one model solves the task directly (fast, cheapest)",
  cascade: "an efficient model drafts; a judge accepts it or escalates to a stronger model",
  critique: "a model drafts; an independent critic reviews it in an isolated, read-only context; the drafter revises once",
};

function bar(score) {
  const filled = Math.round(Math.max(0, Math.min(1, score ?? 0)) * 10);
  return `${"█".repeat(filled)}${"░".repeat(10 - filled)} ${(score ?? 0).toFixed(2)}`;
}

function shortPath(p) {
  if (typeof p !== "string") return "";
  const r = path.relative(ROOT, path.resolve(ROOT, p));
  return r.startsWith("..") ? p : r.split(path.sep).join("/");
}

function describeTool(name, args = {}) {
  if (args.path) return `${name} ${shortPath(args.path)}`;
  if (typeof args.input === "string") {
    const files = [...args.input.matchAll(/\*\*\* (?:Update|Add|Delete) File: (.+)/g)].map((m) => shortPath(m[1].trim()));
    if (files.length) return `${name} ${files.join(", ")}`;
  }
  if (args.pattern) return `${name} "${String(args.pattern).slice(0, 40)}"`;
  if (args.file) {
    const file = String(args.file);
    return `${name} ${path.isAbsolute(file) || /^site[\\/]/.test(file) ? shortPath(file) : `site/${file}`}`;
  }
  return name;
}

export class FusionProgressDisplay {
  constructor(tracker) {
    this.tracker = tracker;
    this.phaseNo = 0;
    this.planSize = 0;
  }

  handle(event, call) {
    const d = event.data ?? {};
    switch (event.type) {
      case "session.fusion_route_started":
        console.log(`\n${s("cyan", "🧭 HydraFusion")} is analysing the task and choosing an execution pattern…`);
        break;

      case "session.fusion_resolved": {
        this.planSize = d.phasePlan?.length ?? 0;
        this.phaseNo = 0;
        console.log(`${s(["bold", "cyan"], `   Pattern: ${String(d.pattern).toUpperCase()}`)} — ${PATTERN_EXPLAINED[d.pattern] ?? ""}`);
        if (d.hint) console.log(s("dim", `   "${d.hint}"`));
        if (d.scores) {
          console.log(s("dim", "   Capability signals used for routing:"));
          for (const [k, v] of Object.entries(d.scores)) console.log(s("dim", `     ${k.padEnd(10)} ${bar(v)}`));
        }
        if (d.phasePlan?.length) {
          const steps = d.phasePlan.map((p, i) => `${i + 1}) ${p.kind}/${p.role}${p.scope === "review" ? " [isolated, read-only]" : ""}${p.conditional ? " (only if needed)" : ""}`);
          console.log(`   Plan: ${steps.join("  →  ")}`);
        }
        const models = [
          `primary=${d.primaryModel}`,
          d.secondaryModel && `secondary=${d.secondaryModel}`,
          d.judgeModel && `judge=${d.judgeModel}`,
          d.repairModel && `repair=${d.repairModel}`,
          d.critics?.length && `critics=${d.critics.map((c) => c.model).join(",")}`,
          `fallback=${d.fallbackModel}`,
        ].filter(Boolean);
        console.log(`   Models: ${models.join(" · ")}   ${s("dim", `(policy=${d.policy}, routed in ${Math.round(d.routingLatencyMs ?? 0)} ms)`)}`);
        break;
      }

      case "session.fusion_route_failed":
        console.log(s("yellow", `⚠  HydraFusion routing failed (${d.reason}); continuing safely on fallback model ${d.fallbackModel}.`));
        break;

      case "assistant.fusion_phase_started":
        this.phaseNo += 1;
        console.log(
          `\n${s("bold", `▶ Phase ${this.phaseNo}${this.planSize ? `/${this.planSize}` : ""}: ${d.phaseKind}/${d.role}`)} on ${s("magenta", d.model)}` +
            s("dim", `${d.reasoningEffort ? ` (reasoning: ${d.reasoningEffort})` : ""}${d.conversationScope === "review" ? " — isolated review, no tools" : ""}`),
        );
        break;

      case "assistant.intent":
        if (d.intent) console.log(s("dim", `   💭 ${d.intent}`));
        break;

      case "tool.execution_start":
        // Events tagged with a commitId replay the winning phase into the conversation; they are not new tool calls.
        if (!d.fusion?.commitId) console.log(`   🔧 ${describeTool(d.toolName, d.arguments ?? {})}`);
        break;

      case "session.fusion_commit_started":
        console.log(s("dim", `   📌 Committing the result from ${d.sourceModel} to the conversation (a replay: no new model calls)`));
        break;

      case "assistant.usage":
        if (call) {
          const cached = call.cacheReadTokens ? ` (${fmtTokens(call.cacheReadTokens)} cached)` : "";
          console.log(
            s("dim", `   💲 ${call.model}: in ${fmtTokens(call.inputTokens)}${cached} · out ${fmtTokens(call.outputTokens)} → `) +
              s("green", `${fmtCredits(call.nanoAiu)} (${fmtUsd(call.nanoAiu)})`) +
              s("dim", ` · run total ${fmtUsd(this.tracker.totalNanoAiu)}`),
          );
        }
        break;

      case "assistant.fusion_phase_completed": {
        const u = d.usage ?? {};
        console.log(
          `${s("green", "✔")} ${d.phaseKind}/${d.role} finished in ${(d.durationMs / 1000).toFixed(1)} s · ${u.requestCount ?? 0} model calls · ` +
            s("green", `${fmtCredits(u.totalNanoAiu ?? 0)} (${fmtUsd(u.totalNanoAiu ?? 0)})`),
        );
        if (d.verdict) console.log(s("yellow", `   Verdict: ${String(d.verdict).slice(0, 300)}`));
        if (d.conversationScope === "review" && d.content) {
          console.log(s("dim", `   Critic notes: ${d.content.replace(/\s+/g, " ").slice(0, 400)}${d.content.length > 400 ? "…" : ""}`));
        }
        break;
      }

      case "assistant.fusion_phase_failed":
        console.log(s("red", `✖ ${d.phaseKind}/${d.role} on ${d.model} failed (${d.reason})${d.degradedToPhaseId ? " — HydraFusion degraded to a safe fallback phase" : ""}.`));
        break;

      case "session.fusion_completed":
        console.log(
          `\n${s(["bold", "green"], "✅ HydraFusion turn complete")}: pattern=${d.pattern}, outcome=${d.outcome}, ${d.phaseCount} phase(s), ` +
            `${d.requestCount} model calls, ${(d.durationMs / 1000).toFixed(0)} s, final answer from ${d.finalSourceModel} → ` +
            s(["bold", "green"], `${fmtCredits(d.totalNanoAiu)} = ${fmtUsd(d.totalNanoAiu)}`),
        );
        if (d.degradedReason) console.log(s("yellow", `   Degraded: ${d.degradedReason}`));
        break;

      case "session.warning":
        console.log(s("yellow", `⚠  ${d.message}`));
        break;

      case "session.error":
        console.log(s("red", `✖ Session error (${d.errorType}): ${d.message}`));
        break;
    }
  }
}
