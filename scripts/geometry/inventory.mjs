#!/usr/bin/env node
/** yarn geometry:inventory — discover real scanner images for geometry fixtures. */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { scanInventory, summarizeInventory } from './lib/inventory.mjs';
import { CORPUS_ROOT } from './lib/paths.mjs';

const rows = await scanInventory();
const summary = summarizeInventory(rows);

await mkdir(CORPUS_ROOT, { recursive: true });
const outPath = join(CORPUS_ROOT, 'inventory.json');
await writeFile(
  outPath,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows }, null, 2)}\n`,
);

console.log('GEOMETRY INVENTORY');
console.log('─'.repeat(48));
console.log(`Unique source images:     ${summary.uniqueSourceImages}`);
console.log(`Card warps:               ${summary.cardWarps}`);
console.log(`Detector debug frames:    ${summary.detectorDebug}`);
console.log(`Duplicates (content key): ${summary.duplicatesSkipped}`);
console.log(`With recognition/track:   ${summary.withGeometryMetadata}`);
console.log(`Fixture candidates:       ${summary.geometryFixtureCandidates}`);
console.log(`Trusted annotations:      ${summary.trustedAnnotations}`);
console.log('\nBy source:');
for (const [k, v] of Object.entries(summary.bySource).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(18)} ${v}`);
}
console.log('\nDerived tags (only where metadata exists):');
const tags = Object.entries(summary.byTag).sort((a, b) => b[1] - a[1]);
if (!tags.length) console.log('  (none)');
for (const [k, v] of tags) console.log(`  ${k.padEnd(22)} ${v}`);
console.log('\nDimensions:');
for (const [k, v] of Object.entries(summary.dimensions).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(16)} ${v}`);
}
console.log(`\nWrote ${outPath}`);
console.log('Images are referenced in place — no giant file copies.');
