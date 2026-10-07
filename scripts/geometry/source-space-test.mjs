import assert from 'node:assert/strict';

import { assertImageSpace, quadInImageSpace } from './lib/source-space.mjs';

const inside = { tl: [10, 10], tr: [100, 12], br: [98, 140], bl: [8, 138] };
const same = quadInImageSpace({ quad: inside, imageWidth: 960, imageHeight: 1280, label: 'inside' });
assert.equal(same.scale, 1);
assert.equal(same.space, 'image');
assert.deepEqual(same.quad, inside);

const capture = {
  tl: [30, 30],
  tr: [1200, 36],
  br: [1170, 1800],
  bl: [24, 1760],
};
const mapped = quadInImageSpace({
  quad: capture,
  imageWidth: 960,
  imageHeight: 1280,
  captureWidth: 1440,
  captureHeight: 1920,
  label: 'capture',
});
assert.equal(mapped.space, 'capture');
assert.ok(Math.abs(mapped.scale - 2 / 3) < 1e-9);
assert.ok(Math.abs(mapped.quad.tr[0] - 800) < 1e-9);

assert.throws(
  () => quadInImageSpace({ quad: capture, imageWidth: 960, imageHeight: 1280, label: 'nosize' }),
  /missing image or capture dimension/,
);
assert.throws(
  () =>
    quadInImageSpace({
      quad: capture,
      imageWidth: 960,
      imageHeight: 1280,
      captureWidth: 1440,
      captureHeight: 1600,
      label: 'skew',
    }),
  /not uniform/,
);
assert.throws(() => assertImageSpace({ tl: [2000, 10], tr: [10, 10], br: [10, 10], bl: [10, 10] }, 960, 1280, 'far'), /outside/);

console.log('source space tests passed');
