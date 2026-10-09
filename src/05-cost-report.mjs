// Lab 5: total cost of the accessibility testing done with HydraFusion. Free: no prompts are sent.
//   npm run cost            -> prints the report and writes reports/cost-report.md + reports/cost-report.json
//
// Money comes from the per-call ledger (written the moment each model call is billed). The run summaries add context:
// HydraFusion pattern, outcome and the accounting cross-check.
import fs from "node:fs";
import path from "node:path";
import { styleText } from "node:util";
import { readJsonl, toCredits, toUsd, fmtTokens, NANO_AIU_PER_CREDIT, USD_PER_CREDIT } from "./lib/cost-tracker.mjs";
import { LEDGER_FILE, RUNS_FILE, REPORTS_DIR, rel } from "./lib/paths.mjs";

const calls = readJsonl(LEDGER_FILE);
const meta = new Map(readJsonl(RUNS_FILE).map((r) => [r.run, r]));
if (!calls.length && !meta.size) {
  console.log("No runs recorded yet. Run `npm run audit` and `npm run fix` first.");
  process.exit(0);
}

const usd = (nano, d = 4) => `$${toUsd(nano).toFixed(d)}`;
const credits = (nano) => toCredits(nano).toFixed(2);

function render(title, headers, rows, aligns) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const fmt = (r) => r.map((c, i) => (aligns[i] === "r" ? String(c).padStart(widths[i]) : String(c).padEnd(widths[i]))).join("  ");
  const text = [styleText("bold", title), ` ${fmt(headers)}`, ` ${widths.map((w) => "─".repeat(w)).join("  ")}`, ...rows.map((r) => ` ${fmt(r)}`)].join("\n");
  const md = [`### ${title}`, "", `| ${headers.join(" | ")} |`, `| ${aligns.map((a) => (a === "r" ? "---:" : "---")).join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
  return { text, md };
}

// Build one record per run from the ledger, then attach the run summary when there is one.
const runs = new Map();
for (const c of calls) {
  const r = runs.get(c.run) ?? { run: c.run, model: c.requestedModel, firstTs: c.ts, calls: 0, inputTokens: 0, outputTokens: 0, nanoAiu: 0 };
  r.calls += 1;
  r.inputTokens += c.inputTokens;
  r.outputTokens += c.outputTokens;
  r.nanoAiu += c.nanoAiu;
  runs.set(c.run, r);
}
for (const [id, m] of meta) if (!runs.has(id)) runs.set(id, { run: id, firstTs: m.startedAt, calls: 0, inputTokens: 0, outputTokens: 0, nanoAiu: 0 });
const runList = [...runs.values()]
  .map((r) => ({ ...r, meta: meta.get(r.run) ?? null, model: r.model ?? meta.get(r.run)?.model ?? "unknown" }))
  .sort((a, b) => String(a.meta?.startedAt ?? a.firstTs).localeCompare(String(b.meta?.startedAt ?? b.firstTs)));

const isFusion = (r) => r.model === "hydrafusion";
const fusionRuns = runList.filter(isFusion);
const otherRuns = runList.filter((r) => !isFusion(r));
const fusionRunIds = new Set(fusionRuns.map((r) => r.run));
const fusionCalls = calls.filter((c) => fusionRunIds.has(c.run));
const fusionTotal = fusionRuns.reduce((n, r) => n + r.nanoAiu, 0);
const sections = [];

// 1) One row per run.
const runRows = runList.map((r) => [
  r.run,
  r.model,
  [...new Set((r.meta?.routes ?? []).map((x) => x.pattern))].join(", ") || "-",
  r.meta?.outcome ?? (r.meta ? "completed" : "no summary (interrupted?)"),
  r.calls,
  fmtTokens(r.inputTokens),
  fmtTokens(r.outputTokens),
  credits(r.nanoAiu),
  usd(r.nanoAiu),
]);
runRows.push(["TOTAL (HydraFusion runs)", "", "", "", fusionCalls.length, "", "", credits(fusionTotal), usd(fusionTotal)]);
sections.push(render("Runs", ["Run", "Model", "Pattern(s)", "Outcome", "Calls", "Input", "Output", "Credits", "USD"], runRows, ["l", "l", "l", "l", "r", "r", "r", "r", "r"]));

// 2) Which real models HydraFusion used, and what each cost.
const byModel = new Map();
for (const c of fusionCalls) {
  const m = byModel.get(c.model) ?? { calls: 0, uncached: 0, cacheRead: 0, cacheWrite: 0, output: 0, nano: 0 };
  m.calls += 1;
  m.uncached += Math.max(0, c.inputTokens - c.cacheReadTokens - c.cacheWriteTokens);
  m.cacheRead += c.cacheReadTokens;
  m.cacheWrite += c.cacheWriteTokens;
  m.output += c.outputTokens;
  m.nano += c.nanoAiu;
  byModel.set(c.model, m);
}
const modelRows = [...byModel.entries()]
  .sort((a, b) => b[1].nano - a[1].nano)
  .map(([model, m]) => [model, m.calls, fmtTokens(m.uncached), fmtTokens(m.cacheRead), fmtTokens(m.cacheWrite), fmtTokens(m.output), credits(m.nano), usd(m.nano), `${fusionTotal ? ((m.nano / fusionTotal) * 100).toFixed(1) : "0.0"}%`]);
sections.push(render("Cost by model (HydraFusion runs)", ["Model", "Calls", "Uncached input", "Cache read", "Cache write", "Output", "Credits", "USD", "Share"], modelRows, ["l", "r", "r", "r", "r", "r", "r", "r", "r"]));

// 3) Cost by HydraFusion phase role (solver, critic, judge, ...).
const byRole = new Map();
for (const c of fusionCalls) {
  const key = `${c.phaseKind ?? "-"}/${c.role ?? "-"}|${c.model}`;
  const r = byRole.get(key) ?? { calls: 0, nano: 0 };
  r.calls += 1;
  r.nano += c.nanoAiu;
  byRole.set(key, r);
}
const roleRows = [...byRole.entries()].sort((a, b) => b[1].nano - a[1].nano).map(([k, r]) => [...k.split("|"), r.calls, credits(r.nano), usd(r.nano)]);
sections.push(render("Cost by HydraFusion phase", ["Phase/role", "Model", "Calls", "Credits", "USD"], roleRows, ["l", "l", "r", "r", "r"]));

// 4) Accounting cross-check: our ledger vs. HydraFusion's turn totals vs. the runtime's metrics vs. a price-table estimate.
const recRows = fusionRuns.map((r) => {
  const rec = r.meta?.reconciliation;
  if (!rec) return [r.run, usd(r.nanoAiu), "-", "-", "-", "no summary"];
  // The ledger total we just aggregated must also equal the total the run recorded for itself.
  const ok = rec.matched && rec.ledgerNanoAiu === r.nanoAiu && r.meta.settled !== false;
  return [
    r.run,
    usd(r.nanoAiu),
    rec.fusionTurnsNanoAiu != null ? usd(rec.fusionTurnsNanoAiu) : "-",
    rec.runtimeNanoAiu != null ? usd(rec.runtimeNanoAiu) : "-",
    rec.priceTableEstimateNanoAiu != null ? usd(rec.priceTableEstimateNanoAiu) : "-",
    ok ? "✔ match" : "check",
  ];
});
sections.push(render("Accounting cross-check", ["Run", "Per-call ledger", "HydraFusion turns", "Runtime metrics", "Price-table estimate", "Result"], recRows, ["l", "r", "r", "r", "r", "l"]));

// 5) Outcome: what the money bought.
const lastFix = fusionRuns.filter((r) => r.meta?.a11y?.after).at(-1);
let outcomeLine = "";
if (lastFix) {
  const { before, after } = lastFix.meta.a11y;
  const fixedChecks = before.failedChecks - after.failedChecks;
  const fixedElements = before.failedElements - after.failedElements;
  outcomeLine =
    `Latest fix run: ${before.failedChecks} → ${after.failedChecks} failing WCAG checks, ${before.failedElements} → ${after.failedElements} failing elements, ` +
    `${before.advisories} → ${after.advisories} advisories` +
    (fixedElements > 0 ? ` (≈ ${usd(lastFix.nanoAiu / fixedElements)} per fixed element${fixedChecks > 0 ? `, ${usd(lastFix.nanoAiu / fixedChecks)} per fixed check` : ""}).` : ".");
}

if (otherRuns.length) {
  const otherTotal = otherRuns.reduce((n, r) => n + r.nanoAiu, 0);
  sections.push({
    text: `${styleText("bold", "Comparison runs (single model, not included in the HydraFusion total)")}\n ${otherRuns.map((r) => `${r.run} on ${r.model}: ${usd(r.nanoAiu)}`).join("\n ")}\n Total: ${usd(otherTotal)}`,
    md: `### Comparison runs (single model, not included in the HydraFusion total)\n\n${otherRuns.map((r) => `- ${r.run} on ${r.model}: ${usd(r.nanoAiu)}`).join("\n")}`,
  });
}

