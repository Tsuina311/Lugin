// Parser tests for the phone scanner — no camera required.

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(join(tmpdir(), 'lugin-scan-'));
const bundle = join(dir, 'scan.mjs');

await esbuild.build({
  bundle: true,
  format: 'esm',
  outfile: bundle,
  platform: 'neutral',
  stdin: {
    contents: `
      export * from '${join(root, 'src/lib/scan/parseCollector.ts')}';
      export * from '${join(root, 'src/lib/scan/foil.ts')}';
      export * from '${join(root, 'src/lib/scan/geometry.ts')}';
      export * from '${join(root, 'src/lib/scan/types.ts')}';
      export * from '${join(root, 'src/lib/scan/preprocess.ts')}';
      export * from '${join(root, 'src/lib/scan/quality.ts')}';
      export * from '${join(root, 'src/lib/scan/prepareCard.ts')}';
      export * from '${join(root, 'src/lib/scan/diagnostics.ts')}';
      export * from '${join(root, 'src/lib/scan/readCard.ts')}';
    `,
    resolveDir: root,
    sourcefile: 'entry.ts',
  },
});

const {
  ScanTimer,
  applyH,
  bestName,
  binarize,
  blankImage,
  contrastStretch,
  cornersToQuad,
  cropImage,
  glareRatio,
  grayscale,
  guessFoil,
  homographyDestToSrc,
  mergeParts,
  mergePartsForScan,
  orderCorners,
  otsuThreshold,
  parseCollectorLine,
  parseCollectorParts,
  parseSetSymbolText,
  prepareCard,
  quadToCorners,
  readCollector,
  readTitle,
  rectQuad,
  regionToRect,
  resize,
  scoreCardQuad,
  sharpnessScore,
  tidyName,
  upscaleFactorFor,
  warpQuadToCard,
} = await import(pathToFileURL(bundle).href);

let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(err);
  }
};

const checkAsync = async (name, fn) => {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(err);
  }
};

/** Solid-colour test image. */
const solid = (w, h, [r, g, b]) => {
  const image = blankImage(w, h);
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = r;
    image.data[i + 1] = g;
    image.data[i + 2] = b;
  }
  return image;
};

check('modern collector line with foil star', () => {
  const p = parseCollectorLine('0123 ★ DMU EN');
  assert.equal(p?.setCode, 'DMU');
  assert.equal(p?.collectorNumber, '0123');
  assert.equal(p?.foilMarker, true);
});

check('modern collector line with non-foil bullet', () => {
  const p = parseCollectorLine('0042 • NEO • EN');
  assert.equal(p?.setCode, 'NEO');
  assert.equal(p?.collectorNumber, '0042');
  assert.equal(p?.foilMarker, false);
});

check('classic CMR-style number over set', () => {
  const p = parseCollectorLine('286/361 R CMR');
  assert.equal(p?.setCode, 'CMR');
  assert.equal(p?.collectorNumber, '286');
});

check('partial number-only pass is kept', () => {
  const p = parseCollectorParts('286/361');
  assert.equal(p.collectorNumber, '286');
  assert.equal(p.setCode, undefined);
});

check('partial set-only pass is kept', () => {
  const p = parseCollectorParts('CMR');
  assert.equal(p.setCode, 'CMR');
});

check('merge fills gaps across snaps', () => {
  const merged = mergeParts(
    parseCollectorParts('286/361'),
    parseCollectorParts('CMR'),
  );
  assert.equal(merged.collectorNumber, '286');
  assert.equal(merged.setCode, 'CMR');
});

check('name-first ignores bare set codes', () => {
  const merged = mergePartsForScan(
    { foilMarker: null, raw: '' },
    parseCollectorParts('DUS'),
    { nameLocked: false },
  );
  assert.equal(merged.setCode, undefined);
});

check('name-first still keeps classic number', () => {
  const merged = mergePartsForScan(
    { foilMarker: null, raw: '' },
    parseCollectorParts('286/361'),
    { nameLocked: false },
  );
  assert.equal(merged.collectorNumber, '286');
});

check('tidyName prefers the title line', () => {
  assert.equal(tidyName('Liesa, Shroud of Dusk\nLegendary Creature'), 'Liesa, Shroud of Dusk');
});

check('tidyName joins a wrapped subtitle', () => {
  assert.equal(
    tidyName('Living Lightning,\nCharged Up'),
    'Living Lightning, Charged Up',
  );
});

check('bestName picks the longer title pass', () => {
  assert.equal(bestName('Lie', 'Liesa, Shroud of Dusk'), 'Liesa, Shroud of Dusk');
});

