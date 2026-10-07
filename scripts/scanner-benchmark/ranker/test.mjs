import assert from 'node:assert/strict';

import { challengerPasses, holdoutPasses, recommend } from './criteria.mjs';
import { initSplits, partition } from './splits.mjs';
import { fitBoostedTrees, fitLinearRegression, hydrateModel, serializeModel, trainingPairs } from './models.mjs';
import { FULL_FEATURES, vectorOf } from './schema.mjs';

const base = {
  oracleRecovery: 0.8,
  baselineRecovery: 0.7,
  catastrophic: 1,
  baselineCatastrophic: 1,
  goodToBad: 0,
  foldsWon: 3,
  foldCount: 5,
};

assert.equal(challengerPasses(base), true);
assert.equal(challengerPasses({ ...base, goodToBad: 1 }), false);
assert.equal(challengerPasses({ ...base, catastrophic: 2 }), false);
assert.equal(challengerPasses({ ...base, foldsWon: 2 }), false);
assert.equal(holdoutPasses({ n: 7, oracleRecovery: 0.9, baselineRecovery: 0.5, catastrophic: 0, baselineCatastrophic: 0, goodToBad: 0 }), false);
assert.equal(holdoutPasses({ n: 8, oracleRecovery: 0.9, baselineRecovery: 0.5, catastrophic: 0, baselineCatastrophic: 0, goodToBad: 0 }), true);
assert.equal(recommend({ anyPass: false, holdoutOk: true }), 'KEEP_HEURISTIC');
assert.equal(recommend({ anyPass: true, holdoutOk: false }), 'LEARNED_RANKER_PROMISING');
assert.equal(recommend({ anyPass: true, holdoutOk: true }), 'LEARNED_RANKER_STRONG_WIN');

const frames = [
  { id: 'a', captureGroup: 'g1', corpusSplit: 'train' },
  { id: 'b', captureGroup: 'g1', corpusSplit: 'train' },
  { id: 'c', captureGroup: 'g2', corpusSplit: 'test' },
  { id: 'd', captureGroup: 'g3', corpusSplit: 'train' },
];
const splits = initSplits(frames, null);
assert.deepEqual(splits.holdoutGroups, ['g2']);
assert.equal(splits.folds.g1, splits.folds.g1);
const again = initSplits([...frames, { id: 'e', captureGroup: 'g4', corpusSplit: 'test' }], splits);
assert.equal(again.folds.g1, splits.folds.g1);
assert.equal(again.holdoutGroups.includes('g2'), true);
assert.equal(again.holdoutGroups.includes('g4'), false);
const parts = partition(frames, splits);
assert.equal(parts.frozen.length, 1);
assert.equal(parts.cv.length, 3);
assert.equal(parts.cv.some(frame => frame.captureGroup === 'g2'), false);

const trainRows = [];
const targets = [];
for (let i = 0; i < 30; i++) {
  const signal = i % 2;
  trainRows.push([signal, 0]);
  targets.push(signal ? 0.95 : 0.1);
}
const linear = fitLinearRegression(trainRows, targets);
assert.ok(linear.utility([1, 0]) > linear.utility([0, 0]));
const trees = fitBoostedTrees(trainRows, targets);
assert.ok(trees.utility([1, 0]) > trees.utility([0, 0]));
const packed = serializeModel(linear);
assert.equal(hydrateModel(packed).utility([1, 0]) > hydrateModel(packed).utility([0, 0]), true);
assert.equal(trainingPairs([
  { index: 1, iou: 0.2, detectorScore: 0.9 },
  { index: 2, iou: 0.95, detectorScore: 0.4 },
])[0].worse.index, 1);
assert.equal(FULL_FEATURES.includes('detectorScore'), true);
assert.equal(vectorOf({ detectorScore: 0.5, aspectScore: 0.2, parallelScore: 0.3, areaScore: 0.4, centerScore: 0.1 }, ['detectorScore', 'areaScore']).join(','), '0.5,0.4');

export const runRankerTests = () => {
  assert.equal(recommend({ anyPass: false, holdoutOk: false }), 'KEEP_HEURISTIC');
};
