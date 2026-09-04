#!/usr/bin/env node
/**
 * Offline smoke for benchmark ZIP + scoring helpers (no RN runtime).
 */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = await mkdtemp(join(tmpdir(), 'lugin-bench-smoke-'));
const outfile = join(dir, 'bench.mjs');

await esbuild.build({
  bundle: true,
  format: 'esm',
  outfile,
  platform: 'neutral',
  stdin: {
    contents: `
      export { buildStoreZip } from '${join(root, 'mobile/src/scan/benchmark/zipExport.ts')}';
      export { parseExpectedManifest, collectorNumbersEqual } from '${join(root, 'mobile/src/scan/benchmark/expectedManifest.ts')}';
      export { scoreAgainstExpected, collectFlags, mapWinningChannel } from '${join(root, 'mobile/src/scan/benchmark/scoreScan.ts')}';
      export { buildSessionSummary } from '${join(root, 'mobile/src/scan/benchmark/summary.ts')}';
    `,
    resolveDir: root,
    sourcefile: 'bench-smoke.ts',
  },
});

const {
  buildStoreZip,
  parseExpectedManifest,
  collectorNumbersEqual,
  scoreAgainstExpected,
  collectFlags,
  mapWinningChannel,
  buildSessionSummary,
} = await import(pathToFileURL(outfile).href);

assert.equal(collectorNumbersEqual('066', '66'), true);
assert.equal(collectorNumbersEqual('066', '67'), false);

const cards = parseExpectedManifest([
  { name: 'Pixie Guide', setCode: 'afr', collectorNumber: '066', finish: 'nonfoil' },
]);
assert.equal(cards[0].collectorNumber, '066');

const score = scoreAgainstExpected(
  {
    name: 'Pixie Guide',
    printing: { setCode: 'afr', collectorNumber: '66' },
    finish: 'nonfoil',
    status: 'identified',
    ocrPresent: true,
    earlyReason: 'footer-printing',
  },
  cards[0],
);
assert.equal(score.oracleOk, true);
assert.equal(score.printingOk, true);
assert.equal(score.finishOk, true);
assert.equal(mapWinningChannel('footer-printing'), 'footer');

const flags = collectFlags(
  { status: 'card-ambiguous', titleFooterConflict: true, ocrPresent: true },
  { ...score, printingOk: false, oracleOk: false, nameOk: false, finishOk: null, expected: cards[0] },
  { lockToFirstOracleMs: 2000, lockToFinalOracleMs: 2000, lockToPrintingMs: null },
);
assert.ok(flags.includes('conflict'));
assert.ok(flags.includes('ambiguous'));
assert.ok(flags.includes('failure'));
assert.ok(flags.includes('slow'));

const zip = buildStoreZip([
  { name: 'session.json', data: new TextEncoder().encode('{"ok":true}') },
  { name: 'scans/001-report.json', data: new TextEncoder().encode('{}') },
]);
assert.ok(zip.length > 64);
assert.equal(zip[0], 0x50); // P
assert.equal(zip[1], 0x4b); // K

const summary = buildSessionSummary(
  [
    {
      seq: 1,
      stamp: 'a',
      reportRelativePath: 'x',
      pngRelativePath: 'y',
      name: 'Pixie Guide',
      status: 'identified',
      earlyReason: 'footer-printing',
      winningChannel: 'footer',
      flags: [],
      score,
      latency: { lockToFirstOracleMs: 100, lockToFinalOracleMs: 120, lockToPrintingMs: 150 },
      uploadStatus: 'skipped',
      uploadAttempts: 0,
      uploadError: null,
    },
  ],
  50,
);
assert.equal(summary.scanned, 1);
assert.equal(summary.accuracy.oracle, 1);
assert.equal(summary.firstWinningChannel.footer, 1);

await writeFile(join(dir, 'ok.txt'), 'ok');
await rm(dir, { force: true, recursive: true });
console.log('benchmark smoke ok');
