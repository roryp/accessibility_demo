// Cost tracking for Copilot SDK sessions (works for HydraFusion and for single models).
//
// How Copilot bills (usage-based billing):
//   tokens x per-model price  ->  AI credits  ->  US dollars
//   1 AI credit = $0.01, and the SDK reports cost in nano-AIU (1 AI credit = 1,000,000,000 nano-AIU).
// HydraFusion has no price of its own: every model it orchestrates is billed at that model's standard rate.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { LEDGER_FILE, RUNS_FILE } from "./paths.mjs";

export const NANO_AIU_PER_CREDIT = 1_000_000_000;
export const USD_PER_CREDIT = 0.01;

/** Unique, sortable run id, e.g. "fix-2026-10-09T11-10-13-766-3f2a". */
export const newRunId = (prefix) => `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-").replace("Z", "")}-${randomUUID().slice(0, 4)}`;

export const toCredits = (nanoAiu) => nanoAiu / NANO_AIU_PER_CREDIT;
export const toUsd = (nanoAiu) => toCredits(nanoAiu) * USD_PER_CREDIT;
export const fmtCredits = (nanoAiu) => `${toCredits(nanoAiu).toFixed(2)} credits`;
export const fmtUsd = (nanoAiu, digits = 4) => `$${toUsd(nanoAiu).toFixed(digits)}`;
export const fmtTokens = (n = 0) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));

/** Per-model token prices (AI credits per `batchSize` tokens) straight from the Copilot API. */
export async function loadPriceTable(client) {
  const models = await client.listModels();
  return Object.fromEntries(models.filter((m) => m.billing?.tokenPrices).map((m) => [m.id, { name: m.name, ...m.billing.tokenPrices }]));
}

/** Estimates one model call from its token counts. Used as a cross-check; returns null if a needed price is unknown. */
export function estimateNanoAiu(usage, prices) {
  const p = prices?.[usage.model];
  if (!p) return null;
  const tier = p.longContext && (usage.inputTokens ?? 0) > (p.maxPromptTokens ?? Infinity) ? { ...p, ...p.longContext } : p;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  // inputTokens already includes cached reads and cache writes, so only the remainder is billed at the input rate.
  const uncached = Math.max(0, (usage.inputTokens ?? 0) - cacheRead - cacheWrite);
  const parts = [
    [uncached, tier.inputPrice],
    [cacheRead, tier.cacheReadPrice ?? tier.cachePrice],
    [cacheWrite, tier.cacheWritePrice],
    [usage.outputTokens ?? 0, tier.outputPrice],
  ];
  if (parts.some(([tokens, price]) => tokens > 0 && price == null)) return null;
  const credits = parts.reduce((sum, [tokens, price]) => sum + tokens * (price ?? 0), 0) / (p.batchSize ?? 1_000_000);
  return Math.round(credits * NANO_AIU_PER_CREDIT);
}

const emptyBucket = () => ({ calls: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, nanoAiu: 0 });
function addTo(bucket, call) {
  bucket.calls += 1;
  bucket.inputTokens += call.inputTokens;
  bucket.cacheReadTokens += call.cacheReadTokens;
  bucket.cacheWriteTokens += call.cacheWriteTokens;
  bucket.outputTokens += call.outputTokens;
  bucket.nanoAiu += call.nanoAiu;
  return bucket;
}

/** Listens to session events, writes every billed model call to the ledger as it happens, and keeps HydraFusion records. */
export class CostTracker {
  constructor({ run, requestedModel, prices = {}, budgetCredits, ledgerFile = LEDGER_FILE } = {}) {
    this.run = run;
    this.requestedModel = requestedModel;
    this.sessionId = null;
    this.prices = prices;
    this.budgetCredits = budgetCredits;
    this.ledgerFile = ledgerFile;
    this.calls = [];
    this.routes = [];
    this.routeFailures = [];
    this.phases = [];
    this.turns = [];
    this.seen = new Set();
  }

  /** Feed every session event here. Returns the new ledger entry for `assistant.usage` events. */
  handle(event) {
    if (event.id) {
      if (this.seen.has(event.id)) return null;
      this.seen.add(event.id);
    }
    const d = event.data ?? {};
    switch (event.type) {
      case "assistant.usage":
        return this.#recordCall(event);
      case "session.fusion_resolved":
        this.routes.push({
          fusionId: d.fusionId, pattern: d.pattern, hint: d.hint, policy: d.policy, scores: d.scores, phasePlan: d.phasePlan,
          primaryModel: d.primaryModel, secondaryModel: d.secondaryModel, judgeModel: d.judgeModel, repairModel: d.repairModel,
          critics: d.critics, fallbackModel: d.fallbackModel, routingLatencyMs: d.routingLatencyMs,
        });
        break;
      case "session.fusion_route_failed":
        this.routeFailures.push({ reason: d.reason, fallbackModel: d.fallbackModel, errorMessage: d.errorMessage });
        break;
      case "assistant.fusion_phase_completed":
      case "assistant.fusion_phase_failed":
        this.phases.push({
          fusionId: d.fusionId, phaseId: d.phaseId, phaseKind: d.phaseKind, role: d.role, model: d.model, status: d.status,
          verdict: d.verdict ?? null, reason: d.reason ?? null, durationMs: d.durationMs, usage: d.usage,
        });
        break;
      case "session.fusion_completed":
        this.turns.push({
          fusionId: d.fusionId, pattern: d.pattern, outcome: d.outcome, phaseCount: d.phaseCount, requestCount: d.requestCount,
          finalSourceModel: d.finalSourceModel, degradedReason: d.degradedReason, durationMs: d.durationMs, totalNanoAiu: d.totalNanoAiu,
        });
        break;
    }
    return null;
  }

