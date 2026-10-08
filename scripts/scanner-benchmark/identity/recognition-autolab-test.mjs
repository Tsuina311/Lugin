/**
 * Seal check for the recognition search.
 *   node scripts/scanner-benchmark/identity/recognition-autolab-test.mjs
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

import { rootDir } from '../lib/paths.mjs';

const refused = spawnSync(process.execPath, ['scripts/scanner-benchmark/identity/recognition-autolab.mjs', '--final-holdout', 'not-a-challenger'], {
  cwd: rootDir,
  encoding: 'utf8',
});
assert.notEqual(refused.status, 0);
assert.match(`${refused.stderr}`, /refusing/);
console.log('recognition autolab seal ok');
