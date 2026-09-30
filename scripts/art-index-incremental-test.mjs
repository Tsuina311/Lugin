// Saved artwork descriptors are copied when the hash formula has not changed.
import assert from 'node:assert/strict';

import { descriptorVersionOf, loadReusableArt } from './art-index-incremental.mjs';

const descriptor = {
  block: [1, 2, 3, 4],
  dhash: [5, 6],
  hue: [0, 0, 0, 0, 0, 0, 0, 1],
};

const entry = (illustrationId, name = 'Sol Ring') => ({
  descriptor,
  illustrationId,
  name,
  oracleId: `oracle-${illustrationId}`,
  scryfallId: `scry-${illustrationId}`,
  setCode: 'ltr',
});

const wrapped = (entries, extra = {}) => ({
  art: { entries, version: 1, ...extra },
  text: { entries: [], version: 1 },
});

assert.equal(descriptorVersionOf(wrapped([entry('a')])), 1);
assert.equal(descriptorVersionOf(wrapped([entry('a')], { descriptorVersion: 2 })), 2);

const reused = loadReusableArt(wrapped([entry('a'), entry('a'), entry('b')]), 1, {
  minEntries: 1,
});
assert.equal(reused.reason, null);
assert.equal(reused.entries.size, 2);
assert.equal(reused.entries.get('a').name, 'Sol Ring');

const stale = loadReusableArt(wrapped([entry('a')], { descriptorVersion: 2 }), 1, {
  minEntries: 1,
});
assert.equal(stale.entries.size, 0);
assert.match(stale.reason, /descriptor version 2/);

const tiny = loadReusableArt(wrapped([entry('a')]), 1);
assert.equal(tiny.entries.size, 0);
assert.match(tiny.reason, /only 1 reusable/);

const broken = loadReusableArt(
  wrapped([{ ...entry('a'), descriptor: { dhash: [1], block: [], hue: [] } }]),
  1,
  { minEntries: 1 },
);
assert.equal(broken.entries.size, 0);

console.log('art-index incremental: ok');
