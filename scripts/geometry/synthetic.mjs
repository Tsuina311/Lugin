#!/usr/bin/env node
/**
 * yarn geometry:synthetic
 *
 *   yarn geometry:synthetic --suite=dark --count=40 --seed=42
 *   yarn geometry:synthetic --suite=all --count=600
 */

import { generateSuite } from './lib/synthetic/generate.mjs';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
const suite = arg('suite') || 'dark';
const count = Number(arg('count') || (suite === 'all' ? 500 : 48));
const seed = Number(arg('seed') || 42);
const noImages = process.argv.includes('--no-images');

console.log('GEOMETRY SYNTHETIC STRESS');
console.log('─'.repeat(48));
console.log(`suite=${suite} count=${count} seed=${seed}`);
console.log('Foreground pixels = real card warps. GT quads from known transforms.');
console.log('SYNTHETIC ≠ real-device accuracy.\n');

const index = await generateSuite({
  suite,
  count,
  seed,
  writeImages: !noImages,
});

console.log(`Generated ${index.count} scenes`);
console.log(`Warps used: ${index.warpsUsed.length}`);
console.log(`Manifest: .geometry-corpus/synthetic/manifest.json`);
console.log(`Suite ptr: .geometry-corpus/synthetic/suite-${suite}.json`);
console.log('\nNext:');
console.log(
  `  yarn geometry:benchmark --engine=native --native-input=y-from-rgba --corpus=synthetic --suite=${suite}`,
);
console.log('  yarn geometry:synthetic:curves --suite=dark --engine=native --native-input=y-from-rgba');
