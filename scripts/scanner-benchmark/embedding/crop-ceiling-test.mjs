import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertNoEvalLeak,
  assertSameCropCanvas,
  autoRowsForSummary,
  buildCropVariants,
  ceilingHtml,
  ceilingVerdict,
  autoAnchorVerdict,
  classifyFailure,
  emptyMiss,
  encodeArtCrop,
  failureRows,
  isManualArtBox,
  loadAdaptedGallery,
  pairedNames,
  pairedTransitions,
  summarizeArtGeometry,
  rankInGallery,
  rectifyArtQuad,
  summarizeCrop,
} from './crop-ceiling.mjs';

const quad = [
  { x: 1, y: 1 },
  { x: 8, y: 1 },
  { x: 8, y: 9 },
  { x: 1, y: 9 },
];

export const runCropCeilingTests = () => {
  const calls = [];
  const warp = (image, points, w, h) => {
    calls.push({ image, points, w, h });
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  };
  const current = { width: 30, height: 20, data: new Uint8ClampedArray(30 * 20 * 4) };
  const source = { width: 12, height: 12, data: new Uint8ClampedArray(12 * 12 * 4) };
  const variants = buildCropVariants({
    warpQuadToCard: warp,
    currentCrop: current,
    source,
    autoQuad: quad,
    manualQuad: quad,
  });
  assert.equal(variants.auto_anchor.width, 30);
  assert.equal(variants.auto_anchor.height, 20);
  assert.equal(variants.manual_gt.width, 30);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].points, quad);
  assert.equal(calls[0].image, source);
  assert.equal(assertSameCropCanvas(variants), true);

  const encoded = [];
  const png = encodeArtCrop((image, maxWidth) => {
    encoded.push({ width: image.width, maxWidth });
    return new Uint8Array([image.width]);
  }, current);
  assert.equal(encoded[0].maxWidth, current.width);
  assert.equal(png[0], 30);
  assert.throws(() => rectifyArtQuad(warp, source, quad, 0, 20));

  const frames = [
    { auto_anchor: { available: true, top1: true, top3: true, top5: true, top10: true, wrongConfident: false } },
    { auto_anchor: emptyMiss('no art box') },
  ];
  const auto = autoRowsForSummary(frames);
  assert.equal(auto.length, 2);
  assert.equal(summarizeCrop(auto).n, 2);
  assert.equal(summarizeCrop(auto).top1, 1);

  const left = [{ top1: false }, { top1: true }, { top1: true }, { top1: false }];
  const right = [{ top1: true }, { top1: false }, { top1: true }, { top1: false }];
  assert.deepEqual(pairedTransitions(left, right), {
    n: 4,
    wrongToCorrect: 1,
    correctToWrong: 1,
    unchangedCorrect: 1,
    unchangedWrong: 1,
  });

  const embeddings = new Float32Array([1, 0, 0, 1, 0.6, 0.8]);
  const refs = [
    { oracleId: 'a', canonicalName: 'Alpha' },
    { oracleId: 'b', canonicalName: 'Beta' },
    { oracleId: 'c', canonicalName: 'Gamma' },
  ];
  const ranked = rankInGallery(embeddings, refs, 2, new Float32Array([0, 1]), hit => hit.oracleId === 'c');
  assert.equal(ranked.rank, 2);
  assert.equal(ranked.top1, false);
  assert.equal(ranked.top1Name, 'Beta');
  assert.equal(ranked.top3, true);
  assert.ok(ranked.expectedScore > ranked.top2Score === false || ranked.rank === 2);

  const badCrop = classifyFailure({
    detected: true,
    current: { top1: false },
    manual_gt: { available: true, top1: true },
  });
  assert.equal(badCrop, 'BAD_ART_CROP');
  assert.equal(classifyFailure({ detected: false, current: { top1: false } }), 'BAD_CARD_QUAD');
  assert.equal(
    classifyFailure({ detected: true, current: { top1: false }, manual_gt: { available: false } }),
    'UNKNOWN',
  );
  const rows = failureRows([
    {
      imageId: 'phone.png',
      cardName: 'Negate',
      detected: true,
      current: { top1: false, top1Name: 'Other', rank: 4, top1Score: 0.8, expectedScore: 0.7, margin: 0.1 },
      manual_gt: { available: false },
      notes: 'manual art box not annotated',
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].failureClass, 'UNKNOWN');
  assert.equal(rows[0].expected, 'Negate');
  assert.match(ceilingHtml({ verdict: 'MANUAL_GT_INCOMPLETE', verdictWhy: 'need boxes', frames: [{ cardName: 'Negate', current: { rank: 4, top1Name: 'Other' }, images: {} }] }), /Negate/);

  assert.equal(ceilingVerdict({ currentTop1: 32, manualTop1: 40, manualN: 46, n: 46 }).verdict, 'GEOMETRY_BOTTLENECK_CONFIRMED');
  assert.equal(ceilingVerdict({ currentTop1: 32, manualTop1: 33, manualN: 46, n: 46 }).verdict, 'REPRESENTATION_BOTTLENECK_DOMINANT');
  assert.equal(ceilingVerdict({ currentTop1: 32, manualTop1: 35, manualN: 46, n: 46 }).verdict, 'MIXED');
  assert.equal(ceilingVerdict({ currentTop1: 32, manualTop1: 0, manualN: 0, n: 46 }).verdict, 'MANUAL_GT_INCOMPLETE');
  assert.equal(isManualArtBox({ quad: { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] }, source: 'auto' }), false);
  assert.equal(isManualArtBox({ quad: { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] }, source: 'auto-edited' }), true);
  assert.equal(isManualArtBox({ quad: { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] }, source: 'auto-accepted' }), false);
  assert.equal(isManualArtBox({ quad: { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] }, source: 'auto-accepted', reviewed: true }), true);
  const names = pairedNames(
    [{ top1: false }, { top1: true }],
    [{ top1: true }, { top1: true }],
    ['Spear', 'Negate'],
  );
  assert.deepEqual(names.wrongToCorrect, ['Spear']);
  assert.deepEqual(names.unchangedCorrect, ['Negate']);
  const geometry = summarizeArtGeometry([
    { cardName: 'Island', auto_anchor: { available: false }, artReview: { source: 'manual' }, artGeometry: null },
    { cardName: 'Negate', auto_anchor: { available: true }, artReview: null, artGeometry: null },
  ]);
  assert.equal(geometry.autoDetected, 1);
  assert.equal(geometry.manual, 1);
  assert.equal(autoAnchorVerdict(geometry).verdict, 'AUTO_ANCHOR_UNMEASURED');
  assert.equal(
    classifyFailure({ detected: true, current: { top1: false }, manual_gt: { available: true, top1: false }, tags: ['foil'] }),
    'GLARE_OR_FOIL',
  );

  assert.equal(assertNoEvalLeak(['.scan-fixtures/replay/negate/source.png'], ['.scan-fixtures/visual-embed/art-crops/abc.jpg']), true);
  assert.throws(() => assertNoEvalLeak(['.scan-fixtures/replay/negate/source.png'], ['.scan-fixtures/replay/negate/source.png']));

  const dir = mkdtempSync(join(tmpdir(), 'b1-gallery-'));
  const storedRefs = [{ oracleId: 'a', canonicalName: 'Alpha' }];
  const emb = Buffer.from(new Float32Array([0.5, 0.5]).buffer);
  writeFileSync(join(dir, 'refs.json'), JSON.stringify(storedRefs));
  writeFileSync(join(dir, 'embeddings.bin'), emb);
  writeFileSync(join(dir, 'metadata.json'), JSON.stringify({ count: 1, dims: 2, id: 'test' }));
  const loaded = loadAdaptedGallery(readFileSync, dir);
  assert.equal(loaded.count, 1);
  assert.equal(loaded.dims, 2);
  assert.equal(loaded.embeddings.length, 2);
  assert.equal(loaded.metadata.id, 'test');
};
