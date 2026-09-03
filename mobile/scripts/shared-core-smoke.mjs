#!/usr/bin/env node
/**
 * Guard the native ↔ shared-scanner boundary.
 *
 * Bundles `mobile/src/scan/sharedCore.ts` for a *neutral* platform (no DOM
 * lib, no node builtins) and then actually runs detection + perspective warp
 * on a synthetic card frame. Two things fail loudly here rather than on the
 * phone:
 *
 *   1. a browser-only module sneaking into the shared import graph, and
 *   2. the portable pipeline not producing a card from an obvious card.
 *
 * Same esbuild technique the Node evaluation harness already uses to run
 * `src/lib/scan` outside a browser (see scripts/scan-eval.mjs).
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(mobileRoot, '..');
const entry = join(mobileRoot, 'src/scan/sharedCore.ts');

// esbuild lives in the workspace root devDependencies.
const esbuild = await createRequire(join(repoRoot, 'package.json')).call(
  null,
  'esbuild',
);

const fail = (msg) => {
  console.error(`shared-core smoke: ${msg}`);
  process.exit(1);
};

const bundleDir = await mkdtemp(join(tmpdir(), 'lugin-mobile-core-'));
const outfile = join(bundleDir, 'sharedCore.mjs');

try {
  await esbuild.build({
    bundle: true,
    entryPoints: [entry],
    format: 'esm',
    outfile,
    platform: 'neutral',
    // Mirror mobile/tsconfig.json so `@/…` resolves the same way Metro does.
    tsconfigRaw: {
      compilerOptions: {
        baseUrl: mobileRoot,
        paths: { '@/*': ['../src/*'] },
      },
    },
  });

  // 1. Portability guard. `performance` is allowed: detectCard.ts and
  // diagnostics.ts both guard it against Date.now().
  const code = readFileSync(outfile, 'utf8');
  const forbidden = [
    'document.createElement',
    'HTMLCanvasElement',
    'OffscreenCanvas',
    'getImageData',
    'createImageBitmap',
    'indexedDB',
    'localStorage',
    'sessionStorage',
    'navigator.mediaDevices',
    'chrome.storage',
    'chrome.runtime',
    'tesseract',
  ];
  const leaks = forbidden.filter((token) => code.includes(token));
  if (leaks.length) {
    fail(
      `browser-only code reached the shared scanner boundary: ${leaks.join(', ')}\n` +
        'Something imported from src/web or src/platform. Keep platform code in adapters.',
    );
  }

  // 2. Functional guard — a plainly visible card must be detected and warped.
  const core = await import(pathToFileURL(outfile).href);

  const frameW = 640;
  const frameH = 480;
  const frame = core.blankImage(frameW, frameH);
  const setPixel = (x, y, v) => {
    const i = (y * frameW + x) * 4;
    frame.data[i] = v;
    frame.data[i + 1] = v;
    frame.data[i + 2] = v;
    frame.data[i + 3] = 255;
  };
  for (let y = 0; y < frameH; y++) for (let x = 0; x < frameW; x++) setPixel(x, y, 18);

  // Card-shaped bright rectangle: 63:88 aspect, ~41% of the frame.
  const cardW = 300;
  const cardH = Math.round(cardW / core.CARD_ASPECT);
  const x0 = Math.round((frameW - cardW) / 2);
  const y0 = Math.round((frameH - cardH) / 2);
  for (let y = y0; y < y0 + cardH; y++) {
    for (let x = x0; x < x0 + cardW; x++) {
      // Mild texture so sharpness/variance are not degenerate.
      setPixel(x, y, 200 + ((x + y) % 12));
    }
  }

  const result = core.detectCardQuad(frame);
  if (!result.quad || !result.corners) {
    fail('detectCardQuad found no card in a synthetic card frame');
  }
  if (result.score < core.DETECT_MIN_SCORE) {
    fail(`detection score ${result.score.toFixed(3)} < DETECT_MIN_SCORE ${core.DETECT_MIN_SCORE}`);
  }

  const { topLeft, bottomRight } = result.corners;
  const tolerance = 24;
  const off =
    Math.abs(topLeft.x - x0) > tolerance ||
    Math.abs(topLeft.y - y0) > tolerance ||
    Math.abs(bottomRight.x - (x0 + cardW)) > tolerance ||
    Math.abs(bottomRight.y - (y0 + cardH)) > tolerance;
  if (off) {
    fail(
      `corners off by more than ${tolerance}px: ` +
        `got TL(${topLeft.x.toFixed(0)},${topLeft.y.toFixed(0)}) ` +
        `BR(${bottomRight.x.toFixed(0)},${bottomRight.y.toFixed(0)}), ` +
        `expected TL(${x0},${y0}) BR(${x0 + cardW},${y0 + cardH})`,
    );
  }

  const prepared = core.prepareCard(frame);
  if (!prepared.detected) fail('prepareCard did not report a detected card');
  if (prepared.image.width !== core.CARD_WIDTH || prepared.image.height !== core.CARD_HEIGHT) {
    fail(
      `normalized card is ${prepared.image.width}×${prepared.image.height}, ` +
        `expected ${core.CARD_WIDTH}×${core.CARD_HEIGHT}`,
    );
  }

  const quality = core.frameQualityScore(prepared.image, prepared.score);
  if (!Number.isFinite(quality.score)) fail('frameQualityScore returned a non-finite score');

  // The state machine must be constructible with no OCR and no indexes.
  const controller = core.createSessionController({ nameIndex: null });
  const snap = await controller.onFrame(frame);
  if (typeof snap.phase !== 'string') fail('session controller returned no phase');

  console.log('shared-core smoke ok');
  console.log(`  detect score ${result.score.toFixed(3)} · ${result.debug.ms.toFixed(1)}ms`);
  console.log(`  normalized   ${prepared.image.width}×${prepared.image.height}`);
  console.log(`  quality      ${quality.score.toFixed(3)} (sharpness ${quality.sharpness.toFixed(1)})`);
  console.log(`  phase        ${snap.phase}`);
} finally {
  await rm(bundleDir, { force: true, recursive: true });
}
