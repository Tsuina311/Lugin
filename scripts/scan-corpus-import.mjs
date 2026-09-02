#!/usr/bin/env node
// Import scanner corpus samples from a Drive download or export bundle into
// .scan-corpus/download/ for annotation.
//
//   yarn scan:corpus:import ./path/to/Scanner-Corpus
//   yarn scan:corpus:import ./lugin-scanner-corpus-2026-09-02.json
//
// Discovers samples recursively, validates metadata + JPEG/WebP magic,
// deduplicates by sampleId, and copies into the annotate --queue layout.

import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outRoot = join(root, '.scan-corpus', 'download');
const sourceArg = process.argv[2];

if (!sourceArg) {
  console.error('Usage: yarn scan:corpus:import <folder-or-export.json>');
  process.exit(1);
}

const source = resolve(sourceArg);

const dir = await mkdtemp(join(tmpdir(), 'lugin-corpus-import-'));
const bundle = join(dir, 'validate.mjs');
await esbuild.build({
  bundle: true,
  format: 'esm',
  outfile: bundle,
  platform: 'neutral',
  stdin: {
    contents: `export * from '${join(root, 'src/lib/scan/corpus/validate.ts')}';`,
    resolveDir: root,
    sourcefile: 'entry.ts',
  },
});
const { sniffImageMime, validateMetaStrict } = await import(pathToFileURL(bundle).href);

const seen = new Set();
let imported = 0;
let skipped = 0;
let invalid = 0;

const ensureDir = async path => mkdir(path, { recursive: true });

const writeSample = async (meta, imagePath) => {
  const err = validateMetaStrict(meta);
  if (err) {
    invalid += 1;
    console.warn(`  skip invalid meta (${err}): ${meta?.sampleId ?? '?'}`);
    return;
  }
  if (seen.has(meta.sampleId)) {
    skipped += 1;
    return;
  }
  seen.add(meta.sampleId);

  const dest = join(outRoot, meta.eventType, meta.sampleId);
  try {
    await stat(join(dest, 'meta.json'));
    skipped += 1;
    return;
  } catch {
    // not present yet
  }

  let imageBytes = null;
  let imageName = null;
  if (imagePath) {
    imageBytes = await readFile(imagePath);
    const mime = sniffImageMime(imageBytes);
    if (!mime) {
      invalid += 1;
      console.warn(`  skip bad image magic: ${imagePath}`);
      return;
    }
    imageName = mime === 'image/webp' ? 'image.webp' : 'image.jpg';
  }

  await ensureDir(dest);
  await writeFile(join(dest, 'meta.json'), JSON.stringify(meta, null, 2));
  if (imageBytes && imageName) {
    await writeFile(join(dest, imageName), imageBytes);
  }
  imported += 1;
  console.log(`  + ${meta.eventType}/${meta.sampleId}`);
};

const findSiblingImage = async dirPath => {
  const names = await readdir(dirPath);
  for (const n of ['image.jpg', 'image.jpeg', 'image.webp', 'frame.jpg']) {
    if (names.includes(n)) return join(dirPath, n);
  }
  return null;
};

const walk = async path => {
  const info = await stat(path);
  if (info.isFile()) {
    if (path.endsWith('.json') && basename(path) !== 'pulled.json') {
      const raw = JSON.parse(await readFile(path, 'utf8'));
      // Export bundle from the phone UI.
      if (raw?.schemaVersion === 1 && Array.isArray(raw.samples)) {
        for (const sample of raw.samples) {
          const meta = sample.meta;
          let imagePath = null;
          if (sample.imageBase64) {
            const tmpImg = join(dir, `${meta.sampleId}.bin`);
            await writeFile(tmpImg, Buffer.from(sample.imageBase64, 'base64'));
            imagePath = tmpImg;
          }
          await writeSample(meta, imagePath);
        }
        return;
      }
      // Single metadata.json / meta.json next to an image.
      if (raw?.sampleId && raw?.eventType) {
        await writeSample(raw, await findSiblingImage(dirname(path)));
      }
    }
    return;
  }

  const entries = await readdir(path);
  // Prefer metadata.json / meta.json at this level.
  const metaName = entries.find(n => n === 'metadata.json' || n === 'meta.json');
  if (metaName) {
    const meta = JSON.parse(await readFile(join(path, metaName), 'utf8'));
    await writeSample(meta, await findSiblingImage(path));
    return;
  }

  for (const name of entries) {
    if (name.startsWith('.')) continue;
    await walk(join(path, name));
  }
};

await ensureDir(outRoot);
console.log(`Importing from ${source}`);
await walk(source);
await writeFile(
  join(root, '.scan-corpus', 'pulled.json'),
  JSON.stringify({ ids: [...seen], importedAt: new Date().toISOString() }, null, 2),
);
await rm(dir, { force: true, recursive: true });

console.log(
  `\nDone. imported=${imported} skipped_dup=${skipped} invalid=${invalid} → ${outRoot}`,
);
console.log('Next: yarn scan:detect-annotate --queue');
