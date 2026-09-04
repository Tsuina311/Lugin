#!/usr/bin/env node
/**
 * Replay footer set+collector through the local PrintingIndex (no Scryfall HTTP).
 *
 *   node scripts/scan-footer-replay.mjs --set AFC --number 030 --expect "Chaos Dragon"
 *   node scripts/scan-footer-replay.mjs --set AFR --number 066 --expect "Pixie Guide" \
 *     --printing .scan-fixtures/printing-index.json
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = name => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const setCode = arg('set');
const number = arg('number');
const expectName = arg('expect');
let printingPath = arg('printing') ?? join(root, '.scan-fixtures/printing-index.json');

if (!setCode || !number) {
  console.error(
    'usage: node scripts/scan-footer-replay.mjs --set AFC --number 030 [--expect Name] [--printing path]',
  );
  process.exit(2);
}

if (!existsSync(printingPath)) {
  // Tiny offline fixture for CI / local without bulk download.
  printingPath = join(root, '.scan-fixtures/printing-index.fixture.json');
  await mkdir(dirname(printingPath), { recursive: true });
  await writeFile(
    printingPath,
    JSON.stringify({
      version: 1,
      generated: new Date().toISOString(),
      source: 'fixture',
      entries: [
        {
          setCode: 'afc',
          collectorNumber: '30',
          scryfallId: 'a04f46b4-b0b0-4aef-907f-1df1a2e261de',
          oracleId: 'chaos-dragon-oracle',
          name: 'Chaos Dragon',
          lang: 'en',
          finishes: ['nonfoil'],
          setName: 'Forgotten Realms Commander',
        },
        {
          setCode: 'afr',
          collectorNumber: '066',
          scryfallId: 'pixie-guide-scryfall',
          oracleId: 'pixie-guide-oracle',
          name: 'Pixie Guide',
          lang: 'en',
          finishes: ['nonfoil', 'foil'],
          setName: 'Adventures in the Forgotten Realms',
        },
      ],
    }),
  );
  console.log(`(using fixture ${printingPath})`);
}

const { build } = await import(pathToFileURL(join(root, 'node_modules/esbuild/lib/main.js')).href);
const bundleDir = await mkdtemp(join(tmpdir(), 'lugin-footer-'));
const entry = join(bundleDir, 'entry.ts');
await writeFile(
  entry,
  `export * from '${root}/src/lib/scan/printing/index.ts';
   export { parseCollectorParts } from '${root}/src/lib/scan/parseCollector.ts';`,
);
const outfile = join(bundleDir, 'footer.mjs');
await build({
  bundle: true,
  entryPoints: [entry],
  format: 'esm',
  outfile,
  platform: 'neutral',
});
const {
  buildPrintingIndex,
  lookupPrinting,
  uniqueOracle,
  uniquePrinting,
  parseCollectorParts,
} = await import(pathToFileURL(outfile).href);

const data = JSON.parse(await readFile(printingPath, 'utf8'));
const index = buildPrintingIndex(data);
const raw = `${setCode} ${number}`;
const parts = parseCollectorParts(raw);
const merged = {
  foilMarker: null,
  raw,
  setCode: parts.setCode ?? setCode,
  collectorNumber: parts.collectorNumber ?? number,
};
const hit = lookupPrinting(index, merged);
console.log(`index entries ${index.recordCount} version ${index.version}`);
console.log(`parsed set=${merged.setCode} number=${merged.collectorNumber}`);
if (!hit) {
  console.log('PrintingIndex: NO HIT');
  process.exit(1);
}
console.log(`key ${hit.key} · candidates ${hit.candidates.length} · variants ${hit.variantsTried}`);
hit.candidates.slice(0, 8).forEach((c, i) => {
  console.log(
    `${i + 1}. ${c.name} · ${c.setCode.toUpperCase()} #${c.collectorNumber} · ${c.lang} · ${c.scryfallId}`,
  );
});
const u = uniquePrinting(hit) ?? uniqueOracle(hit);
if (u) {
  console.log(`unique → ${u.name} · ${u.setCode.toUpperCase()} #${u.collectorNumber}`);
}
if (expectName) {
  const ok = hit.candidates.some(c => c.name.toLowerCase() === expectName.toLowerCase());
  console.log(`expect "${expectName}": ${ok ? 'OK' : 'MISS'}`);
  if (!ok) process.exit(1);
}
await rm(bundleDir, { force: true, recursive: true });