check('set symbol OCR reads M11', () => {
  assert.equal(parseSetSymbolText('M11'), 'M11');
  assert.equal(parseSetSymbolText('M 11'), 'M11');
});

check('classic bottom number without set text', () => {
  const p = parseCollectorParts('134/249');
  assert.equal(p.collectorNumber, '134');
});

check('tidyName keeps French accents', () => {
  assert.equal(tidyName('Léonin, Protecteur'), 'Léonin, Protecteur');
});

check('noise does not invent a full card', () => {
  assert.equal(parseCollectorLine('hello world'), null);
});

check('foil star wins over image stats', () => {
  const g = guessFoil({ foilMarker: true }, null);
  assert.equal(g.foil, true);
  assert.ok(g.confidence >= 0.9);
});

check('bullet means non-foil even if the strip looks shiny', () => {
  const g = guessFoil(
    { foilMarker: false },
    { brightRatio: 0.2, colorVariance: 0.4, darkRatio: 0.1, midtoneRatio: 0.6 },
  );
  assert.equal(g.foil, false);
});

check('orderCorners puts TL TR BR BL', () => {
  const q = orderCorners([
    { x: 10, y: 10 },
    { x: 0, y: 10 },
    { x: 10, y: 0 },
    { x: 0, y: 0 },
  ]);
  assert.deepEqual(q, [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]);
});

check('homography maps dest corners back to source', () => {
  const src = rectQuad(10, 20, 100, 140);
  const dest = rectQuad(0, 0, 50, 70);
  const H = homographyDestToSrc(src, dest);
  for (let i = 0; i < 4; i++) {
    const p = applyH(H, dest[i]);
    assert.ok(Math.abs(p.x - src[i].x) < 1e-6);
    assert.ok(Math.abs(p.y - src[i].y) < 1e-6);
  }
});

check('scoreCardQuad likes a 63:88 rectangle', () => {
  const good = rectQuad(20, 10, 63, 88);
  const bad = rectQuad(20, 10, 88, 63);
  assert.ok(scoreCardQuad(good, 200, 200) > scoreCardQuad(bad, 200, 200));
});

check('warpQuadToCard samples the source colour at centre', () => {
  const w = 40;
  const h = 56;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 200;
    data[i + 1] = 40;
    data[i + 2] = 40;
    data[i + 3] = 255;
  }
  const out = warpQuadToCard({ data, height: h, width: w }, rectQuad(0, 0, w - 1, h - 1), 20, 28);
  const mid = (14 * 20 + 10) * 4;
  assert.ok(out.data[mid] > 150);
  assert.ok(out.data[mid + 1] < 80);
});

// --- image primitives -----------------------------------------------------

check('regionToRect clamps to the image', () => {
  const image = blankImage(100, 200);
  assert.deepEqual(regionToRect(image, { h: 0.5, w: 0.5, x: 0.25, y: 0.25 }), {
    h: 100,
    w: 50,
    x: 25,
    y: 50,
  });
  // A region running off the edge is trimmed, never wrapped.
  const edge = regionToRect(image, { h: 1, w: 1, x: 0.9, y: 0.9 });
  assert.equal(edge.x + edge.w, 100);
  assert.equal(edge.y + edge.h, 200);
});

check('cropImage copies the right pixels', () => {
  const image = blankImage(4, 4);
  // Mark the bottom-right pixel.
  const i = (3 * 4 + 3) * 4;
  image.data[i] = 200;
  const crop = cropImage(image, { h: 0.25, w: 0.25, x: 0.75, y: 0.75 });
  assert.equal(crop.width, 1);
  assert.equal(crop.height, 1);
  assert.equal(crop.data[0], 200);
});

check('resize keeps a solid colour solid', () => {
  const out = resize(solid(4, 4, [120, 60, 30]), 8, 8);
  assert.equal(out.width, 8);
  assert.equal(out.height, 8);
  const mid = (4 * 8 + 4) * 4;
  assert.equal(out.data[mid], 120);
  assert.equal(out.data[mid + 1], 60);
});

check('upscale factor targets readable text height', () => {
  assert.equal(upscaleFactorFor(16), 4);
  assert.equal(upscaleFactorFor(64), 1);
  // Capped, so a 1px crop does not ask for a 64× raster.
  assert.equal(upscaleFactorFor(1), 4);
});

check('grayscale collapses channels', () => {
  const out = grayscale(solid(2, 2, [255, 0, 0]));
  assert.equal(out.data[0], out.data[1]);
  assert.equal(out.data[1], out.data[2]);
  assert.equal(Math.round(out.data[0]), 76);
});

