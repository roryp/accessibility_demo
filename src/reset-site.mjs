// Restores the broken starter website into ./site (run before the workshop, or to start over).
//   npm run reset          -> restore site/ only
//   npm run reset:all      -> restore site/ and clear reports/ (cost ledger, audit, fix summaries)
import fs from "node:fs";
import { SITE_DIR, STARTER_SITE_DIR, REPORTS_DIR, rel } from "./lib/paths.mjs";

fs.rmSync(SITE_DIR, { recursive: true, force: true });
fs.cpSync(STARTER_SITE_DIR, SITE_DIR, { recursive: true });
console.log(`Restored ${rel(SITE_DIR)}/ from ${rel(STARTER_SITE_DIR)}/`);

if (process.argv.includes("--reports")) {
  fs.rmSync(REPORTS_DIR, { recursive: true, force: true });
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  console.log(`Cleared ${rel(REPORTS_DIR)}/ (cost ledger and reports)`);
}