  #recordCall(event) {
    const d = event.data;
    const key = `usage:${d.accounting?.usageId ?? d.apiCallId ?? event.id}`;
    if (this.seen.has(key)) return null;
    this.seen.add(key);

    const billed = d.copilotUsage?.totalNanoAiu;
    const estimated = estimateNanoAiu(d, this.prices);
    const call = {
      run: this.run,
      requestedModel: this.requestedModel,
      sessionId: this.sessionId,
      ts: event.timestamp,
      model: d.model,
      pattern: d.fusion?.pattern ?? null,
      phaseKind: d.fusion?.phaseKind ?? null,
      role: d.fusion?.role ?? null,
      inputTokens: d.inputTokens ?? 0,
      cacheReadTokens: d.cacheReadTokens ?? 0,
      cacheWriteTokens: d.cacheWriteTokens ?? 0,
      outputTokens: d.outputTokens ?? 0,
      reasoningTokens: d.reasoningTokens ?? 0,
      nanoAiu: billed ?? estimated ?? 0,
      costSource: billed != null ? "billed" : estimated != null ? "estimated" : "unknown",
      estimatedNanoAiu: estimated,
      reasoningEffort: d.reasoningEffort ?? null,
      durationMs: d.duration ?? null,
    };
    this.calls.push(call);
    // Persist immediately: money already spent must reach the ledger even if the script fails later.
    appendJsonl(this.ledgerFile, [call]);
    return call;
  }

  get totalNanoAiu() {
    return this.calls.reduce((n, c) => n + c.nanoAiu, 0);
  }

  summarize() {
    const total = this.calls.reduce(addTo, emptyBucket());
    const byModel = {};
    const byRole = {};
    for (const c of this.calls) {
      addTo((byModel[c.model] ??= emptyBucket()), c);
      const role = c.role ? `${c.phaseKind}/${c.role}` : "(not in a HydraFusion phase)";
      addTo((byRole[`${role} · ${c.model}`] ??= emptyBucket()), c);
    }
    return { ...total, credits: toCredits(total.nanoAiu), usd: toUsd(total.nanoAiu), byModel, byRole };
  }

  /** Compares our per-call ledger with HydraFusion's turn totals and the runtime's session metrics (and a price-table estimate). */
  reconcile(metrics) {
    const ledger = this.totalNanoAiu;
    const runtime = metrics?.totalNanoAiu ?? null;
    const fusion = this.turns.length ? this.turns.reduce((n, t) => n + (t.totalNanoAiu ?? 0), 0) : null;
    const estimate = this.calls.length && this.calls.every((c) => c.estimatedNanoAiu != null) ? this.calls.reduce((n, c) => n + c.estimatedNanoAiu, 0) : null;
    const diffPct = (other) => (other == null ? null : other === ledger ? 0 : (Math.abs(ledger - other) / Math.max(ledger, other)) * 100);
    const ledgerVsRuntimeDiffPct = diffPct(runtime);
    const ledgerVsFusionDiffPct = diffPct(fusion);
    const matched = ledgerVsRuntimeDiffPct != null && ledgerVsRuntimeDiffPct < 0.5 && (ledgerVsFusionDiffPct == null || ledgerVsFusionDiffPct < 0.5);
    return {
      ledgerNanoAiu: ledger,
      runtimeNanoAiu: runtime,
      fusionTurnsNanoAiu: fusion,
      priceTableEstimateNanoAiu: estimate,
      ledgerVsRuntimeDiffPct,
      ledgerVsFusionDiffPct,
      matched,
    };
  }
}

function appendJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
}

export function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
}

/** Saves the run's metadata (routing, phases, reconciliation, outcome). The per-call costs are already in the ledger. */
export function recordRun(tracker, details) {
  const summary = tracker.summarize();
  const row = {
    run: tracker.run,
    requestedModel: tracker.requestedModel,
    sessionId: tracker.sessionId,
    ...details,
    budgetCredits: tracker.budgetCredits ?? null,
    routes: tracker.routes,
    routeFailures: tracker.routeFailures,
    phases: tracker.phases,
    turns: tracker.turns,
    totals: { calls: summary.calls, inputTokens: summary.inputTokens, cacheReadTokens: summary.cacheReadTokens, cacheWriteTokens: summary.cacheWriteTokens, outputTokens: summary.outputTokens, nanoAiu: summary.nanoAiu, credits: summary.credits, usd: summary.usd },
  };
  appendJsonl(RUNS_FILE, [row]);
  return row;
}
