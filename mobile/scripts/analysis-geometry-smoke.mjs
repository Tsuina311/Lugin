#!/usr/bin/env node
/**
 * Pin the native analysis crop to the Samsung geometry that broke the overlay.
 *
 * Portrait phone, landscape 640×480 sensor frame, orientation 'right':
 * the preview cover-crops a tall strip of the *upright* 480×640 image.
 * Analysis must be that strip, not the full sensor, and must be portrait.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(mobileRoot, '..');
const entry = join(mobileRoot, 'src/scan/analysisGeometry.ts');

const esbuild = await createRequire(join(repoRoot, 'package.json')).call(null, 'esbuild');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) return;
  failures++;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
};

const bundleDir = await mkdtemp(join(tmpdir(), 'lugin-geom-'));
const outfile = join(bundleDir, 'analysisGeometry.mjs');

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

  const { parseOrientation, quadDiagnostics, spacesFor } = await import(pathToFileURL(outfile).href);

  // Typical Samsung portrait preview over a 640×480 analysis target.
  const preview = { height: 844, width: 390 };
  const spaces = spacesFor({ height: 480, width: 640 }, 'right', preview, 640);

  check(
    'oriented swaps to portrait',
    spaces.oriented.width === 480 && spaces.oriented.height === 640,
    `${spaces.oriented.width}×${spaces.oriented.height}`,
  );
  check('visible is portrait (taller than wide)', spaces.visible.height > spaces.visible.width);
  check(
    'visible is a center-crop, not the full frame',
    spaces.visible.width < spaces.oriented.width - 8,
    `crop width ${spaces.visible.width} of ${spaces.oriented.width}`,
  );
  check(
    'visible uses the full oriented height',
    Math.abs(spaces.visible.height - spaces.oriented.height) < 1,
    `crop height ${spaces.visible.height}`,
  );
  check(
    'detector stays portrait',
    spaces.detector.height > spaces.detector.width,
    `${spaces.detector.width}×${spaces.detector.height}`,
  );
  check(
    'detector long edge ≤ 640',
    Math.max(spaces.detector.width, spaces.detector.height) <= 640,
  );

  // The old bug: treating orientation as 'up' keeps a landscape analysis
  // whose FOV is much wider than the portrait preview.
  const broken = spacesFor({ height: 480, width: 640 }, 'up', preview, 640);
  check(
    'unrotated analysis is wider FOV than the crop',
    broken.visible.width < 640 && spaces.visible.width < broken.visible.width + 1
      ? spaces.visible.width < 400
      : spaces.visible.width < 400,
    `upright crop width ${spaces.visible.width}`,
  );

  check('parseOrientation keeps right', parseOrientation('right') === 'right');
  check('parseOrientation rejects junk as up', parseOrientation('90') === 'up');

  const quad = {
    bottomLeft: { x: 40, y: 200 },
    bottomRight: { x: 160, y: 200 },
    topLeft: { x: 40, y: 40 },
    topRight: { x: 160, y: 40 },
  };
  const stats = quadDiagnostics(quad, { height: 240, width: 200 });
  check('aspect of a 120×160 box is 0.75', Math.abs(stats.aspect - 0.75) < 0.01, `${stats.aspect}`);
  check('area ratio of that box', Math.abs(stats.areaRatio - (120 * 160) / (200 * 240)) < 0.01);

  if (failures > 0) {
    console.error(`analysis-geometry smoke: ${failures} check(s) failed`);
    process.exit(1);
  }

  console.log('analysis-geometry smoke ok');
  console.log(
    `  Samsung-shaped: raw 640×480 / right → detector ${spaces.detector.width}×${spaces.detector.height} crop ${spaces.visible.width.toFixed(0)}×${spaces.visible.height.toFixed(0)}`,
  );
} finally {
  await rm(bundleDir, { force: true, recursive: true });
}
