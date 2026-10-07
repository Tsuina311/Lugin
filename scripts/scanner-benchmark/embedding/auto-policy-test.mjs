import assert from 'node:assert/strict';

import { chooseAutoPolicy, gapCause, iouBucket, scoreFromRank } from './auto-policy.mjs';

const check = (name, fn) => {
  fn();
  console.log(`ok  ${name}`);
};

check('saved ranks rebuild the published hit flags', () => {
  const hit = scoreFromRank({ available: true, top1: true, rank: 1, margin: 0.2, top1Name: 'Island' });
  assert.equal(hit.top1, true);
  assert.equal(hit.top10, true);
  assert.equal(hit.wrongConfident, false);
  const near = scoreFromRank({ available: true, top1: false, rank: 2, margin: 0.08, top1Name: 'Plains' });
  assert.equal(near.top3, true);
  assert.equal(near.wrongConfident, true);
  const far = scoreFromRank({ available: true, top1: false, rank: 12, margin: 0.2 });
  assert.equal(far.top10, false);
  assert.equal(far.wrongConfident, true);
  const none = scoreFromRank({ available: false, reason: 'no art box' });
  assert.equal(none.top1, false);
  assert.equal(none.reason, 'no art box');
  assert.equal(none.wrongConfident, false);
});

check('gap cause follows anchor presence and the 0.75 IoU line', () => {
  assert.equal(gapCause({ anchor: false, iou: null }), 'NO_ANCHOR');
  assert.equal(gapCause({ anchor: true, iou: 0.74 }), 'BAD_BOUNDARY');
  assert.equal(gapCause({ anchor: true, iou: 0.75 }), 'OTHER');
  assert.equal(iouBucket({ anchor: false, iou: null }), 'no anchor');
  assert.equal(iouBucket({ anchor: true, iou: 0.8 }), '0.75–0.90');
  assert.equal(iouBucket({ anchor: true, iou: 0.9 }), '>=0.90');
});

check('a small gain is not a material automatic win', () => {
  const decision = chooseAutoPolicy({
    currentTop1: 32,
    policyTop1: 34,
    wrongToCorrect: 3,
    correctToWrong: 1,
    recoveredFixes: 2,
    humanFixCount: 9,
    humanCeilingTop1: 39,
    gapCauses: ['NO_ANCHOR', 'NO_ANCHOR'],
  });
  assert.equal(decision.verdict, 'AUTO_POLICY_NO_MATERIAL_WIN');
  assert.equal(decision.practicalId, 'current');
});

check('recovering most human fixes with few regressions is near the ceiling', () => {
  const decision = chooseAutoPolicy({
    currentTop1: 32,
    policyTop1: 38,
    wrongToCorrect: 7,
    correctToWrong: 1,
    recoveredFixes: 7,
    humanFixCount: 9,
    humanCeilingTop1: 39,
    gapCauses: ['NO_ANCHOR'],
  });
  assert.equal(decision.verdict, 'AUTO_POLICY_NEAR_CEILING');
});

check('missing anchors dominate an otherwise real gain', () => {
  const decision = chooseAutoPolicy({
    currentTop1: 32,
    policyTop1: 35,
    wrongToCorrect: 4,
    correctToWrong: 1,
    recoveredFixes: 3,
    humanFixCount: 9,
    humanCeilingTop1: 39,
    gapCauses: ['NO_ANCHOR', 'NO_ANCHOR', 'NO_ANCHOR', 'BAD_BOUNDARY'],
  });
  assert.equal(decision.verdict, 'ANCHOR_COVERAGE_BOTTLENECK');
});

check('weak boundaries dominate an otherwise real gain', () => {
  const decision = chooseAutoPolicy({
    currentTop1: 32,
    policyTop1: 35,
    wrongToCorrect: 5,
    correctToWrong: 2,
    recoveredFixes: 4,
    humanFixCount: 9,
    humanCeilingTop1: 39,
    gapCauses: ['BAD_BOUNDARY', 'BAD_BOUNDARY', 'BAD_BOUNDARY', 'NO_ANCHOR'],
  });
  assert.equal(decision.verdict, 'ANCHOR_ACCURACY_BOTTLENECK');
});

check('coverage and boundary both block the ceiling', () => {
  const decision = chooseAutoPolicy({
    currentTop1: 32,
    policyTop1: 35,
    wrongToCorrect: 4,
    correctToWrong: 1,
    recoveredFixes: 4,
    humanFixCount: 9,
    humanCeilingTop1: 39,
    gapCauses: ['NO_ANCHOR', 'NO_ANCHOR', 'BAD_BOUNDARY', 'BAD_BOUNDARY'],
  });
  assert.equal(decision.verdict, 'ANCHOR_MIXED_LIMIT');
});

console.log('auto policy tests passed');