check('contrastStretch survives a flat image', () => {
  // Zero range would divide by zero; the guard has to hold.
  const out = contrastStretch(solid(4, 4, [128, 128, 128]));
  assert.ok(Number.isFinite(out.data[0]));
});

check('contrastStretch clipping ignores a glare pixel', () => {
  // A 60..141 gradient plus two blown pixels — the shape of a glare highlight
  // on an otherwise readable crop.
  const image = blankImage(10, 10);
  for (let p = 0; p < 100; p++) {
    const i = p * 4;
    const v = 60 + (p % 10) * 9;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
  }
  image.data[0] = image.data[1] = image.data[2] = 255;
  image.data[4] = image.data[5] = image.data[6] = 255;

  const naive = contrastStretch(image, 0);
  const clipped = contrastStretch(image, 0.05);
  // Pixel 9 is the brightest gradient value (141). Ignoring the two hot pixels
  // lets it reach white; including them leaves it mid-gray.
  const bright = 9 * 4;
  assert.ok(naive.data[bright] < 150, `naive left it at ${naive.data[bright]}`);
  assert.equal(clipped.data[bright], 255);
});

check('contrastStretch does not black out a crop that clipping collapses', () => {
  // 99 identical pixels and one highlight: clipping throws away both extremes
  // and would otherwise leave min === max.
  const image = solid(10, 10, [100, 100, 100]);
  image.data[0] = image.data[1] = image.data[2] = 255;
  const clipped = contrastStretch(image, 0.05);
  assert.ok(clipped.data[40] > 0 || clipped.data[0] > 0, 'image went entirely black');
});

check('otsu splits a bimodal image', () => {
  const image = blankImage(10, 10);
  for (let p = 0; p < 100; p++) {
    const v = p < 50 ? 30 : 220;
    const i = p * 4;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
  }
  const t = otsuThreshold(image);
  assert.ok(t > 30 && t < 220, `threshold ${t} should sit between the modes`);
  const binary = binarize(image, t);
  assert.equal(binary.data[0], 0);
  assert.equal(binary.data[99 * 4], 255);
});

// --- frame quality --------------------------------------------------------

check('sharpness prefers detail over a flat field', () => {
  const flat = solid(64, 64, [128, 128, 128]);
  // Broadband noise, not a grating: the metric samples every fourth pixel, so a
  // periodic pattern can alias to zero. Real detail is broadband.
  const detailed = blankImage(64, 64);
  let seed = 12345;
  for (let p = 0; p < 64 * 64; p++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const v = seed % 256;
    const i = p * 4;
    detailed.data[i] = detailed.data[i + 1] = detailed.data[i + 2] = v;
  }
  assert.ok(sharpnessScore(detailed) > sharpnessScore(flat));
  assert.equal(sharpnessScore(flat), 0, 'a featureless frame must score zero');
});

check('sharpness does not reward brightness', () => {
  // Two flat frames differing only in exposure must score the same, or
  // best-frame selection quietly becomes best-*exposed*-frame selection.
  assert.equal(sharpnessScore(solid(64, 64, [20, 20, 20])), 0);
  assert.equal(sharpnessScore(solid(64, 64, [240, 240, 240])), 0);
});

check('glare ratio finds blown highlights', () => {
  assert.equal(glareRatio(solid(32, 32, [100, 100, 100])), 0);
  assert.ok(glareRatio(solid(32, 32, [255, 255, 255])) > 0.9);
});

// --- geometry -------------------------------------------------------------

check('corners round-trip through the named form', () => {
  const quad = rectQuad(5, 7, 30, 40);
  assert.deepEqual(cornersToQuad(quadToCorners(quad)), quad);
  assert.deepEqual(quadToCorners(quad).topLeft, quad[0]);
  assert.deepEqual(quadToCorners(quad).bottomRight, quad[2]);
});

check('prepareCard reports how it framed the card', () => {
  // A featureless frame gives detection nothing to find, so it must say so
  // rather than quietly claiming a detection.
  const prepared = prepareCard(solid(200, 280, [90, 90, 90]));
  assert.equal(prepared.detected, false);
  assert.equal(prepared.source, 'whole-frame');
  assert.equal(prepared.corners, null);
  assert.equal(prepared.score, 0);
  assert.ok(prepared.image.width > 0 && prepared.image.height > 0);
});

// --- diagnostics ----------------------------------------------------------

