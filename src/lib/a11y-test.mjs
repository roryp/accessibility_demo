// Accessibility test engine used by both the workshop scripts and the HydraFusion agent tool.
// It combines axe-core (WCAG 2.2 A/AA rules) with a few keyboard/semantics checks that axe cannot do.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { ROOT, SITE_DIR, canonicalPath, isInside, rel } from "./paths.mjs";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const LEVEL_A_TAGS = new Set(["wcag2a", "wcag21a", "wcag22a"]);

export const CUSTOM_CHECKS = [
  { id: "keyboard-operable", wcag: ["2.1.1"], level: "A", impact: "critical", help: "Clickable elements must be reachable and operable with the keyboard" },
  { id: "focus-visible", wcag: ["2.4.7"], level: "AA", impact: "serious", help: "Keyboard focus must be visible on every focusable element" },
  { id: "alt-text-quality", wcag: ["1.1.1"], level: "A", impact: "serious", help: "Alt text must describe the image, not be a file name or placeholder word (failure F30)" },
  { id: "table-headers", wcag: ["1.3.1"], level: "A", impact: "serious", help: "Data tables need a complete header row or column marked up with <th> (failure F91)" },
];
const LINK_PURPOSE = { id: "link-purpose", wcag: ["2.4.4", "2.4.9"], help: "Link text should describe its destination on its own (avoid 'click here')" };
const KEYBOARD_REACH = { id: "keyboard-reachability", wcag: ["2.1.1", "2.1.2"], help: "Visible, focusable elements that the Tab key never reached (possible keyboard trap or focus-order problem)" };

const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s ?? "");

function wcagFromTags(tags) {
  const criteria = tags
    .map((t) => /^wcag(\d)(\d)(\d{1,2})$/.exec(t))
    .filter(Boolean)
    .map((m) => `${m[1]}.${m[2]}.${m[3]}`);
  const level = tags.some((t) => LEVEL_A_TAGS.has(t)) ? "A" : tags.some((t) => /^wcag2\daa$|^wcag2aa$/.test(t)) ? "AA" : undefined;
  return { criteria, level };
}

const isWcagRule = (tags) => tags.some((t) => WCAG_TAGS.includes(t));

function fromAxe(rule) {
  const { criteria, level } = wcagFromTags(rule.tags);
  return {
    id: rule.id,
    source: "axe-core",
    wcag: criteria,
    level,
    impact: rule.impact ?? "moderate",
    help: rule.help,
    helpUrl: rule.helpUrl,
    elements: rule.nodes.map((n) => ({
      target: n.target.flat().join(" "),
      html: clip(n.html, 200),
      why: clip(n.failureSummary?.replace(/\s+/g, " ").trim(), 260),
    })),
  };
}

// Runs inside the page: helpers shared by the custom checks.
const PAGE_HELPERS = () => {
  window.__a11yTarget = (el) => {
    if (el.id) return `#${el.id}`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 3 && node !== document.body) {
      let part = node.tagName.toLowerCase();
      const cls = [...node.classList].slice(0, 2);
      if (cls.length) part += `.${cls.join(".")}`;
      const siblings = node.parentElement ? [...node.parentElement.children].filter((c) => c.tagName === node.tagName) : [];
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ");
  };
  // Approximate accessible name: aria-labelledby, aria-label, then text content and image alt text.
  window.__a11yName = (el) => {
    const ids = el.getAttribute("aria-labelledby");
    if (ids) return ids.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").replace(/\s+/g, " ").trim();
    const label = el.getAttribute("aria-label");
    if (label?.trim()) return label.trim();
    const parts = [];
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) parts.push(node.textContent);
      else if (node.nodeType === Node.ELEMENT_NODE && node.getAttribute("aria-hidden") !== "true") {
        if (node.tagName === "IMG") parts.push(node.getAttribute("alt") ?? "");
        else node.childNodes.forEach(walk);
      }
    };
    el.childNodes.forEach(walk);
    return parts.join(" ").replace(/\s+/g, " ").trim();
  };
  // Focus-relevant look of an element, its ::before/::after and its parent (covers :focus-within indicators).
  window.__a11ySig = (el) => {
    const props = (cs) =>
      [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow, cs.backgroundColor, cs.color, cs.borderTopColor,
        cs.borderBottomColor, cs.borderTopWidth, cs.borderBottomWidth, cs.textDecorationLine, cs.opacity].join("|");
    const pseudo = (which) => {
      const cs = getComputedStyle(el, which);
      return cs.content === "none" ? "" : props(cs) + cs.content;
    };
    return [props(getComputedStyle(el)), pseudo("::before"), pseudo("::after"), el.parentElement ? props(getComputedStyle(el.parentElement)) : ""].join("#");
  };
  window.__a11yVisible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest("[inert]");
  window.__a11yEl = (el, why) => ({ target: window.__a11yTarget(el), html: el.outerHTML.slice(0, 200), why });
};

