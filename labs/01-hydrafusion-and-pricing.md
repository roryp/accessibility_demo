# Lab 1: HydraFusion and how Copilot pricing works (10 min)

## Concepts

### HydraFusion orchestrates models rather than being one

You select `hydrafusion` like any model. For each prompt it scores the task on four capability signals (**reasoning, code generation, debugging, tool use**) and picks the cheapest **execution pattern** expected to meet the quality bar:

| Pattern | What happens | Good for |
| --- | --- | --- |
| **Single** | One model solves the task | Simple, well-defined tasks |
| **Cascade** | An efficient model drafts; a judge accepts it or escalates to a stronger model | Tasks where a cheap model usually succeeds |
| **Critique** | A model drafts; an independent critic reviews it in an isolated, read-only, tool-less context; the drafter revises once | Tasks where a second opinion catches mistakes |

Built-in safety properties: every leg is time- and cost-bounded, reviewers can't touch your files, and HydraFusion falls back to a known-good model if routing fails. Cost is accounted for in every leg (draft, critique, revision, escalation, retry).

### How Copilot bills

```text
tokens × the model's price  →  AI credits  →  dollars
                               1 AI credit = $0.01
```

- Every model has per-token prices for **input**, **cached input** (much cheaper), **cache writes** and **output**.
- **HydraFusion has no price of its own.** You pay each model it uses at that model's standard rate, and the Auto-mode discount doesn't apply.
- The SDK reports cost in **nano-AIU**: 1 AI credit = 1,000,000,000 nano-AIU.

## Run it

```powershell
npm run models
```

You get a live price table from `client.listModels()` in dollars per 1M tokens, followed by an availability check that creates a HydraFusion session without sending a prompt, so it's free.

## Read the code: turning HydraFusion on in the SDK

[`src/lib/hydrafusion.mjs`](../src/lib/hydrafusion.mjs):

```js
export const HYDRAFUSION_SESSION = {
  model: "hydrafusion",                         // synthetic model: HydraFusion picks the real ones
  enableExperimentalMode: true,                 // HydraFusion is a research preview
  featureFlags: { HYDRAFUSION_ROLLOUT: true },  // host-resolved preview flag (what `copilot --experimental` and VS Code turn on)
  contextTier: "default",                       // HydraFusion does not support context tiers
};
```

> The SDK's runtime only adds the synthetic `hydrafusion` model when the host resolves the `HYDRAFUSION_ROLLOUT` feature flag. This is current as of SDK 1.0.18 / runtime 1.0.94 and may change while HydraFusion is in preview.

## Discuss

1. Look at the price table. Why might a Critique workflow with a cheap drafter and a mid-priced critic cost **less** than one frontier model?
2. Why is cached input 10–20× cheaper than fresh input, and what does that mean for long agent sessions?

Next: [Lab 2: Test the broken site](02-baseline-test.md)
