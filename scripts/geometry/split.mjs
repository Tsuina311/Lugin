#!/usr/bin/env node
/**
 * yarn geometry:split — recompute deterministic train/val/test by captureGroup.
 */

import { assignSplits, listFixtures, writeManifest, writeSplits } from './lib/corpus.mjs';

const fixtures = await listFixtures();
if (!fixtures.length) {
  console.error('No fixtures. Run yarn geometry:bootstrap first.');
  process.exit(1);
}
const result = assignSplits(fixtures);
const splits = await writeSplits(fixtures, result);
await writeManifest(fixtures);
console.log('GEOMETRY SPLITS');
console.log(`train=${splits.train.length} validation=${splits.validation.length} test=${splits.test.length} hard=${splits.hard.length}`);
console.log(splits.policy.note);
