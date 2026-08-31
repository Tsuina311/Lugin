// Build a compact artwork (+ optional text) index from Scryfall bulk data.
//
//   yarn scan:art-index
//   node scripts/build-art-index.mjs --out dist-web/art-index.json --limit 500
//
// Downloads art_crop images temporarily, computes descriptors, and writes ONLY
// the compact index (no card imagery). Source images are never committed.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';

const root = new URL('..', import.meta.url).pathname;
const require = createRequire(import.meta.url);

const arg = name => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const out = arg('out') ?? join(root, '.scan-fixtures/art-index.json');
const limit = Number(arg('limit') ?? '0') || 0;
const fromFixtures = process.argv.includes('--from-fixtures');
const AGENT = 'Lugin/1.0 (+https://github.com/Tsuina311/Lugin)';
const BULK_INDEX = 'https://api.scryfall.com/bulk-data';
const MANIFEST = join(root, 'scripts/fixtures/cards.json');

// Bundle portable descriptor helpers for Node.
const { build } = await import(pathToFileURL(join(root, 'node_modules/esbuild/lib/main.js')).href);
const bundleDir = await mkdtemp(join(tmpdir(), 'lugin-art-'));
const entry = join(bundleDir, 'entry.ts');
await writeFile(
  entry,
  `export * from '${root}src/lib/scan/artwork/descriptors';
   export { tokenizeScanText } from '${root}src/lib/scan/text/evidence';
   export { ARTWORK_REGION } from '${root}src/lib/scan/regions';
   export { cropImage } from '${root}src/lib/scan/types';`,
);
const bundle = join(bundleDir, 'art.mjs');
await build({
  bundle: true,
  entryPoints: [entry],
  format: 'esm',
  outfile: bundle,
  platform: 'neutral',
  tsconfigRaw: { compilerOptions: { paths: { '@/*': [`${root}src/*`] } } },
});
const { describeArtwork, tokenizeScanText, ARTWORK_REGION, cropImage } = await import(
  pathToFileURL(bundle).href,
);

// pngjs for decoding art crops
const { PNG } = require('pngjs');

const fetchJson = async url => {
  const res = await fetch(url, { headers: { 'User-Agent': AGENT } });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
};

const defaultCardsUri = async () => {
  const { data } = await fetchJson(BULK_INDEX);
  const dump = data.find(d => d.type === 'default_cards');
  if (!dump) throw new Error('no default_cards dump');
  console.log(`default_cards ${(dump.compressed_size / 1e6).toFixed(0)} MB gzipped`);
  return dump.download_uri;
};

const toScanImage = png => {
  const { width, height, data } = png;
  // pngjs is RGBA already
  return { data: new Uint8ClampedArray(data), height, width };
};

const loadPng = async url => {
  const res = await fetch(url, { headers: { 'User-Agent': AGENT } });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return new Promise((resolve, reject) => {
    new PNG().parse(buf, (err, png) => (err ? reject(err) : resolve(png)));
  });
};

const seenArt = new Set();
const entries = [];
const textEntries = [];

/** Fixture-scoped index: prefer local PNGs, else Scryfall art_crop. */
const buildFromFixtures = async () => {
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  const cache = join(root, '.scan-fixtures');
  for (const row of manifest.cards ?? []) {
    const localPng = join(cache, `${row.id}.png`);
    let scanImg = null;
    if (existsSync(localPng)) {
      const png = await new Promise((resolve, reject) => {
        readFile(localPng).then(buf => {
          new PNG().parse(buf, (err, p) => (err ? reject(err) : resolve(p)));
        });
      });
      // Full card PNG → crop artwork region the same way the scanner does.
      scanImg = cropImage(toScanImage(png), ARTWORK_REGION);
    } else {
      const card = await fetchJson(`https://api.scryfall.com/cards/${row.id}`);
      const artUrl = card.image_uris?.art_crop ?? card.card_faces?.[0]?.image_uris?.art_crop;
      if (!artUrl) continue;
      const png = await loadPng(artUrl);
      if (!png) continue;
      scanImg = toScanImage(png);
      row._oracle = card.oracle_id;
      row._illustration = card.illustration_id;
      row._text = card.printed_text || card.oracle_text || '';
      row._set = card.set;
    }
    if (!scanImg) continue;
    const descriptor = describeArtwork(scanImg);
    entries.push({
      descriptor,
      illustrationId: row._illustration,
      name: row.expectedName,
      oracleId: row._oracle ?? `fixture:${row.id}`,
      scryfallId: row.id,
      setCode: row._set ?? row.set,
    });
    const text = row._text || '';
    if (text) {
      textEntries.push({
        name: row.expectedName,
        oracleId: row._oracle ?? `fixture:${row.id}`,
        tokens: [...new Set(tokenizeScanText(text))].slice(0, 40),
      });
    }
  }
};

if (fromFixtures) {
  await buildFromFixtures();
} else {
const uri = await defaultCardsUri();
const res = await fetch(uri, { headers: { 'User-Agent': AGENT } });
if (!res.ok || !res.body) throw new Error(`dump: ${res.status}`);
const lines = createInterface({
  crlfDelay: Infinity,
  input: Readable.fromWeb(res.body).pipe(createGunzip()),
});

let considered = 0;
for await (const line of lines) {
  if (!line.trim()) continue;
  let card;
  try {
    card = JSON.parse(line);
  } catch {
    continue;
  }
  if (card.digital) continue;
  if (card.layout === 'art_series' || card.layout === 'token') continue;
  if (card.oversized) continue;
  const artUrl = card.image_uris?.art_crop ?? card.card_faces?.[0]?.image_uris?.art_crop;
  if (!artUrl) continue;
  const illustrationId = card.illustration_id;
  const key = illustrationId || card.id;
  if (seenArt.has(key)) continue;
  seenArt.add(key);
  considered += 1;
  if (limit && entries.length >= limit) break;

  try {
    const png = await loadPng(artUrl);
    if (!png) continue;
    const descriptor = describeArtwork(toScanImage(png));
    entries.push({
      descriptor,
      illustrationId,
      name: card.name?.split(' // ')[0] ?? card.name,
      oracleId: card.oracle_id ?? `card:${card.id}`,
      scryfallId: card.id,
      setCode: card.set,
    });
    const text = card.printed_text || card.oracle_text || '';
    if (text && card.oracle_id) {
      textEntries.push({
        name: card.name?.split(' // ')[0] ?? card.name,
        oracleId: card.oracle_id,
        tokens: [...new Set(tokenizeScanText(text))].slice(0, 40),
      });
    }
    if (entries.length % 50 === 0) {
      console.log(`… ${entries.length} art entries`);
      await new Promise(r => setTimeout(r, 80)); // polite to CDN
    }
  } catch (err) {
    console.warn(`skip ${card.id}: ${err instanceof Error ? err.message : err}`);
  }
}
} // end bulk path

await mkdir(dirname(out), { recursive: true });
const payload = {
  art: { entries, generated: new Date().toISOString(), version: 1 },
  text: { entries: textEntries, version: 1 },
};
await writeFile(out, JSON.stringify(payload));
console.log(
  `wrote ${entries.length} artwork + ${textEntries.length} text entries → ${out} ` +
    `(${(Buffer.byteLength(JSON.stringify(payload)) / 1e6).toFixed(2)} MB)` +
    (fromFixtures ? ' [fixtures]' : ''),
);
await rm(bundleDir, { force: true, recursive: true });
