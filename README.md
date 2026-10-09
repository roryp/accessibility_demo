# Fix WCAG issues with HydraFusion and the GitHub Copilot SDK

A short, hands-on workshop (about 90 minutes). You'll use **HydraFusion**, GitHub Copilot's multi-model orchestrator, from code through the **GitHub Copilot SDK** to test a website for WCAG 2.2 accessibility problems and fix them. You'll also track exactly what that costs, down to a fraction of a cent.

You'll work on **Bean & Bloom Café**, a small website seeded with 28 real-world accessibility bugs.

| Before (`starter/site`) | After HydraFusion |
| --- | --- |
| 18 failing WCAG 2.2 A/AA checks across 45 elements, 5 best-practice advisories | 0 failing checks, 0 advisories, verified by an independent re-test |

## What you will learn

1. **What HydraFusion is.** It isn't one model: it picks an execution pattern (**Single**, **Cascade** or **Critique**) and the models to run it, per task.
2. **How to drive HydraFusion from code.** You'll use the Copilot SDK with custom tools, a tool allow-list, a permission guard and live progress events.
3. **How to test accessibility properly.** Automated WCAG tests (axe-core plus keyboard checks) are followed by AI review, AI fixes and an independent re-test.
4. **How to track and control cost.** You'll account for every model call, phase and run in AI credits and dollars, reconcile against the runtime's own numbers, and set budget guardrails.

## Agenda

| Lab | Topic | Time | Command | Cost |
| --- | --- | --- | --- | --- |
| [0](labs/00-setup.md) | Setup | 10 min | `npm install`, `npm run setup` | free |
| [1](labs/01-hydrafusion-and-pricing.md) | HydraFusion and how Copilot pricing works | 10 min | `npm run models` | free |
| [2](labs/02-baseline-test.md) | Test the broken site (WCAG 2.2 A/AA) | 10 min | `npm run test:a11y` | free |
| [3](labs/03-hydrafusion-audit.md) | HydraFusion audits the site (read-only) | 15 min | `npm run audit` | ≈ $0.02–0.03 |
| [4](labs/04-hydrafusion-fix.md) | HydraFusion fixes the site, then we re-test | 20 min | `npm run fix` | ≈ $0.02–0.03 |
| [5](labs/05-cost-tracking.md) | Track the cost and report the total in dollars | 15 min | `npm run cost` | free |
| | Wrap-up and discussion | 10 min | | |

