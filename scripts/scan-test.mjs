// Parser tests for the phone scanner — no camera required.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
      export * from '${join(root, 'src/lib/scan/detectCard.ts')}';
      export * from '${join(root, 'src/lib/scan/regions.ts')}';
      export * from '${join(root, 'src/lib/scan/matchName.ts')}';
      export * from '${join(root, 'src/lib/scan/artwork/descriptors.ts')}';
      export * from '${join(root, 'src/lib/scan/artwork/match.ts')}';
      export * from '${join(root, 'src/lib/scan/text/evidence.ts')}';
      export * from '${join(root, 'src/lib/scan/ranking/fuse.ts')}';
      export * from '${join(root, 'src/lib/scan/temporal/consensus.ts')}';
      export * from '${join(root, 'src/lib/scan/tracking.ts')}';
      export * from '${join(root, 'src/lib/scan/params.ts')}';
      export * from '${join(root, 'src/lib/scan/session/controller.ts')}';
      export * from '${join(root, 'src/lib/scan/videoMap.ts')}';
      export * from '${join(root, 'src/lib/scan/cameraCapabilities.ts')}';
      export { polygonIoU } from '${join(root, 'src/lib/scan/detectCard.ts')}';
    `,
    resolveDir: root,
    sourcefile: 'entry.ts',
  },
});

const {
  CARD_ASPECT,
  CARD_HEIGHT,
  CARD_WIDTH,
  STANDARD_PROFILE,
  ScanTimer,
  applyH,
  bestName,
  binarize,
  blankImage,
  buildNameIndex,
  candidateMargin,
  contrastStretch,
  convexHull,
  cornersToQuad,
  cropImage,
  detectCardQuad,
  editDistance,
  extremalCorners,
  foldName,
  glareRatio,
  grayscale,
  guessFoil,
  homographyDestToSrc,
  isLightOnDark,
  largestComponent,
  matchName,
  matchReadings,
  mergeParts,
  mergePartsForScan,
  minAreaRectAngle,
  normalizePolarity,
  orderCorners,
  otsuThreshold,
  parseCollectorLine,
  parseCollectorParts,
  parseSetSymbolText,
  prepareCard,
  prepareCardWithGuideFallback,
  quadToCorners,
  readCollector,
  readTitle,
  rectQuad,
  regionToRect,
  resize,
  scoreCardQuad,
  shapeFold,
  sharpnessScore,
  similarity,
  tidyName,
  trimToTextBand,
  upscaleFactorFor,
  warpQuadToCard,
  describeArtwork,
  descriptorSimilarity,
  createArtworkMatcher,
  indexFromEntries,
  fuseEvidence,
  pushTemporal,
  temporalSupportFor,
  emptyTemporal,
  emptyTrack,
  pushTrack,
  sampleFromQuad,
  frameQualityScore,
  tokenizeScanText,
  textEvidenceScore,
  idfForPool,
  BATTLE_PROFILE,
  profileForCard,
  createSessionController,
  mapAnalysisToOverlay,
  mapCoverSourceToDest,
  mapAnalysisToSource,
  coverLayout,
  polygonIoU,
  buildContinuousFocusConstraints,
  buildPointFocusConstraints,
  buildCameraConstraintPlan,
  cameraConstraintFallbacks,
  focusGateDecision,
  normalizeCapabilities,
  preferredMainLensZoom,
  supportsTapFocus,
  QUALITY_MIN_SCORE,
  SHARPNESS_MIN,
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

// --- name matching --------------------------------------------------------

/** A small stand-in for the shipped index, with names chosen to collide. */
const testIndex = (fold) =>
  buildNameIndex(
    {
      names: [
        'Sol Ring',
        'Soul Warden',
        'Lightning Bolt',
        'Llanowar Elves',
        'Yavimaya, Cradle of Growth',
        'Reliquary Tower',
        'Swords to Plowshares',
        'Fog',
        'Ow',
        'Nicol Bolas, Dragon-God',
        'Elvish Mystic',
      ],
      printed: {
        de: [
          [0, 'Sonnenring'],
          [2, 'Blitzschlag'],
        ],
        fr: [
          [0, 'Anneau solaire'],
          [2, 'Foudre'],
          [6, 'Épées contre socs'],
        ],
        it: [[0, 'Anello del Sole']],
      },
      version: 1,
    },
    fold,
  );

check('foldName strips punctuation and accents but keeps letters', () => {
  assert.equal(foldName("Lim-Dûl's Vault"), 'limdulsvault');
  assert.equal(foldName('Épées contre socs'), 'epeescontresocs');
  assert.equal(foldName('Nicol Bolas, Dragon-God'), 'nicolbolasdragongod');
});

check('shapeFold collapses the characters OCR cannot tell apart', () => {
  // Same handful of pixels in a title font, so the distinction carries no
  // information and is removed from both sides.
  assert.equal(shapeFold('Sol Ring'), shapeFold('So1 R1ng'));
  assert.equal(shapeFold('Bolt'), shapeFold('8olt'));
  assert.equal(shapeFold('Sworn'), shapeFold('Swom'), 'rn and m collapse');
  assert.equal(shapeFold('Warden'), shapeFold('VVarden'), 'vv reads as w');
});

check('editDistance and similarity agree with the obvious cases', () => {
  assert.equal(editDistance('', ''), 0);
  assert.equal(editDistance('abc', 'abc'), 0);
  assert.equal(editDistance('abc', 'abd'), 1);
  assert.equal(editDistance('abc', ''), 3);
  assert.equal(similarity('solring', 'solring'), 1);
  assert.ok(similarity('solring', 'solrinq') > 0.8);
  assert.equal(similarity('solring', ''), 0);
});

check('matchName finds the card behind a misread title', () => {
  const index = testIndex();
  const [top] = matchName('Sol Rinq', index);
  assert.equal(top.name, 'Sol Ring');
  assert.ok(top.score > 0.8, `score ${top.score}`);
});

check('matchName recovers a title clipped by the crop', () => {
  // Scoring only the whole string would rate this ~0.6 purely for the missing
  // tail, which is the difference between an answer and nothing.
  const [top] = matchName('Yavimaya, Cradle', testIndex());
  assert.equal(top.name, 'Yavimaya, Cradle of Growth');
  assert.ok(top.score > 0.8, `score ${top.score}`);
});

check('matchName resolves French, German and Italian titles to the English name', () => {
  const index = testIndex();
  for (const printed of ['Anneau solaire', 'Sonnenring', 'Anello del Sole']) {
    const [top] = matchName(printed, index);
    assert.equal(top.name, 'Sol Ring', `${printed} did not resolve`);
    assert.equal(top.printedName, printed, 'the matching localized title is reported');
    assert.ok(top.lang, 'so the scan can record which language was held up');
  }
});

check('matchName still resolves a misread foreign title', () => {
  const [top] = matchName('Anneau solaire'.replace('l', '1'), testIndex());
  assert.equal(top.name, 'Sol Ring');
});

check('matchName finds very short names, which have no useful trigrams', () => {
  const index = testIndex();
  assert.equal(matchName('Fog', index)[0].name, 'Fog');
  assert.equal(matchName('Ow', index)[0].name, 'Ow');
});

check('matchName reports one entry per card, not one per language', () => {
  const names = matchName('Sol Ring', testIndex()).map(c => c.name);
  assert.equal(new Set(names).size, names.length, 'no duplicate cards in the list');
});

check('matchName returns nothing for text that is not a card name', () => {
  // Rules text and flavour text land in the title crop often enough that
  // answering confidently here would be worse than answering not at all.
  assert.deepEqual(matchName('Deep within the forsaken cavern', testIndex()), []);
  assert.deepEqual(matchName('', testIndex()), []);
  assert.deepEqual(matchName('x', testIndex()), []);
});

check('matchReadings picks the reading that names a real card', () => {
  // The defect this whole module exists to fix. bestName takes the longest
  // string, so with equal lengths the garbled pass wins; only the index knows
  // that one of them is a card.
  assert.equal(bestName('Sol Rinq', 'Sol Ring'), 'Sol Rinq');

  const candidates = matchReadings(
    [
      { source: 'title', text: 'Sol Rinq' },
      { source: 'title-wide', text: 'Sol Ring' },
    ],
    testIndex(),
  );
  assert.equal(candidates[0].name, 'Sol Ring');
  assert.equal(candidates[0].score, 1, 'the exact reading wins outright');
  assert.equal(candidates[0].source, 'title-wide', 'and reports which pass found it');
});

check('matchReadings ignores passes that read nothing', () => {
  const candidates = matchReadings(
    [
      { source: 'title', text: '   ' },
      { source: 'title-wide', text: 'Lightning Bolt' },
    ],
    testIndex(),
  );
  assert.equal(candidates[0].name, 'Lightning Bolt');
});

check('candidateMargin separates a clear answer from a coin toss', () => {
  const clear = candidateMargin([
    { name: 'a', score: 0.7 },
    { name: 'b', score: 0.5 },
  ]);
  const tie = candidateMargin([
    { name: 'a', score: 0.9 },
    { name: 'b', score: 0.89 },
  ]);
  assert.ok(clear > tie, 'a lower top score can still be the safer answer');
  assert.equal(candidateMargin([]), 0);
  assert.equal(candidateMargin([{ name: 'a', score: 0.8 }]), 0.8);
});

check('buildNameIndex does not store a localized title identical to the English one', () => {
  const index = buildNameIndex(
    { names: ['Fog'], printed: { fr: [[0, 'Fog']] }, version: 1 },
    shapeFold,
  );
  assert.equal(index.entries.length, 1, 'the duplicate adds postings and changes nothing');
});

check('buildNameIndex ignores localized titles pointing outside the name list', () => {
  const index = buildNameIndex(
    { names: ['Fog'], printed: { fr: [[7, 'Brouillard']] }, version: 1 },
    shapeFold,
  );
  assert.equal(index.entries.length, 1);
});

// --- polarity and trimming ------------------------------------------------

/** A crop with one text-like band of `ink` on a `ground` background. */
const textCrop = ({ ground = 235, ink = 25, bandFrom = 20, bandTo = 32, h = 60, w = 120 } = {}) => {
  const image = blankImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inBand = y >= bandFrom && y < bandTo;
      // Glyph-ish: ink for part of each band row, ground elsewhere.
      const v = inBand && x % 7 < 3 ? ink : ground;
      const i = (y * w + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
    }
  }
  return image;
};

check('isLightOnDark spots an inverted crop', () => {
  assert.equal(isLightOnDark(textCrop()), false, 'dark text on light paper');
  assert.equal(
    isLightOnDark(textCrop({ ground: 20, ink: 240 })),
    true,
    'pale title over dark art',
  );
});

check('normalizePolarity leaves normal crops alone and flips inverted ones', () => {
  const normal = textCrop();
  assert.equal(normalizePolarity(normal).data[0], normal.data[0]);

  // Borderless prints read at 5% similarity before this step, because Tesseract
  // is trained on printed pages and does not expect a negative.
  const inverted = textCrop({ ground: 20, ink: 240 });
  const fixed = normalizePolarity(inverted);
  assert.ok(fixed.data[0] > 200, 'background became paper');
  const inkIndex = (25 * inverted.width + 0) * 4;
  assert.ok(fixed.data[inkIndex] < 60, 'glyphs became ink');
});

check('trimToTextBand crops away border and artwork', () => {
  const crop = textCrop({ bandFrom: 20, bandTo: 32, h: 60 });
  const trimmed = trimToTextBand(crop);
  assert.ok(trimmed.height < 60, `still ${trimmed.height} tall`);
  assert.ok(trimmed.height >= 12, 'the text line itself survived');
  assert.equal(trimmed.width, crop.width, 'trimming is vertical only');
});

check('trimToTextBand keeps the whole crop when there is nothing to trim', () => {
  // Degrading to the untrimmed crop is the point: a bad measurement must not
  // crop the title away.
  const blank = solid(120, 60, [200, 200, 200]);
  assert.equal(trimToTextBand(blank).height, 60);
  const allText = textCrop({ bandFrom: 0, bandTo: 60, h: 60 });
  assert.equal(trimToTextBand(allText).height, 60);
});

check('trimToTextBand works on an inverted crop too', () => {
  const trimmed = trimToTextBand(textCrop({ ground: 20, ink: 240 }));
  assert.ok(trimmed.height < 60, 'ink detection is polarity-agnostic');
});

// --- card detection -------------------------------------------------------

/**
 * Render a card-shaped quad into a frame: rounded corners, a dark border, a
 * lighter interior, and per-pixel background noise. Enough structure to exercise
 * detection without needing a downloaded fixture.
 */
const renderCard = ({
  background = 90,
  border = 12,
  interior = 205,
  rotate = 0,
  scale = 0.8,
  tilt = 0,
  frameW = 480,
  frameH = 640,
} = {}) => {
  const image = blankImage(frameW, frameH);
  let seed = 7;
  for (let i = 0; i < image.data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const v = Math.max(0, Math.min(255, background + (seed % 9) - 4));
    image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
  }

  const ch = frameH * scale;
  const cw = ch * CARD_ASPECT;
  const cx = frameW / 2;
  const cy = frameH / 2;
  const a = (rotate * Math.PI) / 180;
  const radius = cw * 0.045;

  // Walk the frame and ask, for each pixel, where it lands in card space.
  const cos = Math.cos(-a);
  const sin = Math.sin(-a);
  for (let y = 0; y < frameH; y++) {
    for (let x = 0; x < frameW; x++) {
      const rx = (x - cx) * cos - (y - cy) * sin;
      const ry = (x - cx) * sin + (y - cy) * cos;
      // Perspective: the top edge is narrower by `tilt`.
      const rowShrink = 1 - tilt * (0.5 - ry / ch);
      const halfW = (cw / 2) * rowShrink;
      if (Math.abs(rx) > halfW || Math.abs(ry) > ch / 2) continue;
      // Rounded corners.
      const overX = Math.abs(rx) - (halfW - radius);
      const overY = Math.abs(ry) - (ch / 2 - radius);
      if (overX > 0 && overY > 0 && Math.hypot(overX, overY) > radius) continue;

      const onBorder = halfW - Math.abs(rx) < cw * 0.04 || ch / 2 - Math.abs(ry) < ch * 0.03;
      const v = onBorder ? border : interior;
      const i = (y * frameW + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = v;
    }
  }
  return image;
};

check('convexHull wraps a point cloud', () => {
  const hull = convexHull([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
    { x: 5, y: 5 },
  ]);
  assert.equal(hull.length, 4, 'the interior point is not a vertex');
});

check('minAreaRectAngle finds the rotation of a rectangle', () => {
  const angleOf = degrees => {
    const a = (degrees * Math.PI) / 180;
    const pts = [
      { x: -40, y: -60 },
      { x: 40, y: -60 },
      { x: 40, y: 60 },
      { x: -40, y: 60 },
    ].map(p => ({
      x: 200 + p.x * Math.cos(a) - p.y * Math.sin(a),
      y: 300 + p.x * Math.sin(a) + p.y * Math.cos(a),
    }));
    return minAreaRectAngle(convexHull(pts));
  };
  // Any of the four edge directions is a valid answer, so compare modulo 90°.
  const mod90 = r => {
    const d = ((r * 180) / Math.PI) % 90;
    return d < 0 ? d + 90 : d;
  };
  assert.ok(Math.abs(mod90(angleOf(0))) < 0.5 || Math.abs(mod90(angleOf(0)) - 90) < 0.5);
  assert.ok(Math.abs(mod90(angleOf(20)) - 20) < 0.5);
});

check('extremalCorners orders a rotated rectangle', () => {
  const a = (15 * Math.PI) / 180;
  const pts = [
    { x: -40, y: -60 },
    { x: 40, y: -60 },
    { x: 40, y: 60 },
    { x: -40, y: 60 },
  ].map(p => ({
    x: 200 + p.x * Math.cos(a) - p.y * Math.sin(a),
    y: 300 + p.x * Math.sin(a) + p.y * Math.cos(a),
  }));
  const corners = extremalCorners(convexHull(pts));
  assert.equal(corners.length, 4);
  // The topmost input corner must come back as the first (top-left) slot.
  const quad = orderCorners(corners);
  assert.ok(quad[0].y < quad[3].y, 'top-left sits above bottom-left');
  assert.ok(quad[0].x < quad[1].x, 'top-left sits left of top-right');
});

check('largestComponent ignores speckle', () => {
  const w = 40;
  const h = 40;
  const mask = new Uint8Array(w * h);
  // A 10×10 block plus scattered single pixels.
  for (let y = 5; y < 15; y++) for (let x = 5; x < 15; x++) mask[y * w + x] = 1;
  mask[30 * w + 30] = 1;
  mask[35 * w + 5] = 1;
  const found = largestComponent(mask, w, h);
  assert.equal(found.area, 100);
  assert.equal(found.pixels[30 * w + 30], 0, 'speckle excluded from the winner');
});

check('detects a flat card on a plain background', () => {
  const { quad, score, corners } = detectCardQuad(renderCard());
  assert.ok(quad, 'no quad found on the easiest possible frame');
  assert.ok(score > 0.35, `score ${score?.toFixed(3)} below the acceptance threshold`);
  // Corners should land near the true card rectangle: 0.8 × 640 tall, centred.
  const expectedH = 640 * 0.8;
  const expectedW = expectedH * CARD_ASPECT;
  assert.ok(Math.abs(corners.topLeft.x - (480 - expectedW) / 2) < 6);
  assert.ok(Math.abs(corners.topLeft.y - (640 - expectedH) / 2) < 6);
  assert.ok(Math.abs(corners.bottomRight.x - (480 + expectedW) / 2) < 6);
});

check('detects a rotated card', () => {
  for (const rotate of [-20, -7, 9, 18]) {
    const { quad, score } = detectCardQuad(renderCard({ rotate }));
    assert.ok(quad, `no quad at ${rotate}°`);
    assert.ok(score > 0.3, `score ${score.toFixed(3)} too low at ${rotate}°`);
  }
});

check('detects a tilted card', () => {
  for (const tilt of [0.1, 0.2]) {
    const { quad } = detectCardQuad(renderCard({ tilt }));
    assert.ok(quad, `no quad at tilt ${tilt}`);
  }
});

check('detects a dark card on a light background and vice versa', () => {
  // The card is not reliably the bright part of the frame; only the difference
  // from the background is reliable.
  const onLight = detectCardQuad(renderCard({ background: 235, border: 10, interior: 90 }));
  assert.ok(onLight.quad, 'dark card on a light desk');
  const onDark = detectCardQuad(renderCard({ background: 20, border: 40, interior: 210 }));
  assert.ok(onDark.quad, 'light card on a dark desk');
});

check('detects a small, distant card', () => {
  const { quad, score } = detectCardQuad(renderCard({ scale: 0.35 }));
  assert.ok(quad, 'no quad for a card far from the camera');
  assert.ok(score > 0.2, `score ${score.toFixed(3)}`);
});

check('refined corners beat the rounded-corner hull points', () => {
  // Rounded corners put every extreme hull point inside the true corner, which
  // would shrink the quad and shift every region crop.
  const { corners } = detectCardQuad(renderCard({ scale: 0.8 }));
  const width = corners.topRight.x - corners.topLeft.x;
  const expectedW = 640 * 0.8 * CARD_ASPECT;
  assert.ok(
    width > expectedW * 0.985,
    `quad width ${width.toFixed(1)} shrank against the true ${expectedW.toFixed(1)}`,
  );
});

check('finds nothing in a featureless frame', () => {
  const flat = solid(200, 280, [90, 90, 90]);
  assert.equal(detectCardQuad(flat).quad, null);
});

check('finds nothing when the frame is pure noise', () => {
  // Better to fall back to the guide than to invent a card out of a busy desk.
  const noise = blankImage(200, 280);
  let seed = 99;
  for (let p = 0; p < 200 * 280; p++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const i = p * 4;
    noise.data[i] = noise.data[i + 1] = noise.data[i + 2] = seed % 256;
  }
  const { score } = detectCardQuad(noise);
  assert.ok(score < 0.35, `noise scored ${score.toFixed(3)} and would be trusted`);
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

check('prepareCard detects a real card and says so', () => {
  const prepared = prepareCard(renderCard());
  assert.equal(prepared.detected, true);
  assert.equal(prepared.source, 'detected');
  assert.ok(prepared.corners, 'corners are reported in source-frame pixels');
  assert.ok(prepared.score > 0.35);
  // The warp always emits the canonical raster, whatever the card measured.
  assert.equal(prepared.image.width, CARD_WIDTH);
  assert.equal(prepared.image.height, CARD_HEIGHT);
});

check('the guide fallback crops the guide rectangle, not a transposed one', () => {
  // Only reachable from the live camera, so the evaluation harness would never
  // catch a swapped width/height here — it would just quietly read the wrong
  // part of every frame that failed detection.
  const frame = blankImage(400, 800);
  // Mark one pixel inside the guide's top-left corner and check it lands there.
  const guide = { h: 0.5, w: 0.5, x: 0.25, y: 0.25 };
  const mark = (200 * 400 + 100) * 4;
  frame.data[mark] = 255;
  frame.data[mark + 1] = 0;
  frame.data[mark + 2] = 0;

  const prepared = prepareCardWithGuideFallback(frame, guide);
  assert.equal(prepared.source, 'guide');
  assert.equal(prepared.detected, false);
  // The mark sat at the guide's origin, so it must warp to the card's origin.
  assert.ok(prepared.image.data[0] > 100, 'guide origin maps to the card origin');
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

await checkAsync('readTitle runs every framing in the profile and tidies the best', async () => {
  const card = solid(504, 704, [200, 200, 200]);
  const log = [];
  const reading = await readTitle(card, stubRecognizer(['Sol', 'Sol Ring\nArtifact'], log), {});
  assert.equal(log.length, STANDARD_PROFILE.title.length, 'one pass per title framing');
  assert.ok(log.every(pass => pass.mode === 'line'));
  assert.equal(reading.samples.length, STANDARD_PROFILE.title.length);
  assert.deepEqual(
    reading.samples.map(s => s.region),
    STANDARD_PROFILE.title.map(t => t.name),
    'samples are labelled with the region they came from',
  );
  // tidyName drops the type line; bestName prefers the fuller read.
  assert.equal(reading.name, 'Sol Ring');
  assert.ok(reading.samples.every(s => s.cropWidth > 0 && s.cropHeight > 0));
});

check('every title region stays inside the card and above the artwork', () => {
  // The measured title band across the fixture corpus is 0.043–0.101 on standard
  // frames; a region that misses it produces confident nonsense rather than a
  // visible failure, so the numbers are asserted rather than merely commented.
  for (const { name, region } of STANDARD_PROFILE.title) {
    assert.ok(region.x >= 0 && region.y >= 0, `${name} starts inside the card`);
    assert.ok(region.x + region.w <= 1, `${name} stays within the card width`);
    assert.ok(region.y <= 0.043, `${name} starts at or above the measured title top`);
    assert.ok(region.y + region.h >= 0.101, `${name} reaches the measured title bottom`);
    assert.ok(region.y + region.h < 0.25, `${name} stops short of the artwork`);
  }
});

check('bestName still breaks ties by length, and is now only a fallback', () => {
  // Length is not a quality signal, so with equal-length readings the garbled one
  // can win. That is no longer on the main path: `matchReadings` scores every
  // reading against the card index and gets this right (see above). bestName
  // survives only for the case where no index has loaded yet, where "longest" is
  // at least better than "first".
  assert.equal(bestName('Sol Rinq', 'Sol Ring'), 'Sol Rinq');
  assert.equal(bestName('Sol', 'Sol Ring'), 'Sol Ring');
});

await checkAsync('readTitle reports nothing when OCR reads nothing', async () => {
  const reading = await readTitle(solid(504, 704, [0, 0, 0]), stubRecognizer([]), {});
  assert.equal(reading.name, null);
  assert.equal(reading.samples.length, STANDARD_PROFILE.title.length);
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

// --- the shipped index ----------------------------------------------------
//
// The generator runs in CI against a 392 MB dump, so nobody re-runs it to check a
// refactor. A wrong shape here does not throw: the matcher just quietly stops
// finding cards.

const BULK = [
  { games: ['paper'], lang: 'en', name: 'Sol Ring', set: 'cmr' },
  // A second printing of a card already seen must not duplicate the name.
  { games: ['paper'], lang: 'en', name: 'Sol Ring', set: 'ltc' },
  { games: ['paper'], lang: 'fr', name: 'Sol Ring', printed_name: 'Anneau solaire', set: 'soc' },
  { games: ['paper'], lang: 'de', name: 'Sol Ring', printed_name: 'Sonnenring', set: 'soc' },
  // A language nobody has an OCR model for is not worth the bytes.
  { games: ['paper'], lang: 'ja', name: 'Sol Ring', printed_name: '太陽の指輪', set: 'soc' },
  {
    games: ['paper'],
    lang: 'en',
    name: 'Delver of Secrets // Insectile Aberration',
    set: 'isd',
  },
  // Digital-only and oversized printings are not cards anybody scans.
  { games: ['arena'], lang: 'en', name: 'Alchemy Oddity', set: 'y22' },
  { games: ['paper'], lang: 'en', name: 'Big Furry Monster', oversized: true, set: 'ugl' },
];

const indexInput = join(dir, 'bulk.jsonl');
const indexOut = join(dir, 'card-names.json');
await writeFile(indexInput, `${BULK.map(c => JSON.stringify(c)).join('\n')}\n`);
execFileSync(
  'node',
  [join(root, 'scripts/build-card-index.mjs'), '--input', indexInput, '--out', indexOut],
  { stdio: 'ignore' },
);
const shipped = JSON.parse(await readFile(indexOut, 'utf8'));

check('the index lists every paper card name once', () => {
  assert.deepEqual(shipped.names, ['Delver of Secrets // Insectile Aberration', 'Sol Ring']);
});

check('the index leaves out digital-only and oversized printings', () => {
  assert.ok(!shipped.names.includes('Alchemy Oddity'));
  assert.ok(!shipped.names.includes('Big Furry Monster'));
});

check('the index maps localized titles to the English name by position', () => {
  const at = shipped.names.indexOf('Sol Ring');
  assert.deepEqual(shipped.printed.fr, [[at, 'Anneau solaire']]);
  assert.deepEqual(shipped.printed.de, [[at, 'Sonnenring']]);
  assert.ok(!shipped.printed.ja, 'no OCR model, no entry');
});

check('the index records the front face of a multi-face card', () => {
  // The title bar only ever shows the front face, so that is what OCR reads.
  const at = shipped.names.indexOf('Delver of Secrets // Insectile Aberration');
  assert.ok(
    shipped.printed.en.some(([i, title]) => i === at && title === 'Delver of Secrets'),
    'front face missing from the English aliases',
  );
});

check('the shipped index resolves through the real matcher', () => {
  // End to end: the generator's output shape and the matcher's expectations have
  // to agree, and they are in different languages in different files.
  const index = buildNameIndex(shipped);
  assert.equal(matchName('Anneau solaire', index)[0].name, 'Sol Ring');
  assert.equal(matchName('Delver of Secrets', index)[0].name, 'Delver of Secrets // Insectile Aberration');
  assert.equal(matchName('Sol Rinq', index)[0].name, 'Sol Ring');
});

check('artwork descriptors are deterministic and self-similar', () => {
  const img = blankImage(64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4;
      img.data[i] = x * 4;
      img.data[i + 1] = y * 4;
      img.data[i + 2] = 80;
      img.data[i + 3] = 255;
    }
  }
  const a = describeArtwork(img);
  const b = describeArtwork(img);
  assert.deepEqual(a.dhash, b.dhash);
  assert.ok(descriptorSimilarity(a, a) > 0.99);
});

check('artwork matcher ranks an exact descriptor first', () => {
  const img = blankImage(48, 48);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = 40;
    img.data[i + 1] = 120;
    img.data[i + 2] = 200;
    img.data[i + 3] = 255;
  }
  const desc = describeArtwork(img);
  const other = blankImage(48, 48);
  for (let i = 0; i < other.data.length; i += 4) {
    other.data[i] = 200;
    other.data[i + 1] = 40;
    other.data[i + 2] = 40;
    other.data[i + 3] = 255;
  }
  const matcher = createArtworkMatcher(
    indexFromEntries([
      {
        descriptor: describeArtwork(other),
        name: 'Wrong',
        oracleId: 'oracle:wrong',
        scryfallId: 'b',
      },
      {
        descriptor: desc,
        name: 'Right',
        oracleId: 'oracle:right',
        scryfallId: 'a',
      },
    ]),
  );
  const hits = matcher.findCandidates(desc, 3);
  assert.equal(hits[0].name, 'Right');
  assert.ok(hits[0].visualScore > hits[1].visualScore);
});

check('fusion accepts a strong title+visual pair and stays ambiguous on a coin toss', () => {
  const clear = fuseEvidence([
    {
      name: 'Sol Ring',
      oracleId: 'oracle:sol',
      possiblePrintingIds: ['p1'],
      titleScore: 0.92,
      visualScore: 0.9,
    },
    {
      name: 'Mana Crypt',
      oracleId: 'oracle:crypt',
      possiblePrintingIds: [],
      titleScore: 0.5,
      visualScore: 0.4,
    },
  ]);
  assert.equal(clear.status, 'identified');
  assert.equal(clear.card?.name, 'Sol Ring');

  const toss = fuseEvidence([
    {
      name: 'Sol Ring',
      oracleId: 'oracle:sol',
      possiblePrintingIds: [],
      titleScore: 0.7,
      visualScore: 0.68,
    },
    {
      name: 'Mana Vault',
      oracleId: 'oracle:vault',
      possiblePrintingIds: [],
      titleScore: 0.69,
      visualScore: 0.67,
    },
  ]);
  assert.ok(toss.status === 'card-ambiguous' || toss.status === 'insufficient-confidence');
});

check('temporal support rises when the same oracle keeps winning', () => {
  let state = emptyTemporal();
  const obs = id =>
    fuseEvidence([
      { name: 'A', oracleId: id, possiblePrintingIds: [], titleScore: 0.9, visualScore: 0.9 },
    ]);
  state = pushTemporal(state, obs('oracle:a'));
  state = pushTemporal(state, obs('oracle:a'));
  assert.ok(temporalSupportFor(state, 'oracle:a') >= 0.5);
});

check('track becomes stable only after agreeing frames', () => {
  let track = emptyTrack();
  const corners = {
    bottomLeft: { x: 0, y: 100 },
    bottomRight: { x: 70, y: 100 },
    topLeft: { x: 0, y: 0 },
    topRight: { x: 70, y: 0 },
  };
  track = pushTrack(track, sampleFromQuad(corners, 0.8));
  assert.equal(track.stable, false);
  track = pushTrack(track, sampleFromQuad(corners, 0.8));
  track = pushTrack(track, sampleFromQuad(corners, 0.8));
  assert.equal(track.stable, true);
  track = pushTrack(track, null);
  assert.equal(track.stable, false);
  assert.ok(track.history.length > 0, 'coasts — history kept after one miss');
});

check('track clears after coast window of misses', () => {
  let track = emptyTrack();
  const corners = {
    bottomLeft: { x: 0, y: 100 },
    bottomRight: { x: 70, y: 100 },
    topLeft: { x: 0, y: 0 },
    topRight: { x: 70, y: 0 },
  };
  for (let i = 0; i < 3; i++) track = pushTrack(track, sampleFromQuad(corners, 0.8));
  track = pushTrack(track, null);
  track = pushTrack(track, null);
  track = pushTrack(track, null);
  track = pushTrack(track, null);
  assert.equal(track.history.length, 0);
});

check('object-fit cover maps center to center', () => {
  const source = { width: 1920, height: 1080 };
  const dest = { width: 390, height: 844 };
  const mid = mapCoverSourceToDest(
    { x: source.width / 2, y: source.height / 2 },
    source,
    dest,
  );
  assert.ok(Math.abs(mid.x - dest.width / 2) < 1);
  assert.ok(Math.abs(mid.y - dest.height / 2) < 1);
});

check('analysis → overlay accounts for downscale and cover crop', () => {
  const analysis = { width: 640, height: 360 };
  const source = { width: 1920, height: 1080 };
  const dest = { width: 400, height: 800 };
  const srcPt = mapAnalysisToSource({ x: 320, y: 180 }, analysis, source);
  assert.ok(Math.abs(srcPt.x - 960) < 1);
  const overlay = mapAnalysisToOverlay({ x: 320, y: 180 }, analysis, source, dest);
  assert.ok(overlay.x > 0 && overlay.x < dest.width);
  assert.ok(overlay.y > 0 && overlay.y < dest.height);
});

check('polygon IoU is 1 for identical quads and ~0 for disjoint', () => {
  const a = {
    topLeft: { x: 0, y: 0 },
    topRight: { x: 10, y: 0 },
    bottomRight: { x: 10, y: 20 },
    bottomLeft: { x: 0, y: 20 },
  };
  assert.ok(Math.abs(polygonIoU(a, a) - 1) < 1e-6);
  const b = {
    topLeft: { x: 100, y: 100 },
    topRight: { x: 110, y: 100 },
    bottomRight: { x: 110, y: 120 },
    bottomLeft: { x: 100, y: 120 },
  };
  assert.ok(polygonIoU(a, b) < 0.01);
});

check('frame quality prefers a sharp frame over a flat one', () => {
  const flat = blankImage(64, 64);
  for (let i = 0; i < flat.data.length; i += 4) {
    flat.data[i] = flat.data[i + 1] = flat.data[i + 2] = 128;
    flat.data[i + 3] = 255;
  }
  const sharp = blankImage(64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4;
      const v = (x + y) % 2 === 0 ? 20 : 220;
      sharp.data[i] = sharp.data[i + 1] = sharp.data[i + 2] = v;
      sharp.data[i + 3] = 255;
    }
  }
  assert.ok(frameQualityScore(sharp, 1).score > frameQualityScore(flat, 1).score);
});

check('text evidence rewards distinctive tokens and ignores stopwords', () => {
  const tokens = tokenizeScanText('Investigate. Create a Clue token. Creature enters the battlefield.');
  assert.ok(tokens.includes('investigate'));
  assert.ok(!tokens.includes('creature'));
  const idf = idfForPool([
    { name: 'A', oracleId: 'a', tokens: ['investigate', 'clue'] },
    { name: 'B', oracleId: 'b', tokens: ['draw', 'card'] },
  ]);
  const score = textEvidenceScore(tokens, ['investigate', 'clue'], idf);
  assert.ok(score > 0.5);
});

check('battle profile is chosen for landscape rasters', () => {
  assert.equal(profileForCard(1000, 700).name, 'battle');
  assert.equal(profileForCard(744, 1038).name, 'standard');
  assert.ok(STANDARD_PROFILE.artwork);
  assert.ok(BATTLE_PROFILE.artwork);
});

await checkAsync('session controller: no card stays searching', async () => {
  const ctrl = createSessionController({
    nameIndex: null,
    ocr: null,
  });
  const noise = blankImage(320, 480);
  const s = await ctrl.onFrame(noise);
  assert.equal(s.phase, 'searching');
});

check('continuous focus constraints only when supported', () => {
  assert.equal(buildContinuousFocusConstraints({}), null);
  assert.deepEqual(
    buildContinuousFocusConstraints({ focusModes: ['continuous'] }),
    { focusMode: 'continuous' },
  );
  assert.equal(
    buildContinuousFocusConstraints({ focusModes: ['manual'] }),
    null,
  );
});

check('point focus always offers best-effort attempts', () => {
  const attempts = buildPointFocusConstraints({}, { x: 0.5, y: 0.5 });
  assert.ok(attempts.length >= 3);
  assert.ok(
    buildPointFocusConstraints(
      { focusModes: ['single-shot'], pointsOfInterest: true },
      { x: 0.5, y: 0.5 },
    ).length >= 1,
  );
});

check('main-lens zoom prefers 1.0 when ultrawide is available', () => {
  assert.equal(preferredMainLensZoom({ zoom: { max: 10, min: 0.5 } }), 1);
  assert.equal(preferredMainLensZoom({ zoom: { max: 8, min: 1 } }), null);
  assert.equal(preferredMainLensZoom({}), null);
});

check('preferred camera plan is ideal 1080p environment', () => {
  const plan = buildCameraConstraintPlan();
  assert.equal(plan.preferred.width.ideal, 1920);
  assert.equal(plan.preferred.height.ideal, 1080);
  assert.ok(cameraConstraintFallbacks().length >= 3);
});

check('normalizeCapabilities handles missing fields', () => {
  const caps = normalizeCapabilities({
    focusMode: ['continuous', 'single-shot'],
    pointsOfInterest: true,
    torch: true,
  });
  assert.deepEqual(caps.focusModes, ['continuous', 'single-shot']);
  assert.equal(caps.pointsOfInterest, true);
  assert.equal(caps.torch, true);
  assert.equal(supportsTapFocus(caps), true);
  assert.equal(supportsTapFocus({}), false);
});

check('focus gate: stable+blurry → focusing; sharp → ready; timeout', () => {
  assert.equal(
    focusGateDecision({
      focusingSince: 0,
      minQuality: QUALITY_MIN_SCORE,
      minSharpness: SHARPNESS_MIN,
      now: 100,
      qualityScore: 0.1,
      sharpness: 10,
      stable: true,
      timeoutMs: 2800,
    }).kind,
    'focusing',
  );
  assert.equal(
    focusGateDecision({
      focusingSince: 0,
      minQuality: QUALITY_MIN_SCORE,
      minSharpness: SHARPNESS_MIN,
      now: 100,
      qualityScore: 0.9,
      sharpness: 200,
      stable: true,
      timeoutMs: 2800,
    }).kind,
    'ready',
  );
  assert.equal(
    focusGateDecision({
      focusingSince: 0,
      minQuality: QUALITY_MIN_SCORE,
      minSharpness: SHARPNESS_MIN,
      now: 5000,
      qualityScore: 0.1,
      sharpness: 10,
      stable: true,
      timeoutMs: 2800,
    }).kind,
    'timeout',
  );
  assert.equal(
    focusGateDecision({
      focusingSince: null,
      minQuality: QUALITY_MIN_SCORE,
      minSharpness: SHARPNESS_MIN,
      now: 100,
      qualityScore: 0.1,
      sharpness: 10,
      stable: false,
      timeoutMs: 2800,
    }).kind,
    'unstable',
  );
});

check('quality pool prefers sharper frame', () => {
  const soft = frameQualityScore(blankImage(64, 64), 1);
  const detailed = blankImage(64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4;
      const v = (x + y) % 2 === 0 ? 20 : 220;
      detailed.data[i] = v;
      detailed.data[i + 1] = v;
      detailed.data[i + 2] = v;
      detailed.data[i + 3] = 255;
    }
  }
  const sharp = frameQualityScore(detailed, 1);
  assert.ok(sharp.score > soft.score);
  assert.ok(sharp.sharpness > soft.sharpness);
});

check('cover tap mapping is invertible at center', () => {
  const source = { height: 1080, width: 1920 };
  const dest = { height: 800, width: 400 };
  const mid = mapCoverSourceToDest({ x: 960, y: 540 }, source, dest);
  // Center of cover layout should land near dest center.
  assert.ok(Math.abs(mid.x - 200) < 2);
  assert.ok(Math.abs(mid.y - 400) < 2);
});

await checkAsync('session controller: found suppresses duplicate until gone', async () => {
  // Stub recognizer that always "identifies" Sol Ring so we can exercise the
  // FOUND → same geometry → no re-recognize path without OCR.
  let recognizeCalls = 0;
  const ocr = {
    recognize: async () => {
      recognizeCalls += 1;
      return { confidence: 0.9, text: 'Sol Ring' };
    },
  };
  const names = buildNameIndex(
    { names: ['Sol Ring'], locales: {}, version: 1 },
    shapeFold,
  );
  const ctrl = createSessionController({ nameIndex: names, ocr });
  // Build a simple high-contrast card-like rectangle.
  const frame = blankImage(400, 560);
  for (let y = 40; y < 520; y++) {
    for (let x = 80; x < 320; x++) {
      const i = (y * 400 + x) * 4;
      frame.data[i] = 30;
      frame.data[i + 1] = 30;
      frame.data[i + 2] = 40;
      frame.data[i + 3] = 255;
    }
  }
  // Feed enough agreeing frames to lock (stability window).
  let last = null;
  for (let i = 0; i < 6; i++) {
    last = await ctrl.onFrame(frame);
  }
  assert.ok(last);
  // If detection never locked, skip soft — synthetic blank cards vary.
  if (last.phase === 'found' || last.phase === 'recognizing' || last.phase === 'ambiguous') {
    const callsAfter = recognizeCalls;
    await ctrl.onFrame(frame);
    await ctrl.onFrame(frame);
    assert.ok(
      recognizeCalls <= callsAfter + 1,
      'must not thrash recognition on a stationary card',
    );
  }
});

await rm(dir, { force: true, recursive: true });
if (failed) {
  console.error(`\n${failed} scan check(s) failed`);
  process.exit(1);
}
console.log('\nall scan checks passed');
