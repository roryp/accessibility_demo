# Facilitator answer key: seeded accessibility issues

The starter site (`starter/site/`) contains these deliberate problems. "Detected by" shows which part of the test suite reports each one. **Manual** means no automated check finds it, so it needs a human or an AI reviewer.

| # | Issue | Where | WCAG 2.2 SC (level) | Detected by |
| ---: | --- | --- | --- | --- |
| 1 | No `lang` on `<html>` | `<html>` | 3.1.1 Language of Page (A) | axe `html-has-lang` |
| 2 | No `<title>` | `<head>` | 2.4.2 Page Titled (A) | axe `document-title` |
| 3 | Zoom disabled (`user-scalable=no, maximum-scale=1`) | viewport `<meta>` | 1.4.4 Resize Text (AA) | axe `meta-viewport` |
| 4 | Scrolling `<marquee>` announcement that can't be paused | top bar | 2.2.2 Pause, Stop, Hide (A) | axe `marquee` |
| 5 | Logo image without `alt` | header | 1.1.1 Non-text Content (A) | axe `image-alt` |
| 6 | Icon-only cart link: image without `alt`, link without a name | header nav | 1.1.1 (A), 2.4.4 Link Purpose (A), 4.1.2 Name, Role, Value (A) | axe `image-alt`, `link-name` |
| 7 | Hero image without `alt` | hero | 1.1.1 (A) | axe `image-alt` |
| 8 | "Order online" is a `<div onclick>`: no focus, no role, no keyboard | hero | 2.1.1 Keyboard (A), 4.1.2 (A) | custom `keyboard-operable` |
| 9 | Decorative divider has `alt="divider.png"` | below hero | 1.1.1 (A), failure F30 | custom `alt-text-quality` |
| 10 | Promo banner is an image of text with `alt="banner"` | menu section | 1.1.1 (A), 1.4.5 Images of Text (AA) | custom `alt-text-quality` (1.4.5: manual) |
| 11 | Menu table uses bold `<td>` instead of `<th>` | menu table | 1.3.1 Info and Relationships (A), failure F91 | custom `table-headers` |
| 12 | "Click here" link text, and the link goes nowhere (`href="#"`) | menu section | 2.4.4 (A, in context) / 2.4.9 (AAA) | custom `link-purpose` (advisory) |
| 13 | Headings jump from `<h1>` to `<h4>` | all sections | 1.3.1 (A), best practice | axe `heading-order` (advisory) |
| 14 | No landmarks (`header`/`nav`/`main`/`footer`) | whole page, and `map.html` | 1.3.1 (A) / 2.4.1 Bypass Blocks (A), best practice | axe `region`, `landmark-one-main` (advisories) |
| 15 | Low-contrast text: top bar, nav, tagline, button, links, hint, footer | throughout | 1.4.3 Contrast (Minimum) (AA) | axe `color-contrast` |
| 16 | Focus outline removed globally (`*:focus { outline: none }`) | `styles.css` | 2.4.7 Focus Visible (AA) | custom `focus-visible` |
| 17 | Name, email and newsletter fields labelled only by `placeholder` | order form, footer | 1.3.1 (A), 3.3.2 Labels or Instructions (A) | **manual** (axe accepts a placeholder as a name) |
| 18 | "Fields in **red** are required": colour is the only cue | order form | 1.4.1 Use of Color (A), 3.3.2 (A) | **manual** |
| 19 | Invalid `autocomplete="nope"` | email field | 1.3.5 Identify Input Purpose (AA) | axe `autocomplete-valid` |
| 20 | `<select>` without a label | order form | 4.1.2 (A), 1.3.1 (A) | axe `select-name` |
| 21 | Icon-only submit button, no accessible name | order form | 4.1.2 (A), 1.1.1 (A) | axe `button-name`, `image-alt` |
| 22 | `<ul>` whose children are `<div>`s | opening hours | 1.3.1 (A) | axe `list` |
| 23 | `<iframe>` without `title` | map | 4.1.2 (A) | axe `frame-title` |
| 24 | Social links: icon with `alt=""`, so the link has no name | footer | 2.4.4 (A), 4.1.2 (A) | axe `link-name` |
| 25 | Social links are 16×16 px, 2 px apart | footer | 2.5.8 Target Size (Minimum) (AA, new in 2.2) | axe `target-size` |
| 26 | Positive `tabindex="3"` breaks focus order | newsletter field | 2.4.3 Focus Order (A) | axe `tabindex` (advisory) |
| 27 | Focusable "back to top" link inside `aria-hidden="true"` | footer | 4.1.2 (A) | axe `aria-hidden-focus` |
| 28 | Mobile "Menu" button: `aria-expanded="yes"` is invalid and never updated | header (hidden on desktop) | 4.1.2 (A) | **manual** (the button is hidden at the 1280 px test width) |

Totals at baseline: **18 failing checks / 45 elements** and **5 advisories**. Issues 17, 18, 28 and the 1.4.5 part of 10 are invisible to the automated suite. In the reference run, HydraFusion's audit reported 17, 18 and 28 as "(manual)" findings. For issue 10 it asked for alt text that carries the banner's offer (1.1.1) but didn't raise 1.4.5 Images of Text.

Interesting for discussion: the audit recommended persistent, visible labels (17) and a non-colour "required" cue (18), but the separate fix run used screen-reader-only labels, so sighted users still rely on placeholders and red borders. Feeding `reports/audit-report.md` into the fix prompt is a good extension exercise.

## Good fixes look like

- Native elements over ARIA: `<a href="#order" class="btn">` or `<button>`, rather than `<div role="button" tabindex="0">`.
- Visible `<label for>` elements plus the `required` attribute, with the word "(required)" so colour isn't the only cue.
- Informative alt text that conveys the image's message (the promo banner's text: "Happy hour 2–4 pm: 20% off every latte, Monday to Friday"), and `alt=""` for decorative images.
- A clear `:focus-visible` outline (at least 2 px, ≥ 3:1 contrast against its surroundings).
- Colour changes kept close to the original palette while meeting 4.5:1 for text.
