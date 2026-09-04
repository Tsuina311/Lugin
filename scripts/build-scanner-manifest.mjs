#!/usr/bin/env node
/**
 * Build scanner-manifest.json next to card-names.json + art-index.json.
 *
 *   node scripts/build-scanner-manifest.mjs \
 *     --names dist-web/card-names.json \
 *     --art dist-web/art-index.json \
 *     --out dist-web/scanner-manifest.json \
 *     --base-url https://tsuina311.github.io/Lugin/
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const arg = name => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const namesPath = arg('names') ?? join(root, 'dist-web/card-names.json');
const artPath = arg('art') ?? join(root, 'dist-web/art-index.json');
const printingPath = arg('printing');
const outPath = arg('out') ?? join(root, 'dist-web/scanner-manifest.json');
const baseUrl = (arg('base-url') ?? 'https://tsuina311.github.io/Lugin/').replace(/\/?$/, '/');

const sha256 = buf => createHash('sha256').update(buf).digest('hex');

const asset = async (path, urlName, recordCount) => {
  const buf = await readFile(path);
  const gz = gzipSync(buf);
  const json = JSON.parse(buf.toString('utf8'));
  const version =
    json.generated ??
    json.art?.generated ??
    json.version?.toString?.() ??
    new Date().toISOString();
  return {
    sha256: sha256(buf),
    bytes: buf.length,
    compressedBytes: gz.length,
    url: `${baseUrl}${urlName}`,
    version: String(version),
    recordCount,
  };
};

const namesBuf = await readFile(namesPath);
const namesJson = JSON.parse(namesBuf.toString('utf8'));
const artBuf = await readFile(artPath);
const artJson = JSON.parse(artBuf.toString('utf8'));
const artEntries = artJson.art?.entries ?? artJson.entries ?? [];

const printedCount = Object.values(namesJson.printed ?? {}).reduce(
  (n, list) => n + (Array.isArray(list) ? list.length : 0),
  0,
);

const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceUpdatedAt: namesJson.generated ?? artJson.generated ?? artJson.art?.generated ?? null,
  cardNames: await asset(namesPath, 'card-names.json', namesJson.names?.length ?? 0),
  artIndex: await asset(artPath, 'art-index.json', artEntries.length),
  _meta: {
    localizedPrintedNames: printedCount,
    namesFile: basename(namesPath),
    artFile: basename(artPath),
    namesBytes: (await stat(namesPath)).size,
    artBytes: (await stat(artPath)).size,
  },
};

if (printingPath) {
  const printingBuf = await readFile(printingPath);
  const printingJson = JSON.parse(printingBuf.toString('utf8'));
  manifest.printingIndex = await asset(
    printingPath,
    'printing-index.json',
    printingJson.entries?.length ?? 0,
  );
  manifest._meta.printingFile = basename(printingPath);
  manifest._meta.printingBytes = (await stat(printingPath)).size;
  if (printingJson.sourceUpdatedAt) {
    manifest.sourceUpdatedAt = printingJson.sourceUpdatedAt;
  }
}

await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${outPath}`);
console.log(
  `cardNames ${manifest.cardNames.recordCount} · art ${manifest.artIndex.recordCount}` +
    (manifest.printingIndex
      ? ` · printing ${manifest.printingIndex.recordCount}`
      : ' · printing (omitted)') +
    ` · gz names ${(manifest.cardNames.compressedBytes / 1024).toFixed(0)} KB · ` +
    `gz art ${(manifest.artIndex.compressedBytes / 1024).toFixed(0)} KB`,
);
