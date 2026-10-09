# Lab 3: HydraFusion audits the site (15 min, ≈ $0.02–0.03)

HydraFusion performs a **read-only** WCAG 2.2 AA audit. It runs the test suite as a tool, reads the source, and writes a prioritised report that includes the issues automated tests can't see.

## Run it

```powershell
npm run audit
```

## What you'll see

Output from our reference run:

```text
🧭 HydraFusion is analysing the task and choosing an execution pattern…
   Pattern: CRITIQUE — a model drafts; an independent critic reviews it in an isolated, read-only context; the drafter revises once
   Capability signals used for routing:
     reasoning  ██░░░░░░░░ 0.20
     codeGen    █░░░░░░░░░ 0.07
     debugging  ░░░░░░░░░░ 0.01
     toolUse    ██░░░░░░░░ 0.16
   Plan: 1) draft/solver  →  2) critic/critic [isolated, read-only]  →  3) revision/solver (only if needed)
   Models: primary=gpt-5.6-luna · secondary=gpt-5.6-terra · fallback=gpt-5.6-sol   (policy=max, routed in 501 ms)

▶ Phase 1/3: draft/solver on gpt-5.6-luna
   🔧 run_accessibility_tests site/index.html
   🔧 view site/index.html
   🔧 view site/images/promo.svg
   💲 gpt-5.6-luna: in 13.4K (11.2K cached) · out 3.1K → 0.44 credits ($0.0044) · run total $0.0078
✔ draft/solver finished in 40.1 s · 3 model calls · 0.78 credits ($0.0078)

▶ Phase 2/3: critic/critic on gpt-5.6-terra — isolated review, no tools
✔ critic/critic finished in 11.4 s · 1 model calls · 1.69 credits ($0.0169)
   Critic notes: {"assessment":"revise","feedback":"The executive summary does not provide severity counts for the complete audit findings…"}

▶ Phase 3/3: revision/solver on gpt-5.6-luna
✔ revision/solver finished in 14.1 s · 1 model calls · 0.28 credits ($0.0028)
   📌 Committing the result from gpt-5.6-luna to the conversation (a replay: no new model calls)

✅ HydraFusion turn complete: pattern=critique, outcome=completed, 3 phase(s), 5 model calls, 66 s → 2.75 credits = $0.0275
```

Things to notice:

- **Routing is per task.** HydraFusion chose Critique: a cheap drafter (GPT-5.6 Luna at $0.20 per 1M input tokens) plus an independent critic (GPT-5.6 Terra).
- **The critic earns its keep.** Here it noticed that the executive summary's severity counts left out the manually found issues, and sent the draft back. The revision cost $0.0028. When the critic approves, the conditional revision phase is skipped and you don't pay for it.
- **Every model call is priced live** from the `assistant.usage` event (💲 lines). Notice how much input is **cached**, which is why later calls are cheap.
- **📌 Commit** replays the winning phase into the conversation. It isn't new work and costs nothing.

Open the result: `reports/audit-report.md`. Did HydraFusion find the issues you found in Lab 2? Compare with [answer-key.md](answer-key.md).

## Read the code: the SDK features in play

[`src/lib/hydrafusion.mjs`](../src/lib/hydrafusion.mjs) → `runHydraFusionTask()`:

```js
const session = await client.createSession({
  ...HYDRAFUSION_SESSION,                                // model: "hydrafusion" (+ preview switches)
  systemMessage: { mode: "append", content: INSTRUCTIONS },   // WCAG expert persona and rules
  tools: [accessibilityTestTool],                        // custom tool: our test suite
  availableTools: new ToolSet().addBuiltIn(FILE_TOOLS).addCustom("*"), // no shell, no web, no MCP
  disabledMcpServers: personalMcpServers,                // don't start your own MCP servers
  enableSkills: false, skipCustomInstructions: true,     // same behaviour for every participant
  onPermissionRequest: createWorkshopGuard({ writableDirs: [] }),      // audit = read-only
  sessionLimits: { maxAiCredits: 50 },                   // hard budget (runtime-enforced)
  onEvent: (event) => display.handle(event, tracker.handle(event)),   // live view + cost ledger
});
const reply = await session.sendAndWait({ prompt: AUDIT_PROMPT }, 30 * 60_000);
```

| Feature | Why it matters |
| --- | --- |
| **Custom tool** (`defineTool`) | The agent tests with *your* deterministic test suite instead of guessing |
| **Tool allow-list** (`availableTools`) | A smaller attack surface, and fewer tool definitions means fewer input tokens and lower cost |
| **Isolation** (`disabledMcpServers`, `enableSkills`, `skipCustomInstructions`) | Nothing from a participant's personal Copilot setup leaks in, so runs are comparable and cheaper |
| **Permission handler** | Every read and write asks your code first. The audit can't write at all, and the fix can only write `site/` |
| **System message** | Domain expertise and house rules in one place ([`src/lib/prompts.mjs`](../src/lib/prompts.mjs)) |
| **Events** | `session.fusion_resolved`, `assistant.fusion_phase_*` and `session.fusion_completed` expose HydraFusion's decisions; `assistant.usage` exposes cost |

## Discuss

1. Why might HydraFusion pick Critique (not Single) for an audit? Look at the capability scores.
2. The critic runs in an isolated, read-only, tool-less context. Why is that safer, and why is it cheaper?
3. Edit `AUDIT_PROMPT` in `src/lib/prompts.mjs` (for example ask for WCAG AAA too), re-run it, and compare quality and cost.

Next: [Lab 4: HydraFusion fixes the site](04-hydrafusion-fix.md)
