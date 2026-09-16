#!/usr/bin/env node
/**
 * Host-side CLIP parity smoke — F16 index search vs oracle-map integrity.
 * Device parity requires Samsung APK; this validates packed assets match bakeoff.
 *
 * yarn recognition:parity-assets
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const assetDir = join(
  root,
  'mobile/modules/lugin-visual-recognizer/android/src/main/assets/lugin-visual',
);
const manifestPath = join(assetDir, 'manifest.json');

if (!existsSync(manifestPath)) {
  console.error('FAIL: packed assets missing — run yarn recognition:pack-visual');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const sha = buf => createHash('sha256').update(buf).digest('hex');

let ok = true;
for (const [key, meta] of Object.entries(manifest.files)) {
  const path = join(assetDir, meta.path);
  if (!existsSync(path)) {
    console.error(`FAIL missing ${key}: ${path}`);
    ok = false;
    continue;
  }
  const buf = readFileSync(path);
  const bytes = statSync(path).size;
  const hash = sha(buf);
  const bytesOk = bytes === meta.bytes;
  const hashOk = hash === meta.sha256;
  console.log(
    `${key.padEnd(12)} bytes=${bytes}${bytesOk ? '✓' : `≠${meta.bytes}`}  sha=${hash.slice(0, 12)}…${hashOk ? '✓' : ' MISMATCH'}`,
  );
  if (!bytesOk || !hashOk) ok = false;
}

console.log(
  `artCount=${manifest.artCount} oracleCount=${manifest.oracleCount} artCrop.v=${manifest.artCrop?.version}`,
);
if (manifest.artCount !== 49968) {
  console.error('FAIL unexpected artCount');
  ok = false;
}
if (manifest.artCrop?.version !== 1) {
  console.error('FAIL artCrop version');
  ok = false;
}

if (!ok) process.exit(1);
console.log('PASS packed visual assets integrity');
