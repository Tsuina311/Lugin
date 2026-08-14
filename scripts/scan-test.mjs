// Parser tests for the phone scanner — no camera required.

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(join(tmpdir(), 'lugin-scan-'));
const bundle = join(dir, 'scan.mjs');

await esbuild.build({
  bundle: true,
  format: 'esm',
  outfile: bundle,
  platform: 'neutral',
  stdin: {
    contents: `
      export * from '${join(root, 'src/lib/scan/parseCollector.ts')}';
      export * from '${join(root, 'src/lib/scan/foil.ts')}';
    `,
    resolveDir: root,
    sourcefile: 'entry.ts',
  },
});

const {
  bestName,
  guessFoil,
  mergeParts,
  mergePartsForScan,
  parseCollectorLine,
  parseCollectorParts,
  parseSetSymbolText,
  tidyName,
} = await import(pathToFileURL(bundle).href);

let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(err);
  }
};

check('modern collector line with foil star', () => {
  const p = parseCollectorLine('0123 ★ DMU EN');
  assert.equal(p?.setCode, 'DMU');
  assert.equal(p?.collectorNumber, '0123');
  assert.equal(p?.foilMarker, true);
});

check('modern collector line with non-foil bullet', () => {
  const p = parseCollectorLine('0042 • NEO • EN');
  assert.equal(p?.setCode, 'NEO');
  assert.equal(p?.collectorNumber, '0042');
  assert.equal(p?.foilMarker, false);
});

check('classic CMR-style number over set', () => {
  const p = parseCollectorLine('286/361 R CMR');
  assert.equal(p?.setCode, 'CMR');
  assert.equal(p?.collectorNumber, '286');
});

check('partial number-only pass is kept', () => {
  const p = parseCollectorParts('286/361');
  assert.equal(p.collectorNumber, '286');
  assert.equal(p.setCode, undefined);
});

check('partial set-only pass is kept', () => {
  const p = parseCollectorParts('CMR');
  assert.equal(p.setCode, 'CMR');
});

check('merge fills gaps across snaps', () => {
  const merged = mergeParts(
    parseCollectorParts('286/361'),
    parseCollectorParts('CMR'),
  );
  assert.equal(merged.collectorNumber, '286');
  assert.equal(merged.setCode, 'CMR');
});

check('name-first ignores bare set codes', () => {
  const merged = mergePartsForScan(
    { foilMarker: null, raw: '' },
    parseCollectorParts('DUS'),
    { nameLocked: false },
  );
  assert.equal(merged.setCode, undefined);
});

check('name-first still keeps classic number', () => {
  const merged = mergePartsForScan(
    { foilMarker: null, raw: '' },
    parseCollectorParts('286/361'),
    { nameLocked: false },
  );
  assert.equal(merged.collectorNumber, '286');
});

check('tidyName prefers the title line', () => {
  assert.equal(tidyName('Liesa, Shroud of Dusk\nLegendary Creature'), 'Liesa, Shroud of Dusk');
});

check('tidyName joins a wrapped subtitle', () => {
  assert.equal(
    tidyName('Living Lightning,\nCharged Up'),
    'Living Lightning, Charged Up',
  );
});

check('bestName picks the longer title pass', () => {
  assert.equal(bestName('Lie', 'Liesa, Shroud of Dusk'), 'Liesa, Shroud of Dusk');
});

check('set symbol OCR reads M11', () => {
  assert.equal(parseSetSymbolText('M11'), 'M11');
  assert.equal(parseSetSymbolText('M 11'), 'M11');
});

check('classic bottom number without set text', () => {
  const p = parseCollectorParts('134/249');
  assert.equal(p.collectorNumber, '134');
});

check('tidyName keeps French accents', () => {
  assert.equal(tidyName('Léonin, Protecteur'), 'Léonin, Protecteur');
});

check('noise does not invent a full card', () => {
  assert.equal(parseCollectorLine('hello world'), null);
});

check('foil star wins over image stats', () => {
  const g = guessFoil({ foilMarker: true }, null);
  assert.equal(g.foil, true);
  assert.ok(g.confidence >= 0.9);
});

check('bullet means non-foil even if the strip looks shiny', () => {
  const g = guessFoil(
    { foilMarker: false },
    { brightRatio: 0.2, colorVariance: 0.4, darkRatio: 0.1, midtoneRatio: 0.6 },
  );
  assert.equal(g.foil, false);
});

await rm(dir, { force: true, recursive: true });
if (failed) {
  console.error(`\n${failed} scan check(s) failed`);
  process.exit(1);
}
console.log('\nall scan checks passed');
