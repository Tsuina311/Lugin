#!/usr/bin/env node
/** Lightweight workspace smoke — full RN tests arrive with later milestones. */
const { existsSync, readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { dirname, join } = require('node:path');

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
const requireFromMobile = createRequire(join(root, 'package.json'));
for (const dep of requiredDeps) {
  try {
    requireFromMobile.resolve(dep);
  } catch {
    console.error(`missing dependency: ${dep}`);
    process.exit(1);
  }
}

let easPkg;
try {
  easPkg = requireFromMobile.resolve('eas-cli/package.json');
} catch {
  console.error('missing dependency: eas-cli');
  process.exit(1);
}

const easMeta = JSON.parse(readFileSync(easPkg, 'utf8'));
const easBinRel = easMeta.bin?.eas ?? easMeta.bin;
if (typeof easBinRel !== 'string') {
  console.error('eas-cli bin field missing');
  process.exit(1);
}
const easBin = join(dirname(easPkg), easBinRel);
if (!existsSync(easBin)) {
  console.error(`eas-cli bin not found: ${easBin}`);
  process.exit(1);
}

console.log('lugin-mobile smoke ok');
console.log(`eas-cli → ${easBin}`);
