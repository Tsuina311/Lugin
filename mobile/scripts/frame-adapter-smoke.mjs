#!/usr/bin/env node
/**
 * Unit-test the VisionCamera frame → `ScanImage` adapter.
 *
 * `frameToScanImage` corrects three things that all fail *quietly*: BGRA vs
 * RGBA channel order, row padding (`bytesPerRow` > width*4), and sensor
 * rotation. None of them crash — they just make detection slightly worse,
 * which is indistinguishable from "the detector needs tuning" and would send
 * the C.2 measurement chasing the wrong bottleneck. So they get asserted here
 * against synthetic buffers with known answers, on the dev machine, rather
 * than eyeballed on a phone.
 *
 * Bundled with the same esbuild-for-a-neutral-platform trick as
 * `shared-core-smoke.mjs`, since the adapter imports the shared `ScanImage`.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(mobileRoot, '..');
const entry = join(mobileRoot, 'src/scan/frameToScanImage.ts');

const esbuild = await createRequire(join(repoRoot, 'package.json')).call(null, 'esbuild');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) return;
  failures++;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
};

const bundleDir = await mkdtemp(join(tmpdir(), 'lugin-frame-adapter-'));
const outfile = join(bundleDir, 'frameToScanImage.mjs');

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

  const { analysisSize, frameToScanImage, imageBrightness, pixelOrderFor, validateFrameView } =
    await import(pathToFileURL(outfile).href);

  /**
   * Build a padded frame buffer whose every pixel encodes its own coordinates,
   * so a wrong read is provable rather than merely suspicious.
   * Red = x, green = y, blue = 200.
   */
  const makeFrame = (width, height, { order = 'bgra', pad = 0 } = {}) => {
    const bytesPerRow = width * 4 + pad;
    const bytes = new Uint8Array(bytesPerRow * height).fill(7); // padding sentinel
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * bytesPerRow + x * 4;
        const [r, g, b] = [x, y, 200];
        if (order === 'bgra') {
          bytes[i] = b;
          bytes[i + 1] = g;
          bytes[i + 2] = r;
        } else {
          bytes[i] = r;
          bytes[i + 1] = g;
          bytes[i + 2] = b;
        }
        bytes[i + 3] = 128; // alpha the adapter must ignore
      }
    }
    return { bytes, bytesPerRow, height, isMirrored: false, orientation: 'up', pixelOrder: order, width };
  };

  const pixel = (img, x, y) => {
    const i = (y * img.width + x) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
  };

  // 1. Channel order. A BGRA frame read as RGBA silently swaps R and B, which
  //    shifts luma (0.299R vs 0.114B) and every downstream hue descriptor.
  {
    const img = frameToScanImage(makeFrame(8, 4, { order: 'bgra' }));
    const [r, g, b, a] = pixel(img, 5, 2);
    check('bgra → rgba swaps channels', r === 5 && g === 2 && b === 200, `got ${r},${g},${b}`);
    check('alpha forced opaque', a === 255, `got ${a}`);

    const straight = frameToScanImage(makeFrame(8, 4, { order: 'rgba' }));
    const [r2, g2, b2] = pixel(straight, 5, 2);
    check('rgba passes through', r2 === 5 && g2 === 2 && b2 === 200, `got ${r2},${g2},${b2}`);
  }

  // 2. Row stride. Android pads rows; ignoring the pad shears the image
  //    progressively, so check the last row where the error is largest.
  {
    const img = frameToScanImage(makeFrame(8, 4, { pad: 20 }));
    let ok = true;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 8; x++) {
        const [r, g, b] = pixel(img, x, y);
        if (r !== x || g !== y || b !== 200) ok = false;
      }
    }
    check('bytesPerRow padding skipped', ok, 'padded rows misread');
  }

  // 3. Rotation. Dimensions must swap, and content must land where an upright
  //    reader expects it. 'right' means the content is turned 90° right, so
  //    the source's top-left belongs at the output's bottom-left.
  {
    const frame = { ...makeFrame(8, 4), orientation: 'right' };
    const img = frameToScanImage(frame);
    check('right: dimensions swap', img.width === 4 && img.height === 8, `${img.width}×${img.height}`);
    const [r, g] = pixel(img, 0, img.height - 1);
    check('right: source top-left → output bottom-left', r === 0 && g === 0, `got x=${r} y=${g}`);

    const left = frameToScanImage({ ...makeFrame(8, 4), orientation: 'left' });
    const [lr, lg] = pixel(left, left.width - 1, 0);
    check('left: source top-left → output top-right', lr === 0 && lg === 0, `got x=${lr} y=${lg}`);

    const down = frameToScanImage({ ...makeFrame(8, 4), orientation: 'down' });
    const [dr, dg] = pixel(down, down.width - 1, down.height - 1);
    check('down: source top-left → output bottom-right', dr === 0 && dg === 0, `got x=${dr} y=${dg}`);
  }

  // 4. Rotation must not lose or duplicate pixels — every source coordinate
  //    should appear exactly once in the output.
  for (const orientation of ['up', 'right', 'down', 'left']) {
    const img = frameToScanImage({ ...makeFrame(8, 4, { pad: 12 }), orientation });
    const seen = new Set();
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const [r, g] = pixel(img, x, y);
        seen.add(`${r},${g}`);
      }
    }
    check(`${orientation}: bijective pixel mapping`, seen.size === 32, `${seen.size} distinct of 32`);
  }

  // 5. Mirroring reads rows right-to-left.
  {
    const img = frameToScanImage({ ...makeFrame(8, 4), isMirrored: true });
    const [r] = pixel(img, 0, 0);
    check('mirrored: row read right-to-left', r === 7, `got x=${r}`);
  }

  // 6. Downscale guard. Applied after rotation, and never upscales.
  {
    const wide = frameToScanImage(makeFrame(64, 32), { maxWidth: 16 });
    check('downscale to maxWidth', wide.width === 16 && wide.height === 8, `${wide.width}×${wide.height}`);

    const small = frameToScanImage(makeFrame(8, 4), { maxWidth: 640 });
    check('no upscaling below maxWidth', small.width === 8 && small.height === 4, `${small.width}×${small.height}`);

    const turned = analysisSize({ height: 480, orientation: 'right', width: 640 }, { maxWidth: 640 });
    check('analysisSize measures after rotation', turned.width === 480 && turned.height === 640, `${turned.width}×${turned.height}`);
  }

  // 6b. Preview cover-crop in oriented space. A portrait strip of a rotated
  //     landscape frame must come out portrait, and only contain those columns.
  {
    const frame = { ...makeFrame(8, 4), orientation: 'right' };
    // Oriented size is 4×8. Crop the right-hand 2 columns of that upright image.
    const img = frameToScanImage(frame, { crop: { height: 8, width: 2, x: 2, y: 0 } });
    check('crop output is 2×8', img.width === 2 && img.height === 8, `${img.width}×${img.height}`);
    // Oriented (rx,ry)=(2,0) is the source pixel that 'right' maps from
    // source (sx,sy). The existing right-rotation sends oriented (0,7) ← source (0,0).
    // We only assert the crop does not include oriented x=0 (source top-left).
    let sawSourceOrigin = false;
    let finite = true;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const [r, g] = pixel(img, x, y);
        if (!Number.isFinite(r) || !Number.isFinite(g)) finite = false;
        if (r === 0 && g === 0) sawSourceOrigin = true;
      }
    }
    check('cropped region has no NaN', finite);
    check('crop excluded oriented x=0 (source origin)', !sawSourceOrigin);
  }

  // 7. Format gate. Planar and private formats must be rejected by name, not
  //    read as if they were RGBA.
  {
    check('bgra format recognised', pixelOrderFor('rgb-bgra-8-bit') === 'bgra');
    check('rgba format recognised', pixelOrderFor('rgb-rgba-8-bit') === 'rgba');
    check('3-byte rgb recognised', pixelOrderFor('rgb-rgb-8-bit') === 'rgb');
    check('yuv rejected', pixelOrderFor('yuv-420-8-bit-video') === null);
    check('private rejected', pixelOrderFor('private') === null);
  }

  // 7b. 3-byte RGB frames have no alpha channel, so the pixel stride differs
  //     from the row arithmetic used for BGRA. Getting this wrong shears.
  {
    const width = 8;
    const height = 4;
    const bytesPerRow = width * 3 + 5; // padded, 3 bytes per pixel
    const bytes = new Uint8Array(bytesPerRow * height).fill(7);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * bytesPerRow + x * 3;
        bytes[i] = x;
        bytes[i + 1] = y;
        bytes[i + 2] = 200;
      }
    }
    const img = frameToScanImage({
      bytes,
      bytesPerRow,
      height,
      isMirrored: false,
      orientation: 'up',
      pixelOrder: 'rgb',
      width,
    });
    let ok = true;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const [r, g, b, a] = pixel(img, x, y);
        if (r !== x || g !== y || b !== 200 || a !== 255) ok = false;
      }
    }
    check('3-byte rgb with padding reads correctly', ok);
  }

  // 7c. Stride validation. A camera reporting bytesPerRow 0 (or short) would
  //     otherwise collapse every row onto row 0 — a flat frame that detects
  //     nothing while looking like a camera problem.
  {
    const zero = validateFrameView({
      byteLength: 8 * 4 * 4,
      bytesPerRow: 0,
      height: 4,
      isMirrored: false,
      orientation: 'up',
      pixelOrder: 'bgra',
      width: 8,
    });
    check('bytesPerRow 0 is corrected', zero.strideCorrected && zero.stride === 32, `stride ${zero.stride}`);
    check('corrected stride is usable', zero.reason === null, String(zero.reason));

    const padded = validateFrameView({
      byteLength: 1000,
      bytesPerRow: 52,
      height: 4,
      isMirrored: false,
      orientation: 'up',
      pixelOrder: 'bgra',
      width: 8,
    });
    // Last row needs only its pixels, not a trailing stride of padding.
    check('required bytes accounts for padding', padded.requiredBytes === 52 * 3 + 32, `${padded.requiredBytes}`);
    check('reported stride kept when plausible', !padded.strideCorrected && padded.stride === 52);

    const short = validateFrameView({
      byteLength: 100,
      bytesPerRow: 32,
      height: 4,
      isMirrored: false,
      orientation: 'up',
      pixelOrder: 'bgra',
      width: 8,
    });
    check('short buffer is rejected', short.reason !== null, 'expected a reason');
  }

  // 7d. A truncated buffer must not be read out of bounds. Out-of-range reads
  //     return undefined, which lands as 0 and is indistinguishable from a
  //     black camera frame — so the guard must clamp, not fault.
  {
    const width = 16;
    const height = 16;
    const bytes = new Uint8Array(width * 4 * 8).fill(120); // only half the rows
    const img = frameToScanImage({
      bytes,
      bytesPerRow: width * 4,
      height,
      isMirrored: false,
      orientation: 'up',
      pixelOrder: 'rgba',
      width,
    });
    check('truncated buffer still yields full geometry', img.width === 16 && img.height === 16);
    let finite = true;
    for (let i = 0; i < img.data.length; i++) {
      if (!Number.isFinite(img.data[i])) finite = false;
    }
    check('no NaN/undefined pixels from short buffer', finite);
    check('present rows preserved', pixel(img, 0, 0)[0] === 120);
  }

  // 8b. Brightness must separate an all-black buffer from a real image, since
  //     that is the fastest way to recognise a dead transfer on device.
  {
    const black = frameToScanImage({
      bytes: new Uint8Array(8 * 4 * 4),
      bytesPerRow: 32,
      height: 4,
      isMirrored: false,
      orientation: 'up',
      pixelOrder: 'bgra',
      width: 8,
    });
    check('black frame reads as luma 0', imageBrightness(black) === 0);
    check('textured frame reads as non-zero luma', imageBrightness(frameToScanImage(makeFrame(8, 4))) > 0);
  }

  // 8. Degenerate input must not throw — a stalling camera can report 0×0.
  {
    const img = frameToScanImage({ ...makeFrame(1, 1), height: 0, width: 0 });
    check('empty frame yields a valid image', img.width >= 1 && img.height >= 1);
  }

  if (failures > 0) {
    console.error(`frame-adapter smoke: ${failures} check(s) failed`);
    process.exit(1);
  }

  console.log('frame-adapter smoke ok');
  console.log('  channel order, row stride, 4 rotations, mirroring, downscale, format gate');
} finally {
  await rm(bundleDir, { force: true, recursive: true });
}
