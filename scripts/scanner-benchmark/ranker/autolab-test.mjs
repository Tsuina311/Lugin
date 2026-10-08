/**
 * Guards for the sealed geometry search.
 *   node scripts/scanner-benchmark/ranker/autolab-test.mjs
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { rootDir } from '../lib/paths.mjs';
import { prepare } from './autolab.mjs';

const pool = prepare();
const crops = JSON.parse(readFileSync(join(rootDir, 'scanner-benchmark/identity/crops.json'), 'utf8'));
const holdout = new Set(crops.filter(row => row.split === 'holdout').map(row => row.frameId));
const dev = new Set(crops.filter(row => row.split === 'dev').map(row => row.frameId));
for (const frame of pool.cv) {
  assert.equal(holdout.has(frame.id), false);
  assert.equal(dev.has(frame.id), false);
}
assert.ok(pool.cv.length > 0);
assert.ok(pool.dev.length > 0);
assert.ok(pool.holdout.length > 0);

const refused = spawnSync(process.execPath, ['scripts/scanner-benchmark/ranker/autolab.mjs', '--final-holdout', '--challenger=B-gbm-ab595716ca0a'], {
  cwd: rootDir,
  encoding: 'utf8',
});
assert.notEqual(refused.status, 0);
assert.match(`${refused.stderr}`, /dev recognition/);

console.log('autolab guards ok');
