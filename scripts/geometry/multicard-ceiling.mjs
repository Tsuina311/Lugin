#!/usr/bin/env node
/**
 * yarn geometry:multicard-ceiling
 *
 * Host diagnosis of multi-card candidate pipeline stages.
 * Does NOT raise production shortlist caps or change selection.
 *
 *   yarn geometry:multicard-ceiling --suite=binder
 *   yarn geometry:multicard-ceiling --suite=all
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadDetectScan } from './lib/detect-host.mjs';
import { runNativeDetectorBatch } from './lib/detect-native.mjs';
import { formatPct, matchQuadsByIoU } from './lib/metrics.mjs';
import { CORPUS_ROOT } from './lib/paths.mjs';
import { gtQuadToCorners, isCompleteQuad } from './lib/schema.mjs';
import { loadSyntheticFixtures, SYNTHETIC_ROOT } from './lib/synthetic/generate.mjs';

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(`--${name}=`.length);
const suiteArg = arg('suite') || 'binder';
const nativeInput = (arg('native-input') || 'y-from-rgba').toLowerCase();
const iouMatch = Number(arg('iou') || 0.8);

const suites =
  suiteArg === 'all' ? ['binder', 'overlap', 'scattered'] : [suiteArg];

const { scan } = await loadDetectScan();
const polygonIoU = scan.polygonIoU;

const stageNames = ['rawAfterQuad', 'postGates', 'postDedupe', 'shortlist', 'final'];

const coverageAt = (cands, gts, thr) => {
  const preds = (cands || []).map(c => c.quad || c.corners).filter(Boolean);
  const matching = matchQuadsByIoU(preds, gts, polygonIoU);
  const hit = matching.pairs.filter(p => p.iou >= thr).length;
  return {
    hit,
    gt: gts.length,
    recall: gts.length ? hit / gts.length : null,
    pairs: matching.pairs,
    unmatchedGt: matching.unmatchedGroundTruth,
    unmatchedPred: matching.unmatchedPredictions,
  };
};

/** GT-free multi-select: greedy score desc + NMS by IoU. */
const multiSelectNms = (cands, { maxCards = 12, nmsIou = 0.35 } = {}) => {
  const ranked = [...(cands || [])]
    .map(c => ({ ...c, corners: c.quad || c.corners, score: c.finalScore ?? c.score ?? 0 }))
    .filter(c => c.corners)
    .sort((a, b) => b.score - a.score);
  const kept = [];
  for (const c of ranked) {
    const overlap = kept.some(k => polygonIoU(k.corners, c.corners) >= nmsIou);
    if (overlap) continue;
    kept.push(c);
    if (kept.length >= maxCards) break;
  }
  return kept;
};

const classifyLoss = (gi, stageHits) => {
  // stageHits: { raw, gates, dedupe, shortlist, final } booleans
  if (!stageHits.raw) return 'never-generated';
  if (stageHits.raw && !stageHits.gates) return 'removed-by-gate';
  if (stageHits.gates && !stageHits.dedupe) return 'merged-deduped';
  if (stageHits.dedupe && !stageHits.shortlist) return 'lost-shortlist-cap';
  if (stageHits.shortlist && !stageHits.final) return 'lost-final-single-select';
  if (stageHits.final) return 'kept-final';
  return 'other';
};

console.log('RAW MULTI-CARD CEILING (host diagnosis)');
console.log('─'.repeat(56));
console.log('Production caps unchanged. Pipeline export only when GEOMETRY_NATIVE_PIPELINE=1.');
console.log(`Suites: ${suites.join(', ')}  input=${nativeInput}  matchIoU=${iouMatch}`);
console.log('');

const report = { suites: {}, generatedAt: new Date().toISOString() };