async function runCustomChecks(page) {
  await page.evaluate(PAGE_HELPERS);

  const static_ = await page.evaluate(() => {
    const out = { "keyboard-operable": [], "alt-text-quality": [], "table-headers": [], "link-purpose": [] };

    const nativeInteractive = (el) =>
      (el.tagName === "A" && el.hasAttribute("href")) || ["BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"].includes(el.tagName);
    const interactiveRoles = ["button", "link", "checkbox", "menuitem", "tab", "switch", "option", "radio"];
    for (const el of document.querySelectorAll("[onclick]")) {
      if (nativeInteractive(el)) continue;
      const focusable = el.tabIndex >= 0;
      const hasRole = interactiveRoles.includes(el.getAttribute("role"));
      const hasKeys = ["onkeydown", "onkeyup", "onkeypress"].some((a) => el.getAttribute(a)?.trim());
      if (!(focusable && hasRole && hasKeys)) {
        const missing = [!focusable && "not focusable", !hasRole && "no interactive role", !hasKeys && "no keyboard handler"].filter(Boolean);
        out["keyboard-operable"].push(window.__a11yEl(el, `Has a click handler but is ${missing.join(", ")}. Use a native <button> or <a href>.`));
      }
    }
    // Custom widgets (handlers added with addEventListener are invisible to us, but they must at least be focusable).
    for (const el of document.querySelectorAll(interactiveRoles.map((r) => `[role="${r}"]:not([onclick])`).join(","))) {
      if (!nativeInteractive(el) && el.tabIndex < 0) {
        out["keyboard-operable"].push(window.__a11yEl(el, `Has role="${el.getAttribute("role")}" but cannot receive keyboard focus (add tabindex="0" or use a native element).`));
      }
    }

    const fileLike = /\.(png|jpe?g|gif|svg|webp|avif|bmp)$/i;
    const placeholder = /^(image|img|picture|photo|graphic|icon|banner|logo|divider|spacer|untitled|placeholder|screenshot)$/i;
    for (const img of document.querySelectorAll("img[alt]")) {
      const alt = img.getAttribute("alt").trim();
      if (alt && (fileLike.test(alt) || placeholder.test(alt))) {
        out["alt-text-quality"].push(window.__a11yEl(img, `alt="${alt}" is a file name or placeholder. Describe the image, or use alt="" if it is decorative.`));
      }
    }

    const isTh = (cell) => cell?.tagName === "TH";
    const width = (row) => [...row.cells].reduce((n, c) => n + (c.colSpan || 1), 0);
    for (const table of document.querySelectorAll("table")) {
      if (["presentation", "none"].includes(table.getAttribute("role"))) continue;
      const rows = [...table.rows].filter((r) => r.cells.length);
      const columns = Math.max(0, ...rows.map(width));
      if (rows.length < 2 || columns < 2) continue;
      // A header row must span every column; otherwise every remaining row must start with a header cell.
      const headerRow = rows.some((r) => [...r.cells].every(isTh) && width(r) === columns);
      const headerColumn = rows.filter((r) => ![...r.cells].every(isTh)).every((r) => isTh(r.cells[0]));
      if (!headerRow && !headerColumn) {
        out["table-headers"].push(window.__a11yEl(table, "Data table has no complete header row or header column marked up with <th>, so screen readers cannot announce headers."));
      }
    }

    const generic = /^(click here|here|read more|more|learn more|link|this link|click|details|more info)$/i;
    for (const a of document.querySelectorAll("a[href]")) {
      const name = window.__a11yName(a);
      if (generic.test(name)) out["link-purpose"].push(window.__a11yEl(a, `Link text "${name}" does not describe its destination.`));
    }
    return out;
  });

  // Focus visibility: snapshot each focusable element unfocused, then really press Tab through the page and compare.
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  const expected = await page.evaluate(() => {
    document.activeElement?.blur?.();
    window.__a11yBefore = {};
    const reachable = [];
    const sel = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, iframe, [tabindex]';
    document.querySelectorAll(sel).forEach((el, i) => {
      el.setAttribute("data-a11y-probe", String(i));
      window.__a11yBefore[i] = window.__a11ySig(el);
      if (el.tabIndex >= 0 && !el.disabled && window.__a11yVisible(el)) {
        reachable.push({ id: String(i), ...window.__a11yEl(el, "Visible and focusable, but never reached with the Tab key.") });
      }
    });
    return reachable;
  });

  const noFocusIndicator = [];
  const seen = new Set();
  for (let i = 0; i < expected.length * 2 + 10; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el === document.documentElement) return null;
      const id = el.getAttribute("data-a11y-probe");
      return {
        id,
        tag: el.tagName,
        unchanged: id !== null && window.__a11yBefore[id] === window.__a11ySig(el),
        ...window.__a11yEl(el, "No visible change (outline, box-shadow, colour or border) when focused with the keyboard."),
      };
    });
    if (!info) {
      if (seen.size) break; // focus left the page: the tab cycle is complete
      continue;
    }
    const key = info.id ?? info.target;
    if (seen.has(key)) {
      if (info.tag === "IFRAME") continue; // Tab is moving through the frame's own content
      break;
    }
    seen.add(key);
    if (info.tag !== "IFRAME" && info.unchanged) {
      const { id, tag, unchanged, ...element } = info;
      noFocusIndicator.push(element);
    }
  }
  const unreached = expected.filter((e) => !seen.has(e.id)).map(({ id, ...element }) => element);

  const byId = { ...static_, "focus-visible": noFocusIndicator };
  const failures = CUSTOM_CHECKS.filter((c) => byId[c.id].length).map((c) => ({ ...c, source: "custom", elements: byId[c.id] }));
  const advisories = byId["link-purpose"].length ? [{ ...LINK_PURPOSE, source: "custom", impact: "moderate", elements: byId["link-purpose"] }] : [];
  const needsReview = unreached.length ? [{ ...KEYBOARD_REACH, source: "custom", impact: "serious", elements: unreached }] : [];
  const passed = CUSTOM_CHECKS.filter((c) => !byId[c.id].length).map((c) => c.id);
  return { failures, advisories, needsReview, passed };
}

