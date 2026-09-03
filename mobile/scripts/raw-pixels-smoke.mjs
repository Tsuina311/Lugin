#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(mobileRoot, 'src/scan/rawPixelsToScanImage.ts');
const esbuild = await createRequire(join(mobileRoot, '..', 'package.json')).call(null, 'esbuild');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) return;
  failures++;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
};

const bundleDir = await mkdtemp(join(tmpdir(), 'lugin-raw-'));
const outfile = join(bundleDir, 'rawPixels.mjs');

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

  const { parsePixelOrder, rawPixelsToScanImage } = await import(pathToFileURL(outfile).href);

  check('parses BGRA', parsePixelOrder('BGRA') === 'bgra');
  check('rejects yuv', parsePixelOrder('yuv420') === null);

  const rgba = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 1, 2, 3, 255]);
  const img = rawPixelsToScanImage({
    bytes: rgba,
    height: 2,
    pixelOrder: 'rgba',
    width: 2,
  });
  check('rgba size', img.width === 2 && img.height === 2);
  check('rgba pixel 0', img.data[0] === 10 && img.data[1] === 20 && img.data[2] === 30);

  const bgra = new Uint8Array([30, 20, 10, 255]);
  const b = rawPixelsToScanImage({ bytes: bgra, height: 1, pixelOrder: 'bgra', width: 1 });
  check('bgra swaps to rgba', b.data[0] === 10 && b.data[2] === 30);

  const big = new Uint8Array(8 * 8 * 4);
  for (let i = 0; i < big.length; i += 4) {
    big[i] = 255;
    big[i + 3] = 255;
  }
  const small = rawPixelsToScanImage(
    { bytes: big, height: 8, pixelOrder: 'rgba', width: 8 },
    { maxLongEdge: 4 },
  );
  check('long-edge cap', small.width === 4 && small.height === 4);
  check('downscale keeps red', small.data[0] === 255);

  if (failures > 0) {
    console.error(`raw-pixels smoke: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('raw-pixels smoke ok');
} finally {
  await rm(bundleDir, { force: true, recursive: true });
}
