// Lab 2: run the automated WCAG 2.2 A/AA test suite (axe-core + custom keyboard checks). No AI, no cost.
//   npm run test:a11y                 -> tests site/index.html, saves reports/a11y-latest.json
//   npm run test:a11y -- --label baseline
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { runAccessibilityTests, printResults } from "./lib/a11y-test.mjs";
import { REPORTS_DIR, ensureSite, rel } from "./lib/paths.mjs";

const { values } = parseArgs({ options: { label: { type: "string", default: "latest" }, file: { type: "string", default: "index.html" } } });

ensureSite();
const results = await runAccessibilityTests({ file: values.file });
printResults(results);

fs.mkdirSync(REPORTS_DIR, { recursive: true });
const out = path.join(REPORTS_DIR, `a11y-${values.label}.json`);
fs.writeFileSync(out, JSON.stringify(results, null, 2));
console.log(` Full results: ${rel(out)}\n`);