/** Accepts "index.html", "site/index.html" or an absolute path; only real files inside site/ are allowed. */
function resolvePage(file) {
  for (const candidate of [path.resolve(SITE_DIR, file), path.resolve(ROOT, file)]) {
    if (isInside(candidate, SITE_DIR) && fs.statSync(candidate, { throwIfNoEntry: false })?.isFile()) return canonicalPath(candidate);
  }
  throw new Error(`Page not found: "${file}". Pass a page inside ${rel(SITE_DIR)}/, for example "index.html" or "map.html".`);
}

/**
 * The agent can call this tool without a permission prompt, so the browser is sandboxed: only files inside site/
 * may load. The context is offline, DNS never resolves, WebRTC/WebTransport are removed, and other requests,
 * WebSockets, service workers and downloads are blocked.
 */
const LOCKDOWN_ARGS = ["--host-resolver-rules=MAP * ~NOTFOUND", "--dns-prefetch-disable", "--disable-background-networking", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"];

async function sandbox(context) {
  await context.addInitScript(() => {
    for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel", "WebTransport"]) {
      try {
        Object.defineProperty(window, name, { value: undefined, configurable: false, writable: false });
      } catch {}
    }
  });
  const allowedFile = (url) => {
    try {
      return isInside(fileURLToPath(url), SITE_DIR);
    } catch {
      return false;
    }
  };
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    if (url.startsWith("file:") && allowedFile(url)) return route.continue();
    return route.abort("blockedbyclient");
  });
  await context.routeWebSocket(/.*/, (ws) => ws.close());
}

/**
 * Runs the full accessibility test suite against a page in the site folder.
 * @param {{ file?: string }} [options] page inside the site folder (default: index.html)
 */
