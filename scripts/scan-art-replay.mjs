#!/usr/bin/env node
/**
 * Replay a 744×1039 recognition-input PNG through the Node artwork matcher.
 *
 *   node scripts/scan-art-replay.mjs --image /path/to/card.png --art-index dist-web/art-index.json
 *   node scripts/scan-art-replay.mjs --image card.png --expect "Chaos Dragon"
 *
 * Isolates mobile image/descriptor quality vs index/runtime bugs.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

const arg = name => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const imagePath = arg('image');
const artPath = arg('art-index') ?? join(root, '.scan-fixtures/art-index.json');
const expectName = arg('expect');

if (!imagePath) {
  console.error('usage: node scripts/scan-art-replay.mjs --image card.png [--art-index path] [--expect Name]');
  process.exit(2);
}

const { build } = await import(pathToFileURL(join(root, 'node_modules/esbuild/lib/main.js')).href);
const bundleDir = await mkdtemp(join(tmpdir(), 'lugin-replay-'));
const entry = join(bundleDir, 'entry.ts');
await writeFile(
  entry,
  `export { describeArtwork } from '${root}/src/lib/scan/artwork/descriptors.ts';
   export { createArtworkMatcher } from '${root}/src/lib/scan/artwork/match.ts';
   export { ARTWORK_REGION } from '${root}/src/lib/scan/regions.ts';
   export { cropImage } from '${root}/src/lib/scan/types.ts';`,
);
const outfile = join(bundleDir, 'replay.mjs');
await build({
  bundle: true,
  entryPoints: [entry],
  format: 'esm',
  outfile,
  platform: 'neutral',
});
const { describeArtwork, createArtworkMatcher, ARTWORK_REGION, cropImage } = await import(
  pathToFileURL(outfile).href,
);

const buf = await readFile(imagePath);
let width;
let height;
let data;
if (buf[0] === 0x89) {
  const png = PNG.sync.read(buf);
  width = png.width;
  height = png.height;
  data = png.data;
} else {
  const decoded = jpeg.decode(buf, { useTArray: true });
  width = decoded.width;
  height = decoded.height;
  data = decoded.data;
}

const card = { data: new Uint8ClampedArray(data), height, width };
const artIndex = JSON.parse(await readFile(artPath, 'utf8'));
const payload = artIndex.art ?? artIndex;
console.log(`image ${width}×${height}`);
console.log(`art index entries ${payload.entries?.length ?? 0} version ${payload.version} generated ${payload.generated ?? '—'}`);

const artCrop = cropImage(card, ARTWORK_REGION);
const descriptor = describeArtwork(artCrop);
const matcher = createArtworkMatcher(payload);
const hits = matcher.findCandidates(descriptor, 8);
hits.forEach((h, i) => {
  console.log(`${i + 1}. ${h.name} — ${h.visualScore.toFixed(3)} (${h.oracleId})`);
});

if (expectName) {
  const rank = hits.findIndex(h => h.name.toLowerCase() === expectName.toLowerCase());
  console.log(`expect "${expectName}": ${rank >= 0 ? `rank ${rank + 1}` : 'ABSENT from top candidates'}`);
  const inIndex = (payload.entries ?? []).filter(e => e.name.toLowerCase() === expectName.toLowerCase());
  console.log(`index coverage for expect: ${inIndex.length} descriptor(s)`);
}

await rm(bundleDir, { force: true, recursive: true });
