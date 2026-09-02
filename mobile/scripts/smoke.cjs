#!/usr/bin/env node
/** Lightweight workspace smoke — full RN tests arrive with later milestones. */
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
if (pkg.name !== 'lugin-mobile') {
  console.error('unexpected package name', pkg.name);
  process.exit(1);
}

readFileSync(join(root, 'src/camera/selectMainRearDevice.ts'), 'utf8');

const requiredDeps = [
  'expo',
  'expo-dev-client',
  'expo-updates',
  'react-native-vision-camera',
  'react-native-nitro-modules',
];
for (const dep of requiredDeps) {
  try {
    require.resolve(dep, { paths: [root] });
  } catch {
    console.error(`missing dependency: ${dep}`);
    process.exit(1);
  }
}

console.log('lugin-mobile smoke ok');