The costs shown come from our reference runs (see [Reference results](#reference-results)). Your numbers will differ slightly because HydraFusion chooses its workflow per task.

### In a hurry? Run everything with one command

```powershell
npm install
npm run workshop      # browser setup → reset → models → baseline test → audit → fix → cost report
```

## How it fits together

```text
 your script (src/03-*.mjs, src/04-*.mjs)
   │  runHydraFusionTask()  ── src/lib/hydrafusion.mjs
   ▼
 CopilotClient ──JSON-RPC──▶ Copilot runtime (bundled with the SDK)
   │                              │
   │ createSession({ model: "hydrafusion", … })
   │   • tools: run_accessibility_tests  ──▶ Playwright + axe-core, sandboxed to site/ (src/lib/a11y-test.mjs)
   │   • availableTools: view/edit/create/apply_patch/glob/grep only (no shell, no web)
   │   • onPermissionRequest: writes allowed only in site/ (and nowhere during the audit)
   │   • sessionLimits.maxAiCredits: hard budget cap
   │                              ▼
   │                     HydraFusion picks Single / Cascade / Critique
   │                     and runs phases on real models (e.g. gpt-5.6-luna drafts,
   │                     gpt-5.6-terra critiques in an isolated, read-only context)
   ▼
 session events ──▶ FusionProgressDisplay (live view)  +  CostTracker (ledger)
                                                            │
                         reports/usage-ledger.jsonl, runs.jsonl, events/*.jsonl
                                                            ▼
                                            npm run cost → total in $
```

## Project layout

| Path | What it is |
| --- | --- |
| `starter/site/` | The broken website. Never edited; `npm run reset` copies it to `site/`. |
| `site/` | Working copy that HydraFusion fixes. Open `site/index.html` in a browser. |
| `src/01-models-and-prices.mjs` | Lab 1: model prices from the API, plus a HydraFusion availability check |
| `src/02-test-site.mjs` | Lab 2: run the WCAG test suite (no AI) |
| `src/03-hydrafusion-audit.mjs` | Lab 3: HydraFusion audit (read-only) → `reports/audit-report.md` |
| `src/04-hydrafusion-fix.mjs` | Lab 4: HydraFusion fixes `site/` → `reports/fix-summary.md` |
| `src/05-cost-report.mjs` | Lab 5: cost report → `reports/cost-report.md` |
| `src/lib/hydrafusion.mjs` | SDK session setup for HydraFusion: custom tool, allow-list, guard, budgets |
| `src/lib/cost-tracker.mjs` | Cost math (nano-AIU → AI credits → $) and the per-call ledger |
| `src/lib/fusion-display.mjs` | Live view of HydraFusion routing, phases and spend |
| `src/lib/a11y-test.mjs` | Test engine: axe-core plus custom keyboard, focus, alt-text and table checks |
| `src/lib/prompts.mjs` | All prompts in one place; edit them and compare cost and quality |
| `labs/answer-key.md` | Facilitator answer key: every seeded issue and how it is detected |

## Reference results

From a clean `npm run workshop` run (Copilot SDK 1.0.18, runtime 1.0.94, October 2026):

| Run | HydraFusion pattern | Models used | Model calls | Cost |
| --- | --- | --- | ---: | ---: |
| Audit (read-only) | Critique: the critic sent the draft back because its severity summary left out the manual findings | gpt-5.6-luna (draft) → gpt-5.6-terra (critic) → gpt-5.6-luna (revision) | 5 | $0.0275 |
| Fix + re-test | Critique: the critic sent the draft back because the re-test loop wasn't evidenced; the revision re-tested | gpt-5.6-luna (draft) → gpt-5.6-terra (critic) → gpt-5.6-luna (revision) | 15 | $0.0294 |
| **Total** | | | **20** | **$0.0569** (5.69 AI credits) |

Independent re-test after the fix: **18 → 0** failing WCAG checks, **45 → 0** failing elements, **5 → 0** advisories, 37 checks passing. That's about $0.0007 per fixed element. Per-call ledger, HydraFusion turn totals, runtime metrics and a price-table estimate all agreed to the last nano-AIU.

## Facilitator notes

- **Budget.** A full run costs about 6 cents per participant. The labs cap each run with a runtime-enforced budget: 50 AI credits ($0.50) for the audit and 100 ($1.00) for the fix.
- **Before the session.** Have everyone run `npm run models`. It costs nothing, and it catches access problems (plan, org policy, preview features) early.
- **Discussion prompts** are at the end of each lab. [labs/answer-key.md](labs/answer-key.md) lists every seeded bug, its WCAG success criterion, and whether automated tests can find it.
- **Run it again.** `npm run reset` restores the broken site. `npm run reset:all` also clears the cost ledger.
- **Not a production setup.** HydraFusion is a research preview with no SLA and isn't meant for production workloads.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Model "hydrafusion" is not available` | HydraFusion needs Copilot Pro, Pro+, Business or Enterprise. For Business and Enterprise, an admin must enable preview features. The SDK session must set `enableExperimentalMode: true` and the `HYDRAFUSION_ROLLOUT` feature flag; `src/lib/hydrafusion.mjs` already does this. Run `npm run models` to check access. |
| `HydraFusion models do not support context tiers` | Your Copilot settings pin a context tier (for example `"contextTier": "long_context"` in `~/.copilot/settings.json`). The labs already pass `contextTier: "default"`. In the CLI, add `--context default`. |
| `Could not resolve @github/copilot-sdk-win32-x64` (or another platform) | npm skipped the SDK's native runtime package. Check `npm config get os`: an `os=` override in `~/.npmrc` makes npm install packages for a different OS. Reinstall with `npm install --os=win32` (or `darwin`/`linux`). |
| `Executable doesn't exist … chromium_headless_shell` or "Chromium for Playwright is not installed" | Run `npm run setup`. On a minimal Linux machine, also install Chromium's system libraries: `sudo npx playwright install-deps chromium`. |
| `Minimum session limit is 30 AI credits` | Runtime budgets (`--budget`) must be at least 30 credits ($0.30). For smaller limits use `--soft-budget` (see Lab 5). |
| Not signed in | Run `copilot login`, or set `COPILOT_GITHUB_TOKEN`, `GH_TOKEN` or `GITHUB_TOKEN`. The SDK also uses a GitHub CLI login. |

## Learn more

- [Using HydraFusion](https://docs.github.com/early-access/copilot/hydrafusion) (GitHub Docs)
- [Project HydraFusion: frontier quality via multi-model orchestration](https://github.blog/ai-and-ml/github-copilot/project-hydrafusion-frontier-quality-via-multi-model-orchestration/) (GitHub Blog)
- [GitHub Copilot SDK](https://github.com/github/copilot-sdk)
- [Models and pricing for GitHub Copilot](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) and [axe-core rules](https://dequeuniversity.com/rules/axe/)