const headline = `TOTAL COST OF ACCESSIBILITY TESTING WITH HYDRAFUSION: ${usd(fusionTotal)} (≈ ${usd(fusionTotal, 2)}; ${credits(fusionTotal)} AI credits, ${fusionRuns.length} run(s), ${fusionCalls.length} model calls)`;
const pricing = `Billing: tokens × each model's rate → AI credits; 1 AI credit = $${USD_PER_CREDIT.toFixed(2)}; the SDK reports nano-AIU (1 credit = ${NANO_AIU_PER_CREDIT.toLocaleString("en-US")} nano-AIU).`;

console.log(`\n${styleText(["bold", "cyan"], "=== HydraFusion accessibility workshop · cost report ===")}`);
console.log(styleText("dim", pricing));
for (const s of sections) console.log(`\n${s.text}`);
if (outcomeLine) console.log(`\n${outcomeLine}`);
console.log(`\n${styleText(["bold", "green"], `💰 ${headline}`)}\n`);

const md = [
  `# HydraFusion accessibility workshop: cost report`,
  ``,
  `_Generated ${new Date().toISOString()} from \`${rel(LEDGER_FILE)}\` and \`${rel(RUNS_FILE)}\`._`,
  ``,
  `> **${headline}**`,
  ``,
  pricing,
  ``,
  ...sections.flatMap((s) => [s.md, ""]),
  outcomeLine,
].join("\n");
fs.mkdirSync(REPORTS_DIR, { recursive: true });
fs.writeFileSync(path.join(REPORTS_DIR, "cost-report.md"), md);
fs.writeFileSync(
  path.join(REPORTS_DIR, "cost-report.json"),
  JSON.stringify(
    {
      totalNanoAiu: fusionTotal,
      totalCredits: toCredits(fusionTotal),
      totalUsd: toUsd(fusionTotal),
      runs: runList.map(({ meta: m, ...r }) => ({ ...r, outcome: m?.outcome ?? null, patterns: (m?.routes ?? []).map((x) => x.pattern), reconciliation: m?.reconciliation ?? null, a11y: m?.a11y ?? null })),
    },
    null,
    2,
  ),
);
console.log(`Saved ${rel(path.join(REPORTS_DIR, "cost-report.md"))} and ${rel(path.join(REPORTS_DIR, "cost-report.json"))}\n`);
