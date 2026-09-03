#!/usr/bin/env node
/**
 * Detector → hi-res mapping must go through normalized FOV, never screen pixels.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(mobileRoot, 'src/scan/hiresMap.ts');
const esbuild = await createRequire(join(mobileRoot, '..', 'package.json')).call(null, 'esbuild');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) return;
  failures++;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
};

const bundleDir = await mkdtemp(join(tmpdir(), 'lugin-hires-'));
const outfile = join(bundleDir, 'hiresMap.mjs');

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
    fromNorm,
    mapCornersToHiRes,
    mapDetectorToHiRes,
    mapDetectorToOrientedSource,
    mapSameFov,
    mirrorX,
    scaleVisibleRect,
    toNorm,
  } = await import(pathToFileURL(outfile).href);

  const detector = { height: 640, width: 296 };
  const mid = { x: 148, y: 320 };
  const n = toNorm(mid, detector);
  check('center is ~0.5,0.5', Math.abs(n.x - 0.5) < 1e-6 && Math.abs(n.y - 0.5) < 1e-6);
  const back = fromNorm(n, detector);
  check('fromNorm inverts toNorm', Math.abs(back.x - mid.x) < 1e-6 && Math.abs(back.y - mid.y) < 1e-6);

  const dest = { height: 1280, width: 592 };
  const scaled = mapSameFov(mid, detector, dest);
  check(
    'same-FOV center stays centered',
    Math.abs(scaled.x - 296) < 1e-6 && Math.abs(scaled.y - 640) < 1e-6,
    `${scaled.x},${scaled.y}`,
  );

  // Samsung-shaped: detector is the cover-crop of oriented 480×640.
  const oriented = { height: 640, width: 480 };
  const visible = { height: 640, width: 296, x: 92, y: 0 };
  const hires = { height: 4000, width: 3000 };
  const tl = mapDetectorToOrientedSource({ x: 0, y: 0 }, detector, visible, oriented, hires);
  check(
    'detector TL maps to visible origin in hi-res',
    Math.abs(tl.x - (92 / 480) * 3000) < 0.5 && Math.abs(tl.y) < 0.5,
    `${tl.x},${tl.y}`,
  );
  const br = mapDetectorToOrientedSource(
    { x: 296, y: 640 },
    detector,
    visible,
    oriented,
    hires,
  );
  check(
    'detector BR maps to visible far corner',
    Math.abs(br.x - ((92 + 296) / 480) * 3000) < 0.5 && Math.abs(br.y - 4000) < 0.5,
    `${br.x},${br.y}`,
  );

  const flipped = mirrorX({ x: 10, y: 20 }, { height: 100, width: 80 });
  check('mirrorX flips about vertical axis', flipped.x === 70 && flipped.y === 20);

  const scaledVis = scaleVisibleRect(visible, oriented, hires);
  check(
    'visible scales onto hi-res oriented',
    Math.abs(scaledVis.x - 575) < 0.5 && Math.abs(scaledVis.width - 1850) < 0.5,
    JSON.stringify(scaledVis),
  );

  const via = mapDetectorToHiRes({ x: 0, y: 0 }, {
    dest: hires,
    destMirrored: false,
    detector,
    kind: 'oriented-full',
    oriented,
    visible,
  });
  check('mapDetectorToHiRes matches oriented-full TL', Math.abs(via.x - tl.x) < 1e-6);

  const mirrored = mapDetectorToHiRes({ x: 0, y: 0 }, {
    dest: hires,
    destMirrored: true,
    detector,
    kind: 'oriented-full',
    oriented,
    visible,
  });
  check(
    'mirrored dest flips X only',
    Math.abs(mirrored.x - (hires.width - tl.x)) < 0.5 && Math.abs(mirrored.y - tl.y) < 0.5,
  );

  const same = mapCornersToHiRes(
    {
      bottomLeft: { x: 0, y: 640 },
      bottomRight: { x: 296, y: 640 },
      topLeft: { x: 0, y: 0 },
      topRight: { x: 296, y: 0 },
    },
    { dest: { height: 1280, width: 592 }, detector, kind: 'same-fov' },
  );
  check('same-fov TR lands at dest TR', same.topRight.x === 592 && same.topRight.y === 0);

  if (failures > 0) {
    console.error(`hires-map smoke: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('hires-map smoke ok');
} finally {
  await rm(bundleDir, { force: true, recursive: true });
}
