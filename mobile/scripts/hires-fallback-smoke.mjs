#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(mobileRoot, 'src/scan/hiresCapture.ts');
const esbuild = await createRequire(join(mobileRoot, '..', 'package.json')).call(null, 'esbuild');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) return;
  failures++;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
};

const bundleDir = await mkdtemp(join(tmpdir(), 'lugin-fb-'));
const outfile = join(bundleDir, 'hiresCapture.mjs');

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

  const {
    emptyHiResStore,
    isTrueHiRes,
    putFallback,
    refineFromStore,
  } = await import(pathToFileURL(outfile).href);

  check('photo is true hi-res', isTrueHiRes('photo') === true);
  check('snapshot is true hi-res', isTrueHiRes('snapshot') === true);
  check('analysis-fallback is not labeled high-res', isTrueHiRes('analysis-fallback') === false);

  const store = emptyHiResStore();
  check('empty refine is null, not a silent warp', refineFromStore(store) === null);

  const analysis = {
    data: new Uint8ClampedArray(4 * 4 * 4),
    height: 4,
    width: 4,
  };
  const corners = {
    bottomLeft: { x: 0, y: 3 },
    bottomRight: { x: 3, y: 3 },
    topLeft: { x: 0, y: 0 },
    topRight: { x: 3, y: 0 },
  };
  const prepared = putFallback(store, analysis, corners, 0.9);
  check('fallback is canonical 744×1039', prepared.image.width === 744 && prepared.image.height === 1039);
  check('fallback mode is labeled', store.lastAttempt.mode === 'analysis-fallback');
  check('refine then returns the fallback cache', refineFromStore(store) === prepared);

  if (failures > 0) {
    console.error(`hires-fallback smoke: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('hires-fallback smoke ok');
} finally {
  await rm(bundleDir, { force: true, recursive: true });
}
