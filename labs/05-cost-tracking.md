# Lab 5: Track the cost and report the total in dollars (15 min, free)

## Run it

```powershell
npm run cost
```

```text
=== HydraFusion accessibility workshop · cost report ===
Billing: tokens × each model's rate → AI credits; 1 AI credit = $0.01; the SDK reports nano-AIU (1 credit = 1,000,000,000 nano-AIU).

Runs
 Run                                 Model        Pattern(s)  Outcome    Calls   Input  Output  Credits      USD
 audit-2026-10-09T11-28-57-658-89f6  hydrafusion  critique    completed      5   38.4K    6.5K     2.75  $0.0275
 fix-2026-10-09T11-30-08-782-29b3    hydrafusion  critique    completed     15  171.4K    7.3K     2.94  $0.0294
 TOTAL (HydraFusion runs)                                                   20                     5.69  $0.0569

Cost by model (HydraFusion runs)
 Model          Calls  Uncached input  Cache read  Cache write  Output  Credits      USD  Share
 gpt-5.6-terra      2               6           0         6.3K    1.1K     2.92  $0.0292  51.4%
 gpt-5.6-luna      18              54      166.9K        36.5K   12.7K     2.77  $0.0277  48.6%

Cost by HydraFusion phase
 Phase/role       Model          Calls  Credits      USD
 critic/critic    gpt-5.6-terra      2     2.92  $0.0292
 draft/solver     gpt-5.6-luna      10     1.86  $0.0186
 revision/solver  gpt-5.6-luna       8     0.91  $0.0091

Accounting cross-check
 Run                                 Per-call ledger  HydraFusion turns  Runtime metrics  Price-table estimate  Result
 audit-2026-10-09T11-28-57-658-89f6          $0.0275            $0.0275          $0.0275               $0.0275  ✔ match
 fix-2026-10-09T11-30-08-782-29b3            $0.0294            $0.0294          $0.0294               $0.0294  ✔ match

Latest fix run: 18 → 0 failing WCAG checks, 45 → 0 failing elements, 5 → 0 advisories (≈ $0.0007 per fixed element, $0.0016 per fixed check).

💰 TOTAL COST OF ACCESSIBILITY TESTING WITH HYDRAFUSION: $0.0569 (≈ $0.06; 5.69 AI credits, 2 run(s), 20 model calls)
```

The report is saved as `reports/cost-report.md` and `reports/cost-report.json`.

## Where the numbers come from

There are four independent sources, and the report cross-checks all of them:

| # | Source | Granularity | In the code |
| --- | --- | --- | --- |
| 1 | `assistant.usage` event, `data.copilotUsage.totalNanoAiu` | every model call, **as billed** | `CostTracker.handle()` in [`cost-tracker.mjs`](../src/lib/cost-tracker.mjs) appends it to `reports/usage-ledger.jsonl` immediately, so spend is recorded even if a script crashes later |
| 2 | `assistant.fusion_phase_completed.usage.totalNanoAiu` and `session.fusion_completed.totalNanoAiu` | each HydraFusion phase and turn | `CostTracker.handle()` |
| 3 | `await session.rpc.usage.getMetrics()` (`totalNanoAiu`, per-model breakdown) | the whole session, from the runtime's own accounting | `runHydraFusionTask()` |
| 4 | Token counts × prices from `client.listModels()` → `billing.tokenPrices` | estimate per call | `estimateNanoAiu()` |

A run counts as "✔ match" only if sources 1, 2 and 3 agree within 0.5%. In the reference run all four agreed to the nano-AIU.

Each `assistant.usage` event also says **which HydraFusion phase spent the money**. Here's the third call of the reference audit (fields trimmed):

```json
{
  "model": "gpt-5.6-luna",
  "inputTokens": 13365, "cacheReadTokens": 11196, "cacheWriteTokens": 2166, "outputTokens": 3052,
  "copilotUsage": { "totalNanoAiu": 442842000 },
  "fusion": { "pattern": "critique", "phaseKind": "draft", "role": "solver", "sourceModel": "gpt-5.6-luna" }
}
```

## The maths, step by step

`inputTokens` already **includes** cache reads and cache writes. GPT-5.6 Luna costs $0.20 input, $0.02 cached, $0.25 cache write and $1.20 output per 1M tokens:

| Token type | Tokens | Price per 1M | Cost |
| --- | ---: | ---: | ---: |
| Uncached input (13,365 − 11,196 − 2,166) | 3 | $0.20 | $0.0000006 |
| Cache read | 11,196 | $0.02 | $0.00022392 |
| Cache write | 2,166 | $0.25 | $0.0005415 |
| Output | 3,052 | $1.20 | $0.0036624 |
| **Total** | | | **$0.00442842 = 0.442842 AI credits = 442,842,000 nano-AIU** ✔ matches the billed value |

```js
const credits = nanoAiu / 1_000_000_000;   // nano-AIU → AI credits
const dollars = credits * 0.01;            // AI credits → USD
```

Notice that 11,196 of the 13,365 input tokens were **cache reads** at a tenth of the price. Prompt caching is a big reason this run was so cheap.

## Guardrails: control the cost, don't just watch it

| Guardrail | How | Behaviour |
| --- | --- | --- |
| **Hard budget** (runtime) | `sessionLimits: { maxAiCredits: 100 }`, or `--budget 100` | The runtime blocks the next model call and emits `session_limits_exhausted.requested`. We answer `cancel` through `session.rpc.ui.handlePendingSessionLimitsExhausted()`. **Minimum 30 credits ($0.30).** |
| **Soft budget** (your app) | `--soft-budget 0.5` | We watch `assistant.usage` live and call `session.abort()` once the total crosses your limit. Works for any amount, and stops after the call that crosses it. |

Try the soft budget. In our test it stopped the fix run after 3 calls and 0.81 credits ($0.0081), and recorded the outcome as `stopped: soft budget`:

```powershell
npm run fix -- --soft-budget 0.5
npm run reset        # the aborted draft may have left partial edits
```

## Tracking cost outside the SDK

| Where | How |
| --- | --- |
| Copilot CLI, interactive | `/usage` shows the AI credits each model used in the session |
| Copilot CLI, scripted | `copilot --experimental --model hydrafusion --context default -p "…" --usage-output-file usage.json --max-ai-credits 50` writes the same metrics JSON as `session.rpc.usage.getMetrics()` |
| Your GitHub account | Billing → *Monitoring your GitHub AI Credits usage* shows account-wide spend across Copilot |

## Exercises

1. In the "Cost by HydraFusion phase" table, the critic made 2 of 20 calls but took about half the spend. Was it worth it? Look at what it caught in Labs 3 and 4.
2. The report prints **cost per fixed element**. Estimate what the same work would cost a human team.
3. Run the stretch comparison from Lab 4 (`--model claude-opus-5`) and compare the cost of the two runs in `npm run cost`.

## Wrap-up

- **HydraFusion** chose a cheap drafter plus an independent critic for both tasks. The critic caught real mistakes (an audit summary that left out the manual findings, and an "all tests pass" claim made without re-testing) for about a cent each.
- **The Copilot SDK** turned this into a repeatable, guarded program: custom test tool in a sandboxed browser, tool allow-list, write fence, budgets and live telemetry.
- **Cost** is fully observable at the call, phase, turn and session level, and our ledger matched the runtime to the last nano-AIU. The whole audit-and-fix cost **$0.0569**.
- **Humans still review.** Tests and AI got the site to zero automated failures, and a five-minute human review still found visually hidden form labels, a colour-only "required" cue and a link to nowhere.
