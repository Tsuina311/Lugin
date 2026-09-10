#!/usr/bin/env node
/**
 * yarn geometry:candidates
 *
 * Top-K / sleeve / nested / latent multi-card diagnosis on synthetic suites.
 * Uses production DetectCard.kt shortlist via host runner (no threshold changes).
 *
 *   yarn geometry:candidates --suite=sleeve
 *   yarn geometry:candidates --suite=all
 *   yarn geometry:candidates --suite=sleeve --engine=native --native-input=y-from-rgba --top=5
 *
 * SYNTHETIC ONLY — not real-device accuracy.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  aggregateCandidateReport,
  analyzeFixture,
  formatPct,
  MATCH_IOU,
} from './lib/candidates-analyze.mjs';
import { loadDetectScan, runHostDetector } from './lib/detect-host.mjs';
import { runNativeDetectorBatch } from './lib/detect-native.mjs';
import { CORPUS_ROOT, rootDir } from './lib/paths.mjs';
import { loadSyntheticFixtures, SYNTHETIC_ROOT } from './lib/synthetic/generate.mjs';

const flag = name => process.argv.includes(`--${name}`);
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(`--${name}=`.length);

const suiteArg = arg('suite') || 'sleeve';
const engineArg = (arg('engine') || 'native').toLowerCase();
const nativeInput = (arg('native-input') || 'y-from-rgba').toLowerCase();
const top = Number(arg('top') || 5);
const suites =
  suiteArg === 'all'
    ? ['dark', 'perspective', 'glare', 'sleeve', 'occlusion', 'binder', 'overlap', 'scattered']
    : [suiteArg];

const { scan } = await loadDetectScan();
const polygonIoU = scan.polygonIoU;

const collectNative = async fixtures => {
  const batchDir = join(
    CORPUS_ROOT,
    `native-batch-candidates-${suiteArg}-${nativeInput}`.replace(/[^\w.-]+/g, '_'),
  );
  return runNativeDetectorBatch(fixtures, { inputMode: nativeInput, batchDir });
};

const collectJs = async fixtures => {
  const map = new Map();
  for (const f of fixtures) {
    const abs = join(rootDir, f.image);
    const det = await runHostDetector(abs);
    map.set(f.id, {
      ...det,
      inputMode: 'rgba',
    });
  }
  return map;
};

console.log('GEOMETRY CANDIDATE ANALYSIS');
console.log('─'.repeat(56));
console.log('SYNTHETIC ONLY — not real-device accuracy. No detector tuning.');
console.log(`Suites: ${suites.join(', ')}`);
console.log(`Engine: ${engineArg}  input: ${engineArg === 'js' ? 'rgba' : nativeInput}  top=${top}`);
console.log(`Match IoU threshold: ${MATCH_IOU}`);
console.log('');

const allAnalyses = [];
const bySuite = {};

for (const suite of suites) {
  let fixtures = await loadSyntheticFixtures({ suite });
  if (!fixtures.length) {
    console.warn(`skip suite=${suite} (no fixtures — yarn geometry:synthetic --suite=${suite})`);
    continue;
  }
  console.log(`▸ suite=${suite} n=${fixtures.length}`);

  let detections;
  if (engineArg === 'js') {
    detections = await collectJs(fixtures);
  } else if (engineArg === 'both') {
    const native = await collectNative(fixtures);
    const js = await collectJs(fixtures);
    // Prefer native for primary report; stash js separately
    detections = native;
    bySuite[`${suite}__js`] = [];
    for (const f of fixtures) {
      const a = analyzeFixture(f, js.get(f.id), polygonIoU, { top });
      bySuite[`${suite}__js`].push(a);
    }
  } else {
    detections = await collectNative(fixtures);
  }

  const analyses = [];
  for (const f of fixtures) {
    const a = analyzeFixture(f, detections.get(f.id), polygonIoU, { top });
    analyses.push(a);
    allAnalyses.push(a);
  }
  bySuite[suite] = analyses;

  const agg = aggregateCandidateReport(analyses);
  printSuiteSummary(suite, agg);
}

const overall = aggregateCandidateReport(allAnalyses);
console.log('\n' + '═'.repeat(56));
console.log('OVERALL (requested suites)');
printSuiteSummary('overall', overall);

// Sleeve deep dive
if (overall.sleeve?.n) {
  console.log('\nSLEEVE ROOT CAUSE');
  const s = overall.sleeve;
  console.log(`  cases=${s.n}  chose card=${s.choseCard}  chose sleeve=${s.choseSleeve}  other=${s.choseOther}`);
  console.log(
    `  of sleeve wins: good card candidate present=${s.sleeveWinsWithGoodCardCandidate}  absent=${s.sleeveWinsWithoutGoodCardCandidate}`,
  );
  console.log(
    `  sleeve wins despite nestedInnerPreferred=${s.sleeveWinsDespiteNestedInner ?? '—'}`,
  );
  console.log(`  median rank of good card candidate (when present)=${s.medianCardRankWhenPresent}`);
  console.log(
    `  median score margin (sleeve − card)=${
      s.medianScoreMarginSleeveMinusCard != null
        ? s.medianScoreMarginSleeveMinusCard.toFixed(4)
        : '—'
    }`,
  );
  console.log(
    `  median selected IoU(sleeve)−IoU(card)=${
      s.medianSelectedIouSleeveMinusCard != null
        ? s.medianSelectedIouSleeveMinusCard.toFixed(4)
        : '—'
    }`,
  );
  if (s.meanComponentDeltasSleeveMinusCard) {
    const d = s.meanComponentDeltasSleeveMinusCard;
    console.log(
      `  mean component Δ (sleeve−card): aspect=${d.aspect.toFixed(3)} parallel=${d.parallel.toFixed(3)} area=${d.area.toFixed(3)} center=${d.center.toFixed(3)}`,
    );
  }
  console.log('  nested behaviors:', JSON.stringify(s.nestedBehaviors));
}

if (overall.latentMultiCard) {
  console.log('\nMULTI-CARD LATENT RECALL (raw shortlist, ignore final≤1)');
  for (const [name, block] of Object.entries({
    binder: overall.latentMultiCard.binder,
    overlap: overall.latentMultiCard.overlap,
    scattered: overall.latentMultiCard.scattered,
  })) {
    if (!block) continue;
    console.log(
      `  ${name}: scenes=${block.scenes}  final ${block.finalSelectedVsGt} (${formatPct(block.finalRecall)})  latent@0.8 ${block.latentMatched80}/${block.gtCards} (${formatPct(block.latentRecall80)})`,
    );
  }
}

console.log('\nCANDIDATE COUNTS (host)');
console.log(
  `  shortlist p50/p95/max = ${overall.candidateCounts.shortlist.p50}/${overall.candidateCounts.shortlist.p95}/${overall.candidateCounts.shortlist.max}`,
);
console.log(
  `  raw consider p50/p95/max = ${overall.candidateCounts.raw.p50}/${overall.candidateCounts.raw.p95}/${overall.candidateCounts.raw.max}`,
);
console.log(
  `  runtime host ms p50/p95/max = ${overall.runtimeHostMs.p50}/${overall.runtimeHostMs.p95}/${overall.runtimeHostMs.max}  (${overall.runtimeHostMs.note})`,
);

await mkdir(SYNTHETIC_ROOT, { recursive: true });
const outName = `candidates-${suiteArg}-${engineArg}-${nativeInput}.json`.replace(
  /[^\w.-]+/g,
  '_',
);
const outPath = join(SYNTHETIC_ROOT, outName);
const payload = {
  kind: 'geometry-candidate-analysis',
  note: 'SYNTHETIC diagnosis only — not real-device accuracy. Production detector unchanged.',
  generatedAt: new Date().toISOString(),
  suite: suiteArg,
  suites,
  engine: engineArg,
  nativeInput: engineArg === 'js' ? null : nativeInput,
  top,
  thresholds: {
    MATCH_IOU,
    STRONG_IOU: 0.9,
    EXCELLENT_IOU: 0.95,
    AMBIGUOUS_SCORE_MARGIN: 0.03,
  },
  overall,
  bySuite: Object.fromEntries(
    Object.entries(bySuite).map(([k, list]) => [k, aggregateCandidateReport(list)]),
  ),
  fixtures: allAnalyses,
};
await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`);

// Compact HTML explorer for sleeve / failures
const html = buildExplorerHtml(payload);
const htmlPath = join(SYNTHETIC_ROOT, `candidates-${suiteArg}-explorer.html`);
await writeFile(htmlPath, html);

console.log(`\nWrote ${outPath}`);
console.log(`Explorer ${htmlPath}`);
console.log('Production DetectCard selection/thresholds: unchanged.');

function printSuiteSummary(label, agg) {
  console.log(`\n[${label}] fixtures=${agg.fixtures} single=${agg.singleCard} multi=${agg.multiCard}`);
  if (agg.singleCard) {
    const t = agg.topKSummary;
    const line = k =>
      `top${k === 'any' ? 'Any' : k.replace('top', '')}`.padEnd(8) +
      ` @0.8 ${formatPct(t[k].iou80.rate)}  @0.9 ${formatPct(t[k].iou90.rate)}  @0.95 ${formatPct(t[k].iou95.rate)}`;
    console.log('  TOP-K recall (single-card GT, IoU bands):');
    for (const k of ['top1', 'top2', 'top3', 'top5', 'any']) {
      console.log('   ', line(k));
    }
  }
  if (agg.failures.n) {
    console.log(`  FAILURES (selected IoU < ${MATCH_IOU}): n=${agg.failures.n}`);
    for (const [k, v] of Object.entries(agg.failures.counts)) {
      if (!v) continue;
      console.log(`    ${k}: ${v} (${formatPct(v / agg.failures.n)})`);
    }
  } else {
    console.log(`  FAILURES (selected IoU < ${MATCH_IOU}): none`);
  }
}

function buildExplorerHtml(payload) {
  const rows = (payload.fixtures || [])
    .map(f => {
      const g = f.perGt?.[0];
      const sleeve = g?.sleeveAnalysis;
      return {
        id: f.id,
        suite: f.suite,
        shortlist: f.shortlistCount,
        raw: f.rawCandidateCount,
        selectedIou: g?.selectedIou,
        bestIou: g?.bestCandidateIou,
        bestRank: g?.bestCandidateRank,
        failure: g?.failureCategory,
        sleeveWinner: sleeve?.winner,
        cardRank: sleeve?.cardRank,
        margin: sleeve?.components?.scoreMargin,
        nested: f.nested?.behavior,
        latent80: f.latent?.matchedAt80,
        gtCount: f.latent?.gtCount,
      };
    })
    .sort((a, b) => (a.selectedIou ?? 1) - (b.selectedIou ?? 1));

  return `<!doctype html>
<meta charset=utf-8>
<title>Candidate explorer · ${payload.suite}</title>
<style>
  body{font:13px/1.4 ui-sans-serif,system-ui;margin:16px;background:#12141a;color:#e8eaef}
  table{border-collapse:collapse;width:100%}
  th,td{border:1px solid #2e3340;padding:4px 8px;text-align:left}
  th{background:#1b1e27;position:sticky;top:0}
  .bad{color:#ff6b6b}.ok{color:#3dd68c}.warn{color:#f5a524}
  code{color:#9aa3b2}
</style>
<h1>Candidate analysis · ${payload.suite}</h1>
<p>SYNTHETIC only. Engine=${payload.engine} input=${payload.nativeInput}. Match IoU≥${MATCH_IOU}.</p>
<p><code>${outName}</code></p>
<table>
<thead><tr>
<th>id</th><th>suite</th><th>selIoU</th><th>bestIoU</th><th>bestRank</th><th>failure</th>
<th>sleeve</th><th>cardRank</th><th>margin</th><th>nested</th><th>latent80/gt</th><th>short/raw</th>
</tr></thead>
<tbody>
${rows
  .map(r => {
    const selCls = (r.selectedIou ?? 0) >= MATCH_IOU ? 'ok' : 'bad';
    return `<tr>
<td>${r.id}</td><td>${r.suite || ''}</td>
<td class="${selCls}">${r.selectedIou?.toFixed?.(3) ?? '—'}</td>
<td>${r.bestIou?.toFixed?.(3) ?? '—'}</td><td>${r.bestRank ?? '—'}</td>
<td>${r.failure || '—'}</td>
<td>${r.sleeveWinner || '—'}</td><td>${r.cardRank ?? '—'}</td>
<td>${r.margin != null ? r.margin.toFixed(4) : '—'}</td>
<td>${r.nested || '—'}</td>
<td>${r.latent80 ?? '—'}/${r.gtCount ?? '—'}</td>
<td>${r.shortlist}/${r.raw ?? '—'}</td>
</tr>`;
  })
  .join('\n')}
</tbody>
</table>`;
}
