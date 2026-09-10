#!/usr/bin/env node
// Summarize card-swap-test inbox bundles. Does not run recognition.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as esbuild from 'esbuild';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const inboxRoot = join(rootDir, '.scan-inbox/sessions');

const loadScan = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lugin-swap-'));
  const bundle = join(dir, 'scan.mjs');
  await esbuild.build({
    alias: { '@': join(rootDir, 'src') },
    bundle: true,
    format: 'esm',
    outfile: bundle,
    platform: 'neutral',
    stdin: {
      contents: `
        export { summarizeSwapCorpus, summarizeSwapTest } from '${join(rootDir, 'src/lib/scan/swapTest/summarize.ts')}';
      `,
      resolveDir: rootDir,
      sourcefile: 'swap-entry.ts',
    },
  });
  return import(pathToFileURL(bundle).href);
};

const listBundles = () => {
  if (!existsSync(inboxRoot)) return [];
  const out = [];
  for (const session of readdirSync(inboxRoot, { withFileTypes: true })) {
    if (!session.isDirectory()) continue;
    const sessionDir = join(inboxRoot, session.name);
    for (const trace of readdirSync(sessionDir, { withFileTypes: true })) {
      if (!trace.isDirectory() || !trace.name.startsWith('swap-test-')) continue;
      const summaryPath = join(sessionDir, trace.name, 'summary.json');
      if (!existsSync(summaryPath)) continue;
      out.push({
        bundle: JSON.parse(readFileSync(summaryPath, 'utf8')),
        dir: join(sessionDir, trace.name),
      });
    }
  }
  return out.sort((a, b) => a.bundle.fixtureId.localeCompare(b.bundle.fixtureId));
};

const main = async () => {
  const filter = process.argv.slice(2).find(a => !a.startsWith('-')) ?? null;
  const scan = await loadScan();
  let entries = listBundles();
  if (filter) {
    entries = entries.filter(
      e => e.bundle.fixtureId.includes(filter) || e.dir.includes(filter),
    );
  }
  if (!entries.length) {
    console.log(
      filter
        ? `No swap-test bundles matching "${filter}" in .scan-inbox/sessions.`
        : 'No swap-test bundles in .scan-inbox/sessions.\nRun Card Swap Test on device, then yarn scan:inbox.',
    );
    process.exit(entries.length ? 0 : 1);
  }
  console.log(scan.summarizeSwapCorpus(entries.map(e => e.bundle)));
};

main().catch(err => {
  console.error(err);
  process.exit(1);
});
