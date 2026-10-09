# Lab 2: Test the broken site (10 min, free)

## 1. Try it like a user

Open `site/index.html` in your browser, then:

- Press <kbd>Tab</kbd> repeatedly. Can you always see where you are? Can you reach the **Order online** button?
- Zoom to 200%, or use a phone-sized window. Can you zoom? Does the **Menu** button work?
- Read the light grey text in the hero and footer.

## 2. Run the automated tests

```powershell
npm run test:a11y -- --label baseline
```

The suite ([`src/lib/a11y-test.mjs`](../src/lib/a11y-test.mjs)) loads the page in headless Chromium and runs:

| Engine | What it checks |
| --- | --- |
| **axe-core** | All WCAG 2.0/2.1/2.2 Level A and AA rules: contrast, names, labels, ARIA, target size and more |
| **Custom checks** | `keyboard-operable` (2.1.1): click handlers on non-focusable elements. `focus-visible` (2.4.7): really presses Tab and compares styles. `alt-text-quality` (1.1.1, failure F30): file names and placeholder alt text. `table-headers` (1.3.1, failure F91). `link-purpose` (2.4.4/2.4.9, advisory): "click here" links. |

Expected result: **18 failing checks, 45 failing elements, 5 advisories**. The full JSON is in `reports/a11y-baseline.json`.

> The custom checks are deliberately simple heuristics. For example, `focus-visible` compares computed styles before and after focus, and `keyboard-operable` looks for inline handlers and focusability. They catch the common failures; anything they pass still deserves a human look.

Three result groups:

- **Failures**: violations of WCAG 2.2 A/AA. Must fix.
- **Advisories**: best practice, such as landmarks, heading order and positive `tabindex`. Should fix.
- **Needs review**: the engine couldn't decide (for example text on a complex background). A human or AI must judge.

## 3. Exercise: what do the tests miss?

Automated tools find roughly a third to half of WCAG issues. Read `site/index.html` and `site/styles.css` and find **at least three** problems that no check reported. Hints: forms, colour, the mobile menu.

Check your answers against [answer-key.md](answer-key.md) after Lab 3, then see whether HydraFusion found them too.

Next: [Lab 3: HydraFusion audits the site](03-hydrafusion-audit.md)
