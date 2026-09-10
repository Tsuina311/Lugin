#!/usr/bin/env node
// Host-only capture-policy simulation from recorded focus-series OCR.
// Does not call Android ML Kit. Does not change live capture.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as esbuild from 'esbuild';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const inboxRoot = join(rootDir, '.scan-inbox/sessions');

const loadScan = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lugin-policy-'));
  const bundle = join(dir, 'scan.mjs');
  await esbuild.build({
    alias: { '@': join(rootDir, 'src') },
    bundle: true,
    format: 'esm',
    outfile: bundle,
    platform: 'neutral',
    stdin: {
      contents: `
        export { formatCapturePolicyReport } from '${join(rootDir, 'src/lib/scan/focusSeries/report.ts')}';
      `,
      resolveDir: rootDir,
      sourcefile: 'policy-entry.ts',
    },
  });
  return import(pathToFileURL(bundle).href);
};

const listSeries = () => {
  if (!existsSync(inboxRoot)) return [];
  const out = [];
  for (const session of readdirSync(inboxRoot, { withFileTypes: true })) {
    if (!session.isDirectory()) continue;
    const sessionDir = join(inboxRoot, session.name);
    for (const trace of readdirSync(sessionDir, { withFileTypes: true })) {
      if (!trace.isDirectory() || !trace.name.startsWith('focus-series-')) continue;
      const metaPath = join(sessionDir, trace.name, 'metadata.json');
      if (!existsSync(metaPath)) continue;
      out.push(JSON.parse(readFileSync(metaPath, 'utf8')));
    }
  }
  return out;
};

const scan = await loadScan();
const series = listSeries();
if (!series.length) {
  console.log('No focus-series bundles in .scan-inbox. Nothing to simulate.');
} else {
  console.log(scan.formatCapturePolicyReport(series));
}
