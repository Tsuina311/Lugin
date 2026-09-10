import { existsSync } from 'node:fs';
import { readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  assignSplits,
  ensureCorpusDirs,
  listFixtures,
  saveFixture,
  writeManifest,
  writeSplits,
} from './lib/corpus.mjs';
import { inventoryRowToFixtureDraft, scanInventory } from './lib/inventory.mjs';
import { CORPUS_ROOT, FIXTURES_DIR } from './lib/paths.mjs';
import { fixtureUsableForGeometry } from './lib/schema.mjs';

const force = process.argv.includes('--force');
const sourcesOnly = !process.argv.includes('--include-warps');
const prune = process.argv.includes('--prune');

await ensureCorpusDirs();

let rows;
const invPath = join(CORPUS_ROOT, 'inventory.json');
if (existsSync(invPath) && !process.argv.includes('--rescan')) {
  rows = JSON.parse(await readFile(invPath, 'utf8')).rows;
  console.log(`Using cached inventory (${rows.length} rows). Pass --rescan to refresh.`);
} else {
  rows = await scanInventory();
  await writeFile(
    invPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2)}\n`,
  );
}

const existing = new Map((await listFixtures()).map(f => [f.id, f]));
let written = 0;
let skipped = 0;
const keepIds = new Set();

for (const row of rows) {
  if (sourcesOnly && row.role !== 'source') continue;
  if (row.duplicateOf) continue;
  const draft = inventoryRowToFixtureDraft(row);
  if (!draft) continue;
  const use = fixtureUsableForGeometry(draft);
  // Keep candidates without quads too (swap-test) so Lab can annotate.
  if (!use.ok && draft.source !== 'swap-test') {
    skipped += 1;
    continue;
  }
  keepIds.add(draft.id);
  if (existing.has(draft.id) && !force) {
    // Preserve manual edits.
    const prev = existing.get(draft.id);
    if (prev.trusted || prev.cards?.some(c => c.groundTruthSource === 'manually-reviewed')) {
      skipped += 1;
      continue;
    }
  }
  await saveFixture(draft);
  written += 1;
}

let pruned = 0;
if (prune && existsSync(FIXTURES_DIR)) {
  for (const name of await readdir(FIXTURES_DIR)) {
    if (!name.endsWith('.json')) continue;
    const id = name.replace(/\.json$/, '');
    if (keepIds.has(id)) continue;
    const prev = existing.get(id);
    // Never prune manually trusted fixtures.
    if (prev?.trusted || prev?.cards?.some(c => c.groundTruthSource === 'manually-reviewed')) {
      keepIds.add(id);
      continue;
    }
    await unlink(join(FIXTURES_DIR, name));
    pruned += 1;
  }
}

const all = await listFixtures();
const splitResult = assignSplits(all);
const splits = await writeSplits(all, splitResult);
const manifest = await writeManifest(all);

console.log('GEOMETRY BOOTSTRAP');
console.log('─'.repeat(48));
console.log(`Fixtures written/updated: ${written}`);
console.log(`Skipped:                  ${skipped}`);
console.log(`Pruned stale:             ${pruned}`);
console.log(`Total fixtures:           ${manifest.fixtureCount}`);
console.log(`Usable (have quad/neg):   ${manifest.usableCount}`);
console.log(`Trusted for eval:         ${manifest.trustedCount}`);
console.log(`Hard regression flagged:  ${manifest.hardRegressionCount}`);
console.log(
  `Splits: train=${splits.train.length} val=${splits.validation.length} test=${splits.test.length} hard=${splits.hard.length}`,
);
console.log(`\n${splits.policy?.note ?? ''}`);
console.log('\nProvenance: existing recognition/snapshot quads are bootstrap only.');
console.log('Mark trusted via Geometry Lab (manually-reviewed) before hard gates.');
if (!prune) {
  console.log('Tip: yarn geometry:bootstrap --prune removes stale pre-rename fixture ids.');
}
