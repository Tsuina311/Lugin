#!/usr/bin/env node
/**
 * yarn scan:deck-report
 *
 * Summarize latest (or named) Deck Benchmark inbox bundle.
 * Generates lightweight HTML review for unresolved cases only.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as esbuild from 'esbuild';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const inboxRoot = join(rootDir, '.scan-inbox/sessions');
const outRoot = join(rootDir, '.scan-inbox/deck-reports');

const loadScan = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lugin-deck-'));
  const bundle = join(dir, 'scan.mjs');
  await esbuild.build({
    alias: { '@': join(rootDir, 'src') },
    bundle: true,
    format: 'esm',
    outfile: bundle,
    platform: 'neutral',
    stdin: {
      contents: `
        export { summarizeDeckBenchmark, reconcileDeckMultiset } from '${join(
          rootDir,
          'src/lib/scan/deckBenchmark/index.ts',
        )}';
      `,
      resolveDir: rootDir,
      sourcefile: 'deck-entry.ts',
    },
  });
  return import(pathToFileURL(bundle).href);
};

const findBundles = () => {
  if (!existsSync(inboxRoot)) return [];
  const out = [];
  for (const session of readdirSync(inboxRoot, { withFileTypes: true })) {
    if (!session.isDirectory()) continue;
    const sessionDir = join(inboxRoot, session.name);
    for (const trace of readdirSync(sessionDir, { withFileTypes: true })) {
      if (!trace.isDirectory()) continue;
      const summaryPath = join(sessionDir, trace.name, 'summary.json');
      if (!existsSync(summaryPath)) continue;
      try {
        const bundle = JSON.parse(readFileSync(summaryPath, 'utf8'));
        if (bundle?.kind !== 'deck-benchmark') continue;
        out.push({ bundle, dir: join(sessionDir, trace.name) });
      } catch {
        /* skip */
      }
    }
  }
  return out.sort((a, b) => b.bundle.fixtureId.localeCompare(a.bundle.fixtureId));
};

const htmlReview = (bundle, unresolved, dir) => {
  const rows = unresolved
    .map(u => {
      const stem = `deck-${String(u.index).padStart(3, '0')}`;
      const card = `${stem}-card.png`;
      const img = existsSync(join(dir, card))
        ? `<img src="${card}" style="max-width:280px;border-radius:8px" />`
        : '<em>no card warp</em>';
      return `<section style="margin:24px 0;padding:12px;border:1px solid #333">
        <h3>#${u.index}</h3>
        ${img}
        <p>Predicted: <b>${u.predicted ?? '—'}</b> · ${u.reason ?? u.terminal}</p>
        <label>Expected name <input data-index="${u.index}" class="gt" style="width:320px" /></label>
      </section>`;
    })
    .join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Deck review ${bundle.fixtureId}</title>
<style>body{font-family:system-ui;background:#111;color:#eee;padding:16px} input{padding:8px}</style></head>
<body>
<h1>Unresolved only (${unresolved.length})</h1>
<p>Type expected name + Enter → next. Does not create circular GT from prediction alone.</p>
${rows}
<script>
const inputs=[...document.querySelectorAll('input.gt')];
const out=[];
inputs.forEach((el,i)=>{
  el.addEventListener('keydown',e=>{
    if(e.key!=='Enter')return;
    out.push({index:Number(el.dataset.index),expected:el.value.trim()});
    const n=inputs[i+1]; if(n)n.focus();
    console.log(JSON.stringify(out,null,2));
  });
});
</script>
</body></html>`;
};

const main = async () => {
  const filter = process.argv.slice(2).find(a => !a.startsWith('-')) ?? null;
  const scan = await loadScan();
  let entries = findBundles();
  if (filter) entries = entries.filter(e => e.bundle.fixtureId.includes(filter) || e.dir.includes(filter));
  if (!entries.length) {
    console.log('No deck-benchmark bundles in .scan-inbox/sessions.\nRun Deck Benchmark on device, then yarn scan:inbox.');
    process.exit(1);
  }
  const { bundle, dir } = entries[0];
  const summary = scan.summarizeDeckBenchmark(bundle);
  const recon = scan.reconcileDeckMultiset(bundle.cards, bundle.expectedMultiset);
  console.log('DECK BENCHMARK REPORT');
  console.log('─'.repeat(48));
  console.log(JSON.stringify(summary, null, 2));
  console.log('\nReconciliation:', recon.mode, 'paired', recon.paired?.length ?? 0, 'unresolved', recon.unresolved?.length ?? 0);
  mkdirSync(outRoot, { recursive: true });
  const reviewPath = join(outRoot, `${bundle.fixtureId}-review.html`);
  writeFileSync(reviewPath, htmlReview(bundle, recon.unresolved ?? [], dir));
  writeFileSync(join(outRoot, `${bundle.fixtureId}-report.json`), JSON.stringify({ summary, recon, dir }, null, 2));
  console.log(`\nWrote ${reviewPath}`);
};

main().catch(err => {
  console.error(err);
  process.exit(1);
});
