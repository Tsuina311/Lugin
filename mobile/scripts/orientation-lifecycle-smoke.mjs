#!/usr/bin/env node
/**
 * Pin the startup-orientation gate to the Samsung failure.
 *
 * Still phone, portrait-locked UI, landscape 640×480 buffer reporting
 * Frame.orientation 'up': that is the native default before outputOrientation
 * is assigned. Those frames must not reach the detector.
 *
 * After outputOrientation is 'up' (preview), the same buffer reports 'right'
 * and is coherent.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(mobileRoot, 'src/scan/orientationLifecycle.ts');
const esbuild = await createRequire(join(mobileRoot, '..', 'package.json')).call(null, 'esbuild');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) return;
  failures++;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
};

const bundleDir = await mkdtemp(join(tmpdir(), 'lugin-orient-'));
const outfile = join(bundleDir, 'orientationLifecycle.mjs');

try {
  await esbuild.build({
    bundle: true,
    entryPoints: [entry],
    format: 'esm',
    outfile,
    platform: 'neutral',
  });

  const {
    PORTRAIT_OUTPUT_ORIENTATION,
    detectorRotationLabel,
    isFrameCoherentWithOutput,
    resolveDesiredOutputOrientation,
  } = await import(pathToFileURL(outfile).href);

  check('portrait target is up', PORTRAIT_OUTPUT_ORIENTATION === 'up');
  check('undefined interface defaults to up', resolveDesiredOutputOrientation(undefined) === 'up');
  check('empty string defaults to up', resolveDesiredOutputOrientation('') === 'up');
  check('interface right is kept', resolveDesiredOutputOrientation('right') === 'right');

  // The Samsung startup frame: landscape buffer, metadata says already upright.
  check(
    'stale landscape+up is rejected for portrait output',
    isFrameCoherentWithOutput('up', 640, 480, 'up') === false,
  );
  check(
    'same buffer with Frame.orientation=right is accepted',
    isFrameCoherentWithOutput('up', 640, 480, 'right') === true,
  );
  check(
    'same buffer with Frame.orientation=left is accepted',
    isFrameCoherentWithOutput('up', 640, 480, 'left') === true,
  );

  // Already-rotated portrait buffer (physical rotation, or native upright).
  check(
    'portrait buffer + up is accepted',
    isFrameCoherentWithOutput('up', 480, 640, 'up') === true,
  );
  check(
    'portrait buffer claiming right is rejected',
    isFrameCoherentWithOutput('up', 480, 640, 'right') === false,
  );

  check(
    'rotation label mentions counter-rotate for right',
    detectorRotationLabel('right').includes('CCW'),
  );

  if (failures > 0) {
    console.error(`orientation-lifecycle smoke: ${failures} check(s) failed`);
    process.exit(1);
  }

  console.log('orientation-lifecycle smoke ok');
  console.log('  stale 640×480/up rejected; 640×480/right accepted; undefined interface → up');
} finally {
  await rm(bundleDir, { force: true, recursive: true });
}
