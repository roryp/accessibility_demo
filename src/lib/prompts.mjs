// All prompts used by the labs live here so you can experiment with them in one place.

/** Appended to the Copilot system message for every run. */
export const INSTRUCTIONS = `
You are a senior web accessibility engineer. The project is a small static website for "Bean & Bloom Café" in the site/ folder
(site/index.html, site/styles.css, site/map.html and site/images/*.svg). The target is WCAG 2.2 Level A and AA.

How to work:
- Test with the run_accessibility_tests tool. It runs axe-core plus custom keyboard, focus-visibility, alt-text and table checks
  in Chromium. "failures" must be fixed, "advisories" should be fixed, and "needsReview" items need your judgement.
- Automated tests only catch part of WCAG. Also review the source yourself for what they miss: information conveyed by colour
  alone, placeholder-only form labels, meaningful alternative text (open an SVG to see what it shows), heading structure,
  landmarks, link purpose, invalid ARIA states and controls that are only visible on small screens.
- Prefer native, semantic HTML over ARIA. Keep the existing look, copy and layout; change colours only as much as contrast requires.
- Only files under site/ may ever be changed. Never modify the tests or anything outside site/.
- Be economical: read each file once, batch related edits, and avoid unnecessary tool calls.
`.trim();

export const AUDIT_PROMPT = `
Audit the website in site/ for WCAG 2.2 AA conformance. This is a read-only audit: do not modify any files.

1. Run run_accessibility_tests once.
2. Read site/index.html and site/styles.css (and any SVG you need) to find issues the automated tests miss.
3. Reply with a concise Markdown audit report:
   - a two-sentence executive summary with issue counts by severity;
   - a table "# | Issue | WCAG SC (level) | Severity | Where | How to fix", one row per distinct issue, ordered by severity,
     with "(manual)" after issues the automated tests did not detect;
   - the three fixes with the biggest impact for users.
`.trim();

export const FIX_PROMPT = `
Make the website in site/ conform to WCAG 2.2 Level AA.

Work in a test → fix → re-test loop:
1. Run run_accessibility_tests and read site/index.html, site/styles.css and site/map.html.
2. Fix every failure and advisory, plus the issues automated tests cannot detect (see your instructions).
3. Re-run run_accessibility_tests. Repeat until it reports 0 failures and 0 advisories (at most 4 test runs).

When finished, reply with a short Markdown summary: a table "WCAG SC | What changed", the final test result,
and anything that still needs a human to review.
`.trim();
