// Print the last combo-index build. Run `yarn combos:update` first.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const path = join(
  root,
  "generated",
  "commander-combos",
  "commander-combos-build-report.json",
);

let report;
try {
  report = JSON.parse(await readFile(path, "utf8"));
} catch {
  console.error("No combo index. Run yarn combos:update.");
  process.exit(1);
}

const kb = n => `${(n / 1024).toFixed(1)} KB`;
console.log(
  `Commander Spellbook ${report.sourceVersion} · ${report.generatedAt}`,
);
console.log(`Source variants: ${report.sourceVariants}`);
console.log(`Exactly two-card, status OK: ${report.twoCardVariants}`);
console.log(`Commander-legal: ${report.commanderLegal}`);
console.log(`Unique oracle pairs: ${report.uniquePairs}`);
console.log(`Pairs with more than one variant: ${report.duplicateVariants}`);
console.log(`Commander-dependent variants: ${report.commanderDependent}`);
console.log(`Missing oracle ids: ${report.missingOracleIds}`);
console.log(
  `Skipped: ${report.skipped} ${JSON.stringify(report.failureReasons)}`,
);
console.log(`Tags: ${JSON.stringify(report.tagCounts)}`);
console.log(`Runtime: ${kb(report.runtimeBytes)}`);
console.log(`SHA-256 runtime content: ${report.sha256.runtime}`);
