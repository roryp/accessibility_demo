# Lab 4: HydraFusion fixes the site (20 min, ≈ $0.02–0.03)

HydraFusion gets write access to **`site/` only** and works in a **test → fix → re-test** loop until the suite reports zero failures. When it's done, the script re-tests independently, because an agent's claim of success isn't evidence.

## Run it

```powershell
npm run reset   # make sure you start from the broken site
npm run fix
```

## What you'll see

Output from our reference run:

```text
Before: 18 failing checks · 45 failing elements · 5 advisories · 22 checks passed

   Pattern: CRITIQUE … Models: primary=gpt-5.6-luna · secondary=gpt-5.6-terra
▶ Phase 1/3: draft/solver on gpt-5.6-luna            ← tests, edits site/index.html, styles.css and map.html
✔ draft/solver finished in 44.8 s · 7 model calls · 1.08 credits ($0.0108)
▶ Phase 2/3: critic/critic on gpt-5.6-terra — isolated review, no tools
   Critic notes: {"assessment":"revise","feedback":"The required test → fix → re-test loop is not evidenced as completed.
                  Run run_accessibility_tests after the changes … before reporting the final result."}
▶ Phase 3/3: revision/solver on gpt-5.6-luna         ← re-tests, finishes the remaining fixes
✔ revision/solver finished in 31.8 s · 7 model calls · 0.63 credits ($0.0063)
✅ HydraFusion turn complete: pattern=critique, 3 phase(s), 15 model calls, 81 s → 2.94 credits = $0.0294

After (independent re-test): 0 failing checks · 0 failing elements · 0 advisories · 37 checks passed
```

The critic caught the drafter **claiming** success without having re-run the tests. That's exactly the mistake a second reviewer exists for, and it cost $0.0123. The critic doesn't always object: in another run it approved the first draft, and the revision phase was skipped.

## Review the result like a human

Automated tests passing is necessary, but it isn't enough. Spend 5 minutes on this:

1. Open `site/index.html`. Tab through the page: is the focus ring visible, and does the order make sense?
2. Turn on a screen reader (Narrator: <kbd>Win</kbd>+<kbd>Ctrl</kbd>+<kbd>Enter</kbd>; VoiceOver: <kbd>Cmd</kbd>+<kbd>F5</kbd>) and listen to the menu table and the order form.
3. Diff the changes: `git diff --no-index starter/site site`
4. Judge the AI's choices: accurate alt text, brand-appropriate colours, sensible markup.
5. Read `reports/fix-summary.md`, including the "human review" notes HydraFusion wrote.

In our reference run the suite was green, yet a human reviewer still found real problems:

- **3.3.2 Labels or Instructions and 1.4.1 Use of Color.** The new `<label>`s are screen-reader-only (`class="sr-only"`). Sighted users still see only placeholders, which disappear as they type, and a red border is the only visible "required" cue. The hint says "Fields marked required must be completed", but nothing is visibly marked. HydraFusion's own audit had recommended persistent, visible labels.
- **A link to nowhere.** "View the full drinks and pastries list" now has descriptive text but still points to `href="#"`. That's a content gap no accessibility test can catch.

That's the lesson: **tests + AI + a human** beats any one of them. Try fixing these by editing `FIX_PROMPT` in `src/lib/prompts.mjs` (for example, "labels must be visible"), or paste `reports/audit-report.md` into the prompt, then `npm run reset && npm run fix`.

## Read the code: safety rails

[`src/lib/hydrafusion.mjs`](../src/lib/hydrafusion.mjs):

```js
export function createWorkshopGuard({ writableDirs = [] } = {}) {
  const writable = (p) => writableDirs.some((dir) => isInside(p, dir));
  return (request) => {
    switch (request.kind) {
      case "read":  return isInside(request.resolvedPath ?? request.path, ROOT) ? approve : reject(…);
      case "write": {
        // every path the edit touches must be writable (a move has a before and an after path)
        const targets = [request.fileName, request.resolvedPath, ...fileEditPaths].filter(Boolean);
        return targets.length && targets.every(writable) ? approve : reject(…);
      }
      case "custom-tool": return approve;
      default: return reject(`'${request.kind}' permission is disabled in this workshop`);  // shell, url, mcp…
    }
  };
}
```

`isInside()` ([`paths.mjs`](../src/lib/paths.mjs)) compares **real** locations: symlinks and junctions are resolved and Windows paths are compared case-insensitively, so `site/../package.json` or a link inside `site/` pointing elsewhere is rejected. Blocked requests appear as `🛡  Blocked: …` lines. HydraFusion runs its solver phases through this same permission-aware loop, while critics run with no tools at all.

**A tool that skips permission prompts must be safe on its own.** `run_accessibility_tests` uses `skipPermission: true`, so its browser is sandboxed: only files inside `site/` may load, and network requests, WebSockets, service workers and downloads are blocked. Otherwise an agent could add `<img src="https://attacker/…">` to the page and use the test run to leak data.

> **HydraFusion limitation:** if a run is cancelled or a draft is discarded, edits the draft already made are **not** undone automatically. Always review, and use `npm run reset` to start over.

## Discuss

1. What did the independent re-test add that HydraFusion's own testing didn't?
2. Which fixes would you send back in code review, and why?
3. Stretch: compare against a single frontier model: `npm run reset && npm run fix -- --model claude-opus-5`, then `npm run cost`. Which was cheaper, and was the quality different?

Next: [Lab 5: Track the cost](05-cost-tracking.md)
