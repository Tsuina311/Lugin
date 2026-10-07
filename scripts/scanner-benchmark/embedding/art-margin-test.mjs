import assert from 'node:assert/strict';

import { artQuadAtMargin, bestMargin, chooseMarginPolicy, marginId, scaleCanonicalArt } from './art-margin.mjs';

const rect = (x0, y0, x1, y1) => ({ tl: [x0, y0], tr: [x1, y0], br: [x1, y1], bl: [x0, y1] });

const close = (quad, expected) => {
  for (const key of ['tl', 'tr', 'br', 'bl']) {
    assert.ok(Math.abs(quad[key][0] - expected[key][0]) < 1e-6, key);
    assert.ok(Math.abs(quad[key][1] - expected[key][1]) < 1e-6, key);
  }
};

const grown = scaleCanonicalArt(rect(100, 200, 300, 500), 0.1, 744, 1039);
close(grown, rect(90, 185, 310, 515));

const shrunk = scaleCanonicalArt(rect(100, 200, 300, 500), -0.1, 744, 1039);
close(shrunk, rect(110, 215, 290, 485));

const clamped = scaleCanonicalArt(rect(0, 0, 40, 20), 1, 744, 1039);
assert.equal(clamped.tl[0], 0);
assert.equal(clamped.tl[1], 0);
assert.ok(clamped.br[0] > 40);

const card = rect(0, 0, 743, 1038);
const art = rect(100, 200, 300, 500);
assert.equal(artQuadAtMargin(art, card, 0), art);

assert.equal(marginId(0), 'manual_0');
assert.equal(marginId(0.05), 'manual_+5');
assert.equal(marginId(-0.1), 'manual_-10');

const picked = bestMargin([
  { id: 'manual_-10', top1: false, rank: 2, expectedScore: 0.9 },
  { id: 'manual_0', top1: true, rank: 1, expectedScore: 0.4 },
  { id: 'manual_+5', top1: true, rank: 1, expectedScore: 0.8 },
]);
assert.equal(picked.id, 'manual_+5');

const policy = chooseMarginPolicy({
  table: [
    { id: 'current', top1: 32 },
    { id: 'manual_-10', top1: 30, wrongToCorrect: 1, correctToWrong: 3 },
    { id: 'manual_0', top1: 33, wrongToCorrect: 6, correctToWrong: 5 },
    { id: 'manual_+5', top1: 34, wrongToCorrect: 4, correctToWrong: 2 },
  ],
  categoryTables: [],
});
assert.equal(policy.verdict, 'CROP_NOT_MAIN_LIMIT');

const win = chooseMarginPolicy({
  table: [
    { id: 'current', top1: 32 },
    { id: 'manual_0', top1: 33, wrongToCorrect: 6, correctToWrong: 5 },
    { id: 'manual_+5', top1: 38, wrongToCorrect: 8, correctToWrong: 2 },
  ],
  categoryTables: [],
});
assert.equal(win.verdict, 'CONTEXT_CROP_WIN');
assert.equal(win.bestId, 'manual_+5');

console.log('art margin tests passed');
