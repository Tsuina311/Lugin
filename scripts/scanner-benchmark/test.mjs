import assert from 'node:assert/strict';

import { autoTagsFor, selectStills } from './lib/select.mjs';
import { inventoryMarkdown } from './lib/inventory.mjs';
import {
  classifyFailure,
  clipPolygon,
  confirmedIdentities,
  cornersToList,
  datasetHash,
  fusionClass,
  geometryDelta,
  hamming64,
  orderCorners,
  polygonIoU,
  projectUnitPoint,
  splitSession,
  topKFlags,
  validateCardQuad,
  geometryDecision,
  verdictFromGains,
  weightedRates,
} from './lib/metrics.mjs';
import { resolveSafeMedia } from './lib/paths.mjs';
import { checkGradients } from './embedding/math.mjs';
import { selfTestAugment } from './embedding/augment.mjs';
import { runCropCeilingTests } from './embedding/crop-ceiling-test.mjs';
import { galleryHtml, summaryMarkdown } from './lib/report.mjs';
import { runRankerTests } from './ranker/test.mjs';

const square = {
  topLeft: { x: 0, y: 0 },
  topRight: { x: 10, y: 0 },
  bottomRight: { x: 10, y: 20 },
  bottomLeft: { x: 0, y: 20 },
};

assert.deepEqual(
  orderCorners([
    { x: 10, y: 20 },
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 0, y: 20 },
  ]),
  square,
);

assert.deepEqual(projectUnitPoint(square, 0, 0), square.topLeft);
assert.deepEqual(projectUnitPoint(square, 1, 1), square.bottomRight);
assert.equal(polygonIoU(cornersToList(square), cornersToList(square)), 1);
assert.equal(
  polygonIoU(cornersToList(square), [
    { x: 100, y: 100 },
    { x: 110, y: 100 },
    { x: 110, y: 110 },
    { x: 100, y: 110 },
  ]),
  0,
);
assert.ok(clipPolygon(cornersToList(square), cornersToList(square)).length >= 3);

const delta = geometryDelta(square, square, 100, 100);
assert.equal(delta.iou, 1);
assert.equal(delta.cornerPx, 0);

const a = datasetHash({ b: 1, a: [2] });
const b = datasetHash({ a: [2], b: 1 });
assert.equal(a, b);
assert.notEqual(a, datasetHash({ a: [3], b: 1 }));

assert.equal(splitSession('session-a'), splitSession('session-a'));
assert.ok(['DEV', 'LOCKED_TEST'].includes(splitSession('session-a')));

assert.deepEqual(
  confirmedIdentities([
    { imageId: 'a', status: 'CONFIRMED', source: 'MANUAL', cardName: 'Bolt' },
    { imageId: 'b', status: 'CONFIRMED', source: 'SCANNER_PREDICTION', cardName: 'Nope' },
    { imageId: 'c', status: 'UNKNOWN', source: 'MANUAL' },
    { imageId: 'd', status: 'PROBABLE', source: 'MANUAL', cardName: 'Maybe' },
  ]).map(row => row.imageId),
  ['a'],
);

assert.deepEqual(
  topKFlags(
    [{ name: 'Other' }, { name: 'Bolt' }],
    hit => hit.name === 'Bolt',
  ),
  { top1: false, top3: true, top5: true, top10: true, rank: 2 },
);

assert.equal(fusionClass({ visualOk: true, ocrOk: false, fusedOk: true }), 'VISUAL_FIXES_OCR');
assert.equal(fusionClass({ visualOk: true, ocrOk: true, fusedOk: false }), 'FUSION_BREAKS_VISUAL');
assert.equal(classifyFailure({ identityCorrect: true }), null);
assert.equal(classifyFailure({ identityCorrect: false, detected: false }), 'DETECTOR_MISS');
assert.equal(
  classifyFailure({ identityCorrect: false, detected: true, visualTop1: false, ocrWrongAccepted: true }),
  'MULTI_FACTOR',
);
assert.equal(classifyFailure({ identityCorrect: false, detected: true }), 'UNCLASSIFIED');

const rates = weightedRates(
  [
    { sessionId: 's', cardName: 'Negate', hit: true },
    { sessionId: 's', cardName: 'Negate', hit: true },
    { sessionId: 's', cardName: 'Negate', hit: false },
    { sessionId: 't', cardName: 'Bolt', hit: false },
  ],
  'hit',
);
assert.equal(rates.frame, 0.5);
assert.ok(Math.abs(rates.card - 1 / 3) < 1e-9);
assert.ok(Math.abs(rates.session - 1 / 3) < 1e-9);