for (const suite of suites) {
  let fixtures = await loadSyntheticFixtures({ suite });
  if (!fixtures.length) {
    console.warn(`skip ${suite}: no fixtures (yarn geometry:synthetic --suite=${suite})`);
    continue;
  }
  console.log(`▸ ${suite} n=${fixtures.length}`);
  const detections = await runNativeDetectorBatch(fixtures, {
    inputMode: nativeInput,
    batchDir: join(CORPUS_ROOT, `native-batch-ceiling-${suite}`),
    exportPipeline: true,
  });

  const sceneRows = [];
  const lossCounts = {};
  const dupPerGt = [];
  let sumStages = {
    raw: { hit: 0, gt: 0 },
    gates: { hit: 0, gt: 0 },
    dedupe: { hit: 0, gt: 0 },
    shortlist: { hit: 0, gt: 0 },
    final: { hit: 0, gt: 0 },
    nmsRaw: { hit: 0, gt: 0 },
    nmsDedupe: { hit: 0, gt: 0 },
    nmsShortlist: { hit: 0, gt: 0 },
  };
  const byVisibility = {
    full: { raw: { hit: 0, gt: 0 }, shortlist: { hit: 0, gt: 0 } },
    partial: { raw: { hit: 0, gt: 0 }, shortlist: { hit: 0, gt: 0 } },
  };

  for (const f of fixtures) {
    const det = detections.get(f.id);
    const pipe = det?.pipeline;
    if (!pipe) {
      console.warn(`  missing pipeline for ${f.id}`);
      continue;
    }
    const gts = (f.cards || [])
      .map((c, gi) => ({
        gi,
        corners: isCompleteQuad(c.groundTruthQuad) ? gtQuadToCorners(c.groundTruthQuad) : null,
        visibleFraction: c.visibleFraction,
        occluded: c.occluded,
      }))
      .filter(g => g.corners);
    const gtCorners = gts.map(g => g.corners);

    const stages = {
      raw: coverageAt(pipe.rawAfterQuad, gtCorners, iouMatch),
      gates: coverageAt(pipe.postGates, gtCorners, iouMatch),
      dedupe: coverageAt(pipe.postDedupe, gtCorners, iouMatch),
      shortlist: coverageAt(pipe.shortlist, gtCorners, iouMatch),
      final: coverageAt(
        det?.corners ? [{ quad: det.corners, finalScore: det.score }] : [],
        gtCorners,
        iouMatch,
      ),
    };

    const nmsRaw = multiSelectNms(pipe.rawAfterQuad, { maxCards: Math.max(12, gts.length + 2) });
    const nmsDedupe = multiSelectNms(pipe.postDedupe, { maxCards: Math.max(12, gts.length + 2) });
    const nmsShort = multiSelectNms(pipe.shortlist, { maxCards: Math.max(12, gts.length + 2) });
    const nmsCov = {
      raw: coverageAt(nmsRaw, gtCorners, iouMatch),
      dedupe: coverageAt(nmsDedupe, gtCorners, iouMatch),
      shortlist: coverageAt(nmsShort, gtCorners, iouMatch),
    };

    for (const key of ['raw', 'gates', 'dedupe', 'shortlist', 'final']) {
      sumStages[key].hit += stages[key].hit;
      sumStages[key].gt += stages[key].gt;
    }
    sumStages.nmsRaw.hit += nmsCov.raw.hit;
    sumStages.nmsRaw.gt += nmsCov.raw.gt;
    sumStages.nmsDedupe.hit += nmsCov.dedupe.hit;
    sumStages.nmsDedupe.gt += nmsCov.dedupe.gt;
    sumStages.nmsShortlist.hit += nmsCov.shortlist.hit;
    sumStages.nmsShortlist.gt += nmsCov.shortlist.gt;

    // Per-GT loss classification + duplicates
    for (const g of gts) {
      const hitIn = list => {
        const cov = coverageAt(list, [g.corners], iouMatch);
        return cov.hit >= 1;
      };
      const stageHits = {
        raw: hitIn(pipe.rawAfterQuad),
        gates: hitIn(pipe.postGates),
        dedupe: hitIn(pipe.postDedupe),
        shortlist: hitIn(pipe.shortlist),
        final: hitIn(det?.corners ? [{ quad: det.corners }] : []),
      };
      const loss = classifyLoss(g.gi, stageHits);
      lossCounts[loss] = (lossCounts[loss] || 0) + 1;

      // duplicates in raw matching this GT
      const rawHits = (pipe.rawAfterQuad || []).filter(
        c => c.quad && polygonIoU(c.quad, g.corners) >= iouMatch,
      );
      dupPerGt.push(rawHits.length);

      const vis =
        g.occluded || (g.visibleFraction != null && g.visibleFraction < 0.99) ? 'partial' : 'full';
      byVisibility[vis].raw.gt += 1;
      byVisibility[vis].shortlist.gt += 1;
      if (stageHits.raw) byVisibility[vis].raw.hit += 1;
      if (stageHits.shortlist) byVisibility[vis].shortlist.hit += 1;
    }

    const falseAt = stage => {
      const cov = stages[stage];
      return cov.unmatchedPred?.length ?? 0;
    };

    sceneRows.push({
      id: f.id,
      gtCount: gts.length,
      counts: {
        consider: pipe.considerAttempts,
        raw: pipe.rawAfterQuadCount,
        postGates: pipe.postGatesCount,
        postDedupe: pipe.postDedupeCount,
        shortlist: pipe.shortlistCount,
      },
      recall80: {
        raw: stages.raw.recall,
        gates: stages.gates.recall,
        dedupe: stages.dedupe.recall,
        shortlist: stages.shortlist.recall,
        final: stages.final.recall,
      },
      hit80: {
        raw: stages.raw.hit,
        gates: stages.gates.hit,
        dedupe: stages.dedupe.hit,
        shortlist: stages.shortlist.hit,
        final: stages.final.hit,
      },
      nmsHit80: {
        raw: nmsCov.raw.hit,
        dedupe: nmsCov.dedupe.hit,
        shortlist: nmsCov.shortlist.hit,
      },
      falseCands: {
        raw: falseAt('raw'),
        shortlist: falseAt('shortlist'),
      },
    });
  }

  const aggRecall = key =>
    sumStages[key].gt ? sumStages[key].hit / sumStages[key].gt : null;

  console.log(`  Aggregate GT coverage @IoU≥${iouMatch} (sum over scenes):`);
  console.log(
    `    raw ${sumStages.raw.hit}/${sumStages.raw.gt} (${formatPct(aggRecall('raw'))})`,
  );
  console.log(
    `    post-gates ${sumStages.gates.hit}/${sumStages.gates.gt} (${formatPct(aggRecall('gates'))})`,
  );
  console.log(
    `    post-dedupe ${sumStages.dedupe.hit}/${sumStages.dedupe.gt} (${formatPct(aggRecall('dedupe'))})`,
  );
  console.log(
    `    shortlist ${sumStages.shortlist.hit}/${sumStages.shortlist.gt} (${formatPct(aggRecall('shortlist'))})`,
  );
  console.log(
    `    final ${sumStages.final.hit}/${sumStages.final.gt} (${formatPct(aggRecall('final'))})`,
  );
  console.log('  Host multi-select NMS upper bound (no GT in selector):');
  console.log(
    `    NMS(raw) ${sumStages.nmsRaw.hit}/${sumStages.nmsRaw.gt} (${formatPct(aggRecall('nmsRaw'))})`,
  );
  console.log(
    `    NMS(dedupe) ${sumStages.nmsDedupe.hit}/${sumStages.nmsDedupe.gt} (${formatPct(aggRecall('nmsDedupe'))})`,
  );
  console.log(
    `    NMS(shortlist) ${sumStages.nmsShortlist.hit}/${sumStages.nmsShortlist.gt} (${formatPct(aggRecall('nmsShortlist'))})`,
  );
  console.log('  Loss taxonomy (per GT card):');
  for (const [k, v] of Object.entries(lossCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k}: ${v}`);
  }
  const dups = [...dupPerGt].sort((a, b) => a - b);
  const medDup = dups.length ? dups[Math.floor(dups.length / 2)] : null;
  console.log(
    `  duplicate raw cands/GT (median/max): ${medDup}/${dups.length ? dups[dups.length - 1] : 0}`,
  );
  if (suite === 'overlap' || suite === 'scattered') {
    console.log('  By visibility:');
    for (const vis of ['full', 'partial']) {
      const b = byVisibility[vis];
      console.log(
        `    ${vis}: raw ${b.raw.hit}/${b.raw.gt} (${formatPct(b.raw.gt ? b.raw.hit / b.raw.gt : null)})  shortlist ${b.shortlist.hit}/${b.shortlist.gt} (${formatPct(b.shortlist.gt ? b.shortlist.hit / b.shortlist.gt : null)})`,
      );
    }
  }

  report.suites[suite] = {
    scenes: sceneRows.length,
    aggregate: sumStages,
    recall: {
      raw: aggRecall('raw'),
      gates: aggRecall('gates'),
      dedupe: aggRecall('dedupe'),
      shortlist: aggRecall('shortlist'),
      final: aggRecall('final'),
      nmsRaw: aggRecall('nmsRaw'),
      nmsDedupe: aggRecall('nmsDedupe'),
      nmsShortlist: aggRecall('nmsShortlist'),
    },
    lossCounts,
    medianRawDupPerGt: medDup,
    byVisibility,
    scenes: sceneRows,
  };
}

await mkdir(SYNTHETIC_ROOT, { recursive: true });
const outPath = join(SYNTHETIC_ROOT, `multicard-ceiling-${suiteArg}.json`);
await writeFile(
  outPath,
  `${JSON.stringify(
    {
      kind: 'multicard-ceiling',
      note: 'HOST diagnosis. Production shortlist cap=8 and single-select unchanged.',
      generatedAt: report.generatedAt,
      suite: suiteArg,
      nativeInput,
      iouMatch,
      ...report,
    },
    null,
    2,
  )}\n`,
);
console.log(`\nWrote ${outPath}`);
console.log('Production unchanged.');
