// Lab 4: HydraFusion fixes the WCAG issues (edits only site/), re-testing as it goes. We then re-test independently.
//   npm run fix
//   npm run fix -- --budget 60               (hard cap: 60 AI credits = $0.60; runtime minimum is 30)
//   npm run fix -- --soft-budget 1           (app-side cap: abort as soon as 1 credit = $0.01 is spent)
//   npm run fix -- --model claude-opus-5     (stretch: compare with a single model; run `npm run reset` first)
import fs from "node:fs";
import path from "node:path";
import { runHydraFusionTask, parseRunArgs } from "./lib/hydrafusion.mjs";
import { runAccessibilityTests, printResults } from "./lib/a11y-test.mjs";
import { recordRun, newRunId, fmtCredits, fmtUsd } from "./lib/cost-tracker.mjs";
import { INSTRUCTIONS, FIX_PROMPT } from "./lib/prompts.mjs";
import { REPORTS_DIR, SITE_DIR, ensureSite, rel } from "./lib/paths.mjs";

const { budget, softBudget, model } = parseRunArgs({ defaultBudget: 100 });
ensureSite();
const startedAt = new Date();
const run = newRunId("fix");
const who = model === "hydrafusion" ? "HydraFusion" : model;

console.log(`\n=== Lab 4 · ${who} fixes the site ===`);
const before = await runAccessibilityTests();
printResults(before, { title: "Before" });

const result = await runHydraFusionTask({
  run,
  prompt: FIX_PROMPT,
  instructions: INSTRUCTIONS,
  writableDirs: [SITE_DIR],
  budgetCredits: budget,
  softBudgetCredits: softBudget,
  model,
});

// Never trust the agent's own claim: re-test with the same suite, outside the agent.
let after = null;
try {
  after = await runAccessibilityTests();
  printResults(after, { title: "After (independent re-test)" });
} catch (err) {
  console.log(`\n✖ Independent re-test failed: ${err.message}`);
}

const b = before.summary;
const a = after?.summary ?? null;
recordRun(result.tracker, {
  script: "fix",
  model,
  startedAt: startedAt.toISOString(),
  endedAt: new Date().toISOString(),
  outcome: result.outcome,
  settled: result.settled,
  reconciliation: result.reconciliation,
  budgetExhausted: result.budgetExhausted,
  softBudgetStopped: result.softBudgetStopped,
  error: result.error?.message ?? null,
  a11y: { before: b, after: a },
});

const total = result.tracker.totalNanoAiu;
const cell = (key) => (a ? a[key] : "n/a");
const summary = [
  `# Accessibility fixes: Bean & Bloom Café`,
  ``,
  `_Fixed by ${who} through the GitHub Copilot SDK on ${startedAt.toISOString()} (outcome: ${result.outcome})._`,
  ``,
  `| Independent re-test | Before | After |`,
  `| --- | ---: | ---: |`,
  `| Failing WCAG 2.2 A/AA checks | ${b.failedChecks} | ${cell("failedChecks")} |`,
  `| Failing elements | ${b.failedElements} | ${cell("failedElements")} |`,
  `| Best-practice advisories | ${b.advisories} | ${cell("advisories")} |`,
  `| Checks passed | ${b.passedChecks} | ${cell("passedChecks")} |`,
  ``,
  `## ${who}'s summary`,
  ``,
  result.reply ?? `_No summary was produced${result.error ? `: ${result.error.message}` : ""}._`,
  ``,
  `---`,
  `**Cost of this fix run:** ${fmtCredits(total)} = **${fmtUsd(total)}** across ${result.tracker.calls.length} model calls.`,
].join("\n");

fs.mkdirSync(REPORTS_DIR, { recursive: true });
const out = path.join(REPORTS_DIR, "fix-summary.md");
fs.writeFileSync(out, summary);
if (after) fs.writeFileSync(path.join(REPORTS_DIR, "a11y-after-fix.json"), JSON.stringify(after, null, 2));

console.log(`\n📄 Fix summary: ${rel(out)}   🌐 Open ${rel(path.join(SITE_DIR, "index.html"))} in a browser and compare with starter/site/index.html`);
console.log(`📒 Cost ledger updated (all runs: npm run cost)\n`);
if (result.error || !a || a.failedChecks > 0) process.exitCode = 1;
