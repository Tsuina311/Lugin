#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(mobileRoot, 'src/scan/indexValidate.ts');
const esbuild = await createRequire(join(mobileRoot, '..', 'package.json')).call(null, 'esbuild');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) return;
  failures++;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
};

const bundleDir = await mkdtemp(join(tmpdir(), 'lugin-idx-'));
const outfile = join(bundleDir, 'indexValidate.mjs');

try {
  await esbuild.build({
    bundle: true,
    entryPoints: [entry],
    format: 'esm',
    outfile,
    platform: 'neutral',
    tsconfigRaw: {
      compilerOptions: { baseUrl: mobileRoot, paths: { '@/*': ['../src/*'] } },
    },
  });

  const { validateArtworkIndexData, validateNameIndexData } = await import(
    pathToFileURL(outfile).href
  );

  check('rejects empty names', Boolean(validateNameIndexData({ names: [], version: 1 }).reason));
  check(
    'accepts a minimal name index',
    !validateNameIndexData({ names: ['Sol Ring'], version: 1 }).reason,
  );
  check(
    'rejects printed pointer past names',
    Boolean(
      validateNameIndexData({
        names: ['Sol Ring'],
        printed: { fr: [[4, 'Anneau solaire']] },
        version: 1,
      }).reason,
    ),
  );

  const descriptor = {
    block: [1, 2, 3, 4],
    dhash: [1, 2],
    hue: [1, 2, 3, 4, 5, 6, 7, 8],
  };
  check(
    'accepts compact art descriptors',
    !validateArtworkIndexData({
      entries: [
        {
          descriptor,
          name: 'Sol Ring',
          oracleId: 'oracle:sol',
          scryfallId: 'sf',
        },
      ],
      version: 1,
    }).reason,
  );
  check(
    'rejects an image-shaped art payload',
    Boolean(validateArtworkIndexData({ entries: [{ name: 'x', imageUrl: 'http://x' }], version: 1 }).reason),
  );

  if (failures > 0) {
    console.error(`index-validate smoke: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('index-validate smoke ok');
} finally {
  await rm(bundleDir, { force: true, recursive: true });
}
