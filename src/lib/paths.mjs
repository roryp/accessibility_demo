import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SITE_DIR = path.join(ROOT, "site");
export const STARTER_SITE_DIR = path.join(ROOT, "starter", "site");
export const REPORTS_DIR = path.join(ROOT, "reports");

// One JSON line per model call (from `assistant.usage` events).
export const LEDGER_FILE = path.join(REPORTS_DIR, "usage-ledger.jsonl");
// One JSON line per workshop run (audit, fix, ...), with HydraFusion routing + totals.
export const RUNS_FILE = path.join(REPORTS_DIR, "runs.jsonl");

export function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join("/");
}

/** Creates the working copy of the website from starter/site the first time it is needed. */
export function ensureSite() {
  if (!fs.existsSync(path.join(SITE_DIR, "index.html"))) {
    fs.cpSync(STARTER_SITE_DIR, SITE_DIR, { recursive: true });
    console.log(`Created ${rel(SITE_DIR)}/ from ${rel(STARTER_SITE_DIR)}/`);
  }
}

/**
 * Real location of a path with symlinks/junctions resolved. For a path that does not exist yet (a new file),
 * the nearest existing parent is resolved; dangling links are followed so they cannot point outside unnoticed.
 */
export function canonicalPath(p) {
  let current = path.resolve(ROOT, p);
  const rest = [];
  for (let hops = 0; hops < 40; hops++) {
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink() && !fs.existsSync(current)) {
      current = path.resolve(path.dirname(current), fs.readlinkSync(current));
      continue;
    }
    if (stat) return path.join(fs.realpathSync.native(current), ...rest);
    const parent = path.dirname(current);
    if (parent === current) break;
    rest.unshift(path.basename(current));
    current = parent;
  }
  throw new Error(`Cannot resolve path: ${p}`);
}

/** True when `target` is `dir` or inside it, comparing real locations (case-insensitive on Windows). */
export function isInside(target, dir) {
  try {
    const r = path.relative(canonicalPath(dir), canonicalPath(target));
    return r === "" || (r !== ".." && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r));
  } catch {
    return false;
  }
}
