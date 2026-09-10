#!/usr/bin/env node
/** yarn geometry:synthetic:replay <sceneId> */

import { replayScene } from './lib/synthetic/generate.mjs';

const sceneId = process.argv[2];
if (!sceneId) {
  console.error('Usage: yarn geometry:synthetic:replay <sceneId>');
  process.exit(1);
}
const r = await replayScene(sceneId);
console.log(`Replayed ${sceneId}`);
console.log(`Image: ${r.image}`);
console.log(`Seed: ${r.manifest.seed} suite=${r.manifest.suite}`);
