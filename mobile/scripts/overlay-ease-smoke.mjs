#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(mobileRoot, 'src/scan/overlayEase.ts');
const esbuild = await createRequire(join(mobileRoot, '..', 'package.json')).call(null, 'esbuild');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) return;
  failures++;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
};

const quad = (x, y) => ({
  bottomLeft: { x, y: y + 100 },
  bottomRight: { x: x + 80, y: y + 100 },
  topLeft: { x, y },
  topRight: { x: x + 80, y },
});

const bundleDir = await mkdtemp(join(tmpdir(), 'lugin-ease-'));
const outfile = join(bundleDir, 'overlayEase.mjs');

try {
  await esbuild.build({
    bundle: true,
    entryPoints: [entry],
    format: 'esm',
    outfile,
    platform: 'neutral',
  });

  const { OVERLAY_STALE_MS, easeCorners, tickOverlay } = await import(
    pathToFileURL(outfile).href
  );

  const a = quad(0, 0);
  const b = quad(100, 0);
  const mid = easeCorners(a, b);
  check('eases toward the target', mid.topLeft.x > 0 && mid.topLeft.x < 100, String(mid.topLeft.x));
  check('does not overshoot', mid.topLeft.x < 100);

  let state = { display: null, targetAt: 0 };
  state = tickOverlay(state, b, 1000);
  check('first target snaps', state.display.topLeft.x === 100);
  state = tickOverlay(state, null, 1000 + 20);
  check('brief miss keeps the last display', state.display != null);
  state = tickOverlay(state, null, 1000 + OVERLAY_STALE_MS + 10);
  check('stale miss clears the polygon', state.display == null);

  if (failures > 0) {
    console.error(`overlay-ease smoke: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('overlay-ease smoke ok');
} finally {
  await rm(bundleDir, { force: true, recursive: true });
}
