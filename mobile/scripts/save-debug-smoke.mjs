#!/usr/bin/env node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(mobileRoot, 'src/scan/saveDebugBundle.ts');
const esbuild = await createRequire(join(mobileRoot, '..', 'package.json')).call(null, 'esbuild');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) return;
  failures++;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
};

const bundleDir = await mkdtemp(join(tmpdir(), 'lugin-dbg-'));
const stub = join(bundleDir, 'rn-stub.mjs');
const outfile = join(bundleDir, 'saveDebug.mjs');
await writeFile(
  stub,
  'export const Platform = { OS: "android" };\nexport const Share = { share: async () => ({ action: "sharedAction" }) };\n',
);

try {
  await esbuild.build({
    alias: { 'react-native': stub },
    bundle: true,
    entryPoints: [entry],
    format: 'esm',
    outfile,
    platform: 'neutral',
    tsconfigRaw: {
      compilerOptions: { baseUrl: mobileRoot, paths: { '@/*': ['../src/*'] } },
    },
  });

  const { buildDebugReport, formatDebugReportText } = await import(pathToFileURL(outfile).href);
  const report = buildDebugReport({
    analysisLongEdge: 480,
    deviceLine: 'Back Triple Camera',
    panel: { phase: 'locking', artCandidates: [{ name: 'Sol Ring', score: 0.7 }] },
    preferredSource: 'snapshot',
    stamp: 'test',
  });
  check('report has generatedAt', typeof report.generatedAt === 'string');
  check('report keeps panel payload', report.panel.phase === 'locking');
  const text = formatDebugReportText(report);
  check('text starts with banner', text.startsWith('Lugin scan debug\n'));
  check('text is JSON-ish', text.includes('"phase": "locking"'));

  if (failures > 0) {
    console.error(`save-debug smoke: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('save-debug smoke ok');
} finally {
  await rm(bundleDir, { force: true, recursive: true });
}
