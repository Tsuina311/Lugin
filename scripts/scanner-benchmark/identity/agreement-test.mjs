/**
 * Deterministic tests for the frozen agreement rule.
 *   node scripts/scanner-benchmark/identity/agreement-test.mjs
 */

import assert from 'node:assert/strict';

import { PUBLISH_MARGIN, decideAgreement, rankIdentities, recognizeAgreement, sameIdentity } from './agreement.mjs';

const card = (oracleId, name, score) => ({ oracleId, name, score });

const decision = (clean, proto, second, cleanMargin = 0) => decideAgreement({
  cleanTop1: clean,
  prototypeTop1: proto,
  prototypeTop2: second,
  cleanMargin,
});

assert.equal(PUBLISH_MARGIN, 0.05);

const moonsnare = card('moon', 'Moonsnare Specialist', 0.8);
const other = card('other', 'Tranquil Cove', 0.7);
assert.equal(decision(moonsnare, { ...moonsnare, score: 0.8 }, other).publish, true);
assert.equal(decision(moonsnare, { ...moonsnare, score: 0.8 }, other).agreement, true);

const low = decision(moonsnare, { ...moonsnare, score: 0.74 }, { ...other, score: 0.71 });
assert.equal(low.agreement, true);
assert.equal(low.publish, false);
assert.ok(low.prototypeMargin < 0.05);

const disagree = decision(moonsnare, { ...other, score: 0.9 }, { ...moonsnare, score: 0.7 });
assert.equal(disagree.agreement, false);
assert.equal(disagree.marginPasses, true);
assert.equal(disagree.publish, false);

const wrong = card('spear-wrong', 'Predator, Flagship', 0.9);
const wrongSecond = card('other2', 'Seismic Assault', 0.8);
const unsafe = decision(wrong, { ...wrong }, wrongSecond);
assert.equal(unsafe.agreement, true);
assert.equal(unsafe.publish, true);

const exactTop = card('sword', 'Sword of the Animist', 1);
const exactSecond = card('stifle', 'Stifle', 1 - 0.05);
const exact = decision(exactTop, exactTop, exactSecond);
assert.ok(exact.prototypeMargin >= PUBLISH_MARGIN);
assert.equal(exact.publish, true);

const under = decision(exactTop, exactTop, card('stifle', 'Stifle', (1 - 0.05) + 1e-4));
assert.equal(under.publish, false);
assert.ok(under.prototypeMargin < PUBLISH_MARGIN);

const highCleanLowProto = decision(moonsnare, { ...moonsnare, score: 0.72 }, { ...other, score: 0.7 }, 0.4);
assert.equal(highCleanLowProto.cleanMargin, 0.4);
assert.equal(highCleanLowProto.publish, false);

const lowCleanHighProto = decision(moonsnare, { ...moonsnare, score: 0.8 }, other, 0.001);
assert.equal(lowCleanHighProto.publish, true);

const printingA = card('oracle-sword', 'Sword of the Animist', 0.8);
printingA.printingId = 'print-a';
const printingB = { ...card('oracle-sword', 'Sword of the Animist', 0.8), printingId: 'print-b' };
assert.equal(sameIdentity(printingA, printingB), true);
assert.equal(decision(printingA, printingB, other).publish, true);
assert.equal(sameIdentity(printingA, card('oracle-other', 'Sword of the Animist', 0.8)), false);

const refs = [
  { oracleId: 'a', canonicalName: 'Alpha', scryfallId: 'a1' },
  { oracleId: 'a', canonicalName: 'Alpha', scryfallId: 'a2' },
  { oracleId: 'b', canonicalName: 'Beta', scryfallId: 'b1' },
];
const dims = 2;
const gallery = new Float32Array([1, 0, 0.2, 0.8, 0, 1]);
const ranked = rankIdentities(gallery, refs, new Float32Array([1, 0]), dims);
assert.equal(ranked[0].oracleId, 'a');
assert.equal(ranked[0].printingId, 'a1');
assert.equal(ranked.length, 2);

const protoGallery = new Float32Array([0.6, 0.8, 1, 0, 0, 1]);
const recognized = recognizeAgreement(new Float32Array([1, 0]), { embeddings: gallery, refs }, { embeddings: protoGallery, refs }, dims);
assert.equal(recognized.cleanTop1.oracleId, 'a');
assert.equal(recognized.prototypeTop1.oracleId, 'a');
assert.equal(recognized.publish, true);

console.log('agreement-test ok');