export async function runAccessibilityTests({ file = "index.html" } = {}) {
  const absolute = resolvePage(file);

  let browser;
  try {
    browser = await chromium.launch({ args: LOCKDOWN_ARGS });
  } catch (err) {
    if (/Executable doesn't exist|playwright install/i.test(err.message)) throw new Error("Chromium for Playwright is not installed. Run: npm run setup");
    throw err;
  }
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, offline: true, serviceWorkers: "block", acceptDownloads: false });
    await sandbox(context);
    const page = await context.newPage();
    await page.goto(pathToFileURL(absolute).href, { waitUntil: "load" });

    const axe = await new AxeBuilder({ page }).withTags([...WCAG_TAGS, "best-practice"]).analyze();
    // Contrast on scrolling <marquee> text depends on animation timing; the element is already reported by the `marquee` rule.
    const isMoving = (node) => node.target.flat().some((t) => /(^|[\s>])marquee\b/.test(t));
    for (const list of [axe.violations, axe.incomplete]) {
      for (const rule of list) if (rule.id === "color-contrast") rule.nodes = rule.nodes.filter((n) => !isMoving(n));
    }
    axe.violations = axe.violations.filter((r) => r.nodes.length);
    axe.incomplete = axe.incomplete.filter((r) => r.nodes.length);
    const custom = await runCustomChecks(page);

    const failures = [...axe.violations.filter((r) => isWcagRule(r.tags)).map(fromAxe), ...custom.failures];
    const advisories = [...axe.violations.filter((r) => !isWcagRule(r.tags)).map(fromAxe), ...custom.advisories];
    const needsReview = [...axe.incomplete.filter((r) => isWcagRule(r.tags)).map(fromAxe), ...custom.needsReview];

    const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
    failures.sort((a, b) => (order[a.impact] ?? 9) - (order[b.impact] ?? 9) || a.id.localeCompare(b.id));

    return {
      page: rel(absolute),
      testedAt: new Date().toISOString(),
      standard: "WCAG 2.2 Level A + AA",
      engine: { axeCore: axe.testEngine.version, customChecks: [...CUSTOM_CHECKS.map((c) => c.id), LINK_PURPOSE.id, KEYBOARD_REACH.id] },
      summary: {
        failedChecks: failures.length,
        failedElements: failures.reduce((n, f) => n + f.elements.length, 0),
        advisories: advisories.length,
        needsReview: needsReview.length,
        passedChecks: axe.passes.filter((r) => isWcagRule(r.tags)).length + custom.passed.length,
      },
      failures,
      advisories,
      needsReview,
    };
  } finally {
    await browser.close();
  }
}

/** Compact JSON for the model: keeps tokens (and therefore cost) down. */
export function toToolResult(results, maxElements = 5) {
  const shrink = (r) => ({
    id: r.id,
    wcag: r.wcag,
    level: r.level,
    impact: r.impact,
    help: r.help,
    elements: r.elements.slice(0, maxElements).map((e) => ({ target: e.target, html: clip(e.html, 140), why: clip(e.why, 180) })),
    ...(r.elements.length > maxElements ? { moreElements: r.elements.length - maxElements } : {}),
  });
  return JSON.stringify({
    page: results.page,
    standard: results.standard,
    summary: results.summary,
    failures: results.failures.map(shrink),
    advisories: results.advisories.map(shrink),
    needsReview: results.needsReview.map((r) => ({ id: r.id, wcag: r.wcag, help: r.help, count: r.elements.length })),
  });
}

export function printResults(results, { title = "Accessibility test" } = {}) {
  const line = "─".repeat(86);
  console.log(`\n${title}: ${results.page}  (${results.standard}, axe-core ${results.engine.axeCore} + custom checks)`);
  console.log(line);
  console.log(` ${"Check".padEnd(24)}${"WCAG".padEnd(14)}${"Level".padEnd(7)}${"Impact".padEnd(10)}${"Source".padEnd(10)}Elements`);
  console.log(line);
  for (const f of results.failures) {
    console.log(` ${f.id.padEnd(24)}${f.wcag.join(", ").padEnd(14)}${(f.level ?? "").padEnd(7)}${f.impact.padEnd(10)}${f.source.padEnd(10)}${f.elements.length}`);
  }
  if (!results.failures.length) console.log(" No WCAG 2.2 A/AA failures found.");
  if (results.advisories.length) {
    console.log(line);
    console.log(` Advisories (best practice): ${results.advisories.map((a) => `${a.id} (${a.elements.length})`).join(", ")}`);
  }
  if (results.needsReview.length) {
    console.log(` Needs manual review: ${results.needsReview.map((a) => `${a.id} (${a.elements.length})`).join(", ")}`);
  }
  console.log(line);
  const s = results.summary;
  console.log(` ${s.failedChecks} failing checks · ${s.failedElements} failing elements · ${s.advisories} advisories · ${s.passedChecks} checks passed`);
}