assert.equal(hamming64('0', '1') > 0, true);
assert.equal(verdictFromGains({ a: 0.7, b: null }).verdict, 'INSUFFICIENT_GROUND_TRUTH');
assert.equal(verdictFromGains({ a: 0.7, b: 0.9, structuralSameCrop: true }).verdict, 'GEOMETRY_DOMINANT');
assert.equal(verdictFromGains({ a: 0.7, b: 0.72, structuralSameCrop: true }).verdict, 'RECOGNITION_DOMINANT');

const card = {
  topLeft: { x: 10, y: 10 },
  topRight: { x: 80, y: 12 },
  bottomRight: { x: 78, y: 110 },
  bottomLeft: { x: 12, y: 108 },
};
assert.equal(validateCardQuad(card, 200, 300).ok, true);
assert.equal(
  validateCardQuad(
    {
      topLeft: { x: 10, y: 10 },
      topRight: { x: 80, y: 80 },
      bottomRight: { x: 10, y: 80 },
      bottomLeft: { x: 80, y: 10 },
    },
    200,
    200,
  ).ok,
  false,
);
assert.equal(validateCardQuad({ ...card, topRight: { x: 400, y: 12 } }, 200, 300).ok, false);
assert.equal(
  geometryDecision({ n: 11, currentTop1: 7, oracleTop1: 10, recovered: 3, broken: 0, stillWrong: 1 }).verdict,
  'GEOMETRY_MAJOR',
);
assert.equal(
  geometryDecision({ n: 11, currentTop1: 7, oracleTop1: 8, recovered: 1, broken: 0, stillWrong: 3 }).verdict,
  'RECOGNITION_DOMINANT',
);
assert.equal(geometryDecision({ n: 3, currentTop1: 1, oracleTop1: 3, recovered: 2, broken: 0, stillWrong: 0 }).verdict, 'INSUFFICIENT_ANNOTATION');

assert.throws(() => resolveSafeMedia('../secrets.txt'));
assert.throws(() => resolveSafeMedia('src/lib/scan/detectCard.ts'));

const stills = selectStills({
  sessions: [
    { sessionId: 'replay:wand', expectedIdentityAvailable: true, expectedIdentity: 'Wand of Wonder', date: '2026-09-08' },
    { sessionId: 'geometry-a', date: '2026-09-10' },
    { sessionId: 'binder-a', date: '2026-09-10' },
  ],
  images: [
    { imageId: 'r', path: 'r.png', sessionId: 'replay:wand', sourceType: 'replay', role: 'source', width: 1000, height: 1900, sha256: 'r' },
    { imageId: 'g', path: 'g.png', sessionId: 'geometry-a', sourceType: 'geometry', role: 'source', width: 1000, height: 1900, sha256: 'g' },
    { imageId: 'b', path: 'b.png', sessionId: 'binder-a', sourceType: 'binder', role: 'source', width: 1000, height: 1900, sha256: 'b' },
  ],
});
assert.equal(stills.items.some(item => item.sourceType === 'binder'), false);
assert.equal(stills.items.find(item => item.imageId === 'r').split, 'REGRESSION_SANITY');
assert.equal(stills.items.find(item => item.imageId === 'r').identityStatus, 'CONFIRMED');
assert.equal(stills.items.find(item => item.imageId === 'g').identityStatus, 'UNKNOWN');
assert.equal(stills.items.filter(item => item.sessionId === 'geometry-a').every(item => item.split === stills.items.find(x => x.sessionId === 'geometry-a').split), true);

assert.ok(autoTagsFor('maddening-hex-foil-sleeve.png', 'replay').includes('FOIL'));
const md = summaryMarkdown({
  experimentId: 'baseline',
  datasetVersion: 'stills-v1',
  datasetHash: 'abc',
  verdict: 'INSUFFICIENT_GROUND_TRUTH',
  verdictWhy: 'need corners',
  gains: { aToB: null, bToC: null },
  variants: {},
});
assert.match(md, /INSUFFICIENT_GROUND_TRUTH/);
const html = galleryHtml({ experimentId: 'baseline', verdict: 'MIXED', rows: [] });
assert.match(html, /No scored rows/);
assert.match(inventoryMarkdown({ generatedAt: 't', totals: { files: 1, images: 1, sessions: 1, videos: 0, exactDuplicateClusters: 0, exactDuplicateExtraFrames: 0, nearDuplicateClusters: 0, sourceFramesHashed: 0 }, bySourceType: {}, usefulness: { replay: 'sanity' }, sessions: [] }), /Images/);

assert.equal(checkGradients(), true);
assert.equal(selfTestAugment(), true);
runCropCeilingTests();
runRankerTests();

console.log('scanner-benchmark tests passed');