check('ScanTimer records stages against an injected clock', () => {
  let now = 0;
  const timer = new ScanTimer(() => now);
  timer.measure('detect', () => {
    now += 12;
  });
  timer.measure('warp', () => {
    now += 30;
  });
  assert.deepEqual(timer.timings, [
    { ms: 12, stage: 'detect' },
    { ms: 30, stage: 'warp' },
  ]);
  assert.equal(timer.totalMs, 42);
});

check('ScanTimer still records a stage that threw', () => {
  let now = 0;
  const timer = new ScanTimer(() => now);
  assert.throws(() =>
    timer.measure('ocr', () => {
      now += 5;
      throw new Error('boom');
    }),
  );
  assert.deepEqual(timer.timings, [{ ms: 5, stage: 'ocr' }]);
});

// --- reading a card with an injected recognizer ----------------------------

/** Fake OCR: answers per region, so region wiring is testable without tesseract. */
const stubRecognizer = (byRegion, log = []) => ({
  recognize: async (image, options) => {
    log.push({ height: image.height, mode: options?.mode, width: image.width });
    const key = `${image.width}x${image.height}`;
    const text = byRegion[log.length - 1] ?? byRegion[key] ?? '';
    return { confidence: text ? 0.8 : 0, text, words: [] };
  },
});

await checkAsync('readTitle runs every framing and tidies the best', async () => {
  const card = solid(504, 704, [200, 200, 200]);
  const log = [];
  const reading = await readTitle(
    card,
    stubRecognizer(['Sol', '', 'Sol Ring\nArtifact', ''], log),
    {},
  );
  assert.equal(log.length, 4, 'four title framings');
  assert.equal(log[0].mode, 'line');
  assert.equal(log[3].mode, 'block', 'last pass is a block read for wrapped names');
  assert.equal(reading.samples.length, 4);
  // tidyName drops the type line; bestName prefers the fuller read.
  assert.equal(reading.name, 'Sol Ring');
  assert.ok(reading.samples.every(s => s.cropWidth > 0 && s.cropHeight > 0));
});

check('bestName breaks ties by length, not by quality (known defect)', () => {
  // Documents current behaviour rather than endorsing it: with equal-length
  // candidates the first pass wins, so a garbled read beats a clean one. Length
  // is not a quality signal at all — Phase C replaces this with scoring against
  // the local card index, and this assertion should flip then.
  assert.equal(bestName('Sol Rinq', 'Sol Ring'), 'Sol Rinq');
  assert.equal(bestName('Sol', 'Sol Ring'), 'Sol Ring');
});

await checkAsync('readTitle reports nothing when OCR reads nothing', async () => {
  const reading = await readTitle(solid(504, 704, [0, 0, 0]), stubRecognizer([]), {});
  assert.equal(reading.name, null);
  assert.equal(reading.samples.length, 4);
  assert.ok(reading.samples.every(s => s.confidence === 0));
});

await checkAsync('readCollector merges set and number across regions', async () => {
  const merge = (into, incoming) => mergePartsForScan(into, incoming, { nameLocked: true });
  const { parts, samples } = await readCollector(
    solid(504, 704, [200, 200, 200]),
    stubRecognizer(['0123', '', 'DMU', '', '0123 ★ DMU EN']),
    merge,
    {},
  );
  assert.equal(samples.length, 5, 'five collector framings');
  assert.equal(parts.collectorNumber, '0123');
  assert.equal(parts.setCode, 'DMU');
  assert.equal(parts.foilMarker, true);
});

await checkAsync('readCollector reads a set code out of the expansion symbol', async () => {
  const merge = (into, incoming) => mergePartsForScan(into, incoming, { nameLocked: true });
  // Only the fourth pass (set-symbol) returns anything.
  const { parts } = await readCollector(
    solid(504, 704, [200, 200, 200]),
    stubRecognizer(['', '', '', 'M11', '']),
    merge,
    {},
  );
  assert.equal(parts.setCode, 'M11');
});

await checkAsync('keepCrops is off by default so scans stay cheap', async () => {
  const plain = await readTitle(solid(504, 704, [200, 200, 200]), stubRecognizer(['Sol Ring']), {});
  assert.ok(plain.samples.every(s => s.crop === undefined));
  const debug = await readTitle(
    solid(504, 704, [200, 200, 200]),
    stubRecognizer(['Sol Ring']),
    { keepCrops: true },
  );
  assert.ok(debug.samples.every(s => s.crop && s.crop.width > 0));
});

await rm(dir, { force: true, recursive: true });
if (failed) {
  console.error(`\n${failed} scan check(s) failed`);
  process.exit(1);
}
console.log('\nall scan checks passed');
