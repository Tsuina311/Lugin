#!/usr/bin/env node
/**
 * Train candidate rankers on the exported trusted frames.
 * Grouped folds are the development score. The frozen holdout is not used to choose a model.
 * Nothing here is copied to Android.
 *
 *   node scripts/scanner-benchmark/ranker/train.mjs
 */

import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { rootDir, reportsDir } from '../lib/paths.mjs';
import { ABLATIONS, DATASET_VERSION, FULL_FEATURES, vectorOf } from './schema.mjs';
import { initSplits, partition } from './splits.mjs';
import { evaluateFrames, baselineEval } from './evaluate.mjs';
import { challengerPasses, holdoutPasses, recommend } from './criteria.mjs';
import {
  fitBoostedTrees,
  fitLinearPairwise,
  fitLinearRegression,
  fitMlp,
  serializeModel,
  trainingPairs,
} from './models.mjs';

const dataDir = join(rootDir, 'scanner-benchmark/ranker-data', DATASET_VERSION);
const registryDir = join(rootDir, 'scanner-benchmark/ranker-registry');
const DIAGNOSTIC = [
  { card: 'Island cq-120629', image: '.scan-inbox/sessions/phone-20260908/cq-20260908T120629/photo-source.png' },
  { card: 'Wand cq-120751', image: '.scan-inbox/sessions/phone-20260908/cq-20260908T120751/photo-source.png' },
  { card: 'Livaan cq-120813', image: '.scan-inbox/sessions/phone-20260908/cq-20260908T120813/photo-source.png' },
  { card: 'Bulk Up', image: '.scan-inbox/sessions/geometry-test-20260910-162108/geom-001-source/geom-001-source.png' },
  { card: 'Mudbutton Torchrunner', image: '.scan-inbox/sessions/geometry-test-20260911-100459/geom-003-source/geom-003-source.png' },
];

const log = msg => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);
const fmt = (value, digits = 3) => (value == null || Number.isNaN(value) ? '—' : Number(value).toFixed(digits));
const pct = value => (value == null ? '—' : `${(value * 100).toFixed(1)}%`);

const loadFrames = async () => {
  const text = await readFile(join(dataDir, 'frames.jsonl'), 'utf8');
  return text.split('\n').filter(Boolean).map(line => JSON.parse(line));
};

const stack = (frames, names) => {
  const rows = [];
  const targets = [];
  const pairs = [];
  for (const frame of frames) {
    const base = rows.length;
    for (const candidate of frame.candidates) {
      rows.push(vectorOf(candidate.features, names));
      targets.push(candidate.iou);
    }
    for (const pair of trainingPairs(frame.candidates)) {
      pairs.push([
        base + frame.candidates.findIndex(row => row.index === pair.better.index),
        base + frame.candidates.findIndex(row => row.index === pair.worse.index),
      ]);
    }
  }
  return { rows, targets, pairs };
};

const GBM_OPTIONS = { depth: 3, rounds: 30, learningRate: 0.085, minLeaf: 6 };

const fitNamed = (kind, frames, names) => {
  const { rows, targets, pairs } = stack(frames, names);
  if (!rows.length) throw new Error(`no training rows for ${kind}`);
  if (kind === 'linear-iou') return fitLinearRegression(rows, targets);
  if (kind === 'linear-pairwise') return fitLinearPairwise(frames, candidate => vectorOf(candidate.features, names));
  if (kind === 'gbm-iou') return fitBoostedTrees(rows, targets, GBM_OPTIONS);
  if (kind === 'mlp-iou') return fitMlp(rows, targets, { pairwise: false });
  if (kind === 'mlp-pairwise') return fitMlp(rows, targets, { pairwise: true, pairIndex: pairs });
  throw new Error(kind);
};

const selectFrame = (model, frame, names) => {
  let best = null;
  let second = null;
  for (const candidate of frame.candidates) {
    const utility = model.utility(vectorOf(candidate.features, names));
    const row = { utility, index: candidate.index, iou: candidate.iou, detectorScore: candidate.detectorScore };
    if (!best || utility > best.utility + 1e-12 || (Math.abs(utility - best.utility) <= 1e-12 && candidate.detectorScore > best.detectorScore)) {
      second = best;
      best = row;
    } else if (!second || utility > second.utility) second = row;
  }
  return best ? { ...best, secondUtility: second?.utility ?? null } : { index: -1, iou: 0, utility: null, secondUtility: null };
};

const rankOfOracle = (model, frame, names) => {
  const scored = frame.candidates.map(candidate => ({
    index: candidate.index,
    utility: model.utility(vectorOf(candidate.features, names)),
    detectorScore: candidate.detectorScore,
  })).sort((a, b) => b.utility - a.utility || b.detectorScore - a.detectorScore || a.index - b.index);
  const place = scored.findIndex(row => row.index === frame.oracleIndex);
  return place < 0 ? null : place + 1;
};

const crossValidate = (kind, names, byFold) => {
  const foldIds = [...byFold.keys()].sort((a, b) => a - b);
  const pooled = [];
  const folds = [];
  for (const foldId of foldIds) {
    const test = byFold.get(foldId) ?? [];
    const train = foldIds.filter(id => id !== foldId).flatMap(id => byFold.get(id));
    if (!test.length || !train.length) continue;
    const model = fitNamed(kind, train, names);
    const modelEval = evaluateFrames(test, frame => selectFrame(model, frame, names));
    const currentEval = baselineEval(test, 'current');
    pooled.push(...modelEval.rows.map(row => ({ ...row, foldId })));
    folds.push({
      foldId,
      oracleFrames: modelEval.oracleFrames,
      modelRecovery: modelEval.oracleRecovery,
      baselineRecovery: currentEval.oracleRecovery,
      goodToBad: modelEval.goodToBad,
    });
  }
  const micro = evaluateFrames(pooled.map(row => ({
    id: row.id,
    image: row.image,
    label: row.label,
    captureGroup: row.captureGroup,
    oracleBestIou: row.oracleIou,
    hasGoodCandidate: row.hasGoodCandidate,
    noUsableCandidate: row.noUsableCandidate,
    baselines: { current: { iou: row.currentIou, index: -1 } },
    candidates: [],
  })), frame => {
    const row = pooled.find(item => item.id === frame.id);
    return { index: row.selectedIndex, iou: row.selectedIou, utility: row.utility, secondUtility: row.secondUtility };
  });
  const current = evaluateFrames(pooled.map(row => ({
    ...row,
    oracleBestIou: row.oracleIou,
    baselines: { current: { iou: row.currentIou, index: -1 } },
    candidates: [],
    hasGoodCandidate: row.hasGoodCandidate,
    noUsableCandidate: row.noUsableCandidate,
  })), frame => ({ index: -1, iou: pooled.find(item => item.id === frame.id).currentIou }));
  const eligible = folds.filter(fold => fold.oracleFrames > 0 && fold.modelRecovery != null && fold.baselineRecovery != null);
  const foldsWon = eligible.filter(fold => fold.modelRecovery >= fold.baselineRecovery && fold.goodToBad === 0).length;
  return { micro, current, folds, foldsWon, foldCount: eligible.length, pooled };
};

const FAMILIES = [
  { kind: 'linear-iou', family: 'linear' },
  { kind: 'linear-pairwise', family: 'linear' },
  { kind: 'gbm-iou', family: 'tree' },
  { kind: 'mlp-iou', family: 'mlp' },
  { kind: 'mlp-pairwise', family: 'mlp' },
];

const markdownTable = rows => [rows[0], rows[0].map(() => '---'), ...rows.slice(1)].map(row => `| ${row.join(' | ')} |`).join('\n');

const metricCells = metrics => [
  `${metrics.good80}/${metrics.n}`,
  `${metrics.usable70}/${metrics.n}`,
  fmt(metrics.median),
  fmt(metrics.p10),
  String(metrics.catastrophic),
  fmt(metrics.meanGap),
  pct(metrics.oracleRecovery),
  String(metrics.improved ?? '—'),
  String(metrics.regressed ?? '—'),
  String(metrics.goodToBad ?? '—'),
];

const main = async () => {
  const manifest = JSON.parse(await readFile(join(dataDir, 'manifest.json'), 'utf8'));
  const frames = await loadFrames();
  const trusted = frames.filter(frame => frame.labelAuthority === 'human' && frame.source === 'trusted-real');
  const auxiliary = frames.filter(frame => frame.labelAuthority !== 'human');
  const splits = initSplits(trusted, JSON.parse(await readFile(join(dataDir, 'splits.json'), 'utf8')));
  const { cv, frozen, byFold } = partition(trusted, splits);
  log(`trusted ${trusted.length} cv ${cv.length} holdout ${frozen.length} folds ${byFold.size}`);

  const fullRuns = [];
  for (const spec of FAMILIES) {
    log(spec.kind);
    const cvResult = crossValidate(spec.kind, FULL_FEATURES, byFold);
    const passed = challengerPasses({
      oracleRecovery: cvResult.micro.oracleRecovery ?? 0,
      baselineRecovery: cvResult.current.oracleRecovery ?? 0,
      catastrophic: cvResult.micro.catastrophic,
      baselineCatastrophic: cvResult.current.catastrophic,
      goodToBad: cvResult.micro.goodToBad,
      foldsWon: cvResult.foldsWon,
      foldCount: cvResult.foldCount,
    });
    fullRuns.push({ ...spec, features: 'all', cv: cvResult, passed });
    log(`${spec.kind} recovery ${fmt(cvResult.micro.oracleRecovery, 3)} pass ${passed}`);
  }

  const byRecovery = (a, b) => (b.cv.micro.oracleRecovery ?? -1) - (a.cv.micro.oracleRecovery ?? -1)
    || a.cv.micro.goodToBad - b.cv.micro.goodToBad;
  const bestFamily = [...fullRuns].sort(byRecovery)[0];
  const ablations = [];
  for (const ablation of ABLATIONS) {
    if (ablation.id === 'all') {
      ablations.push({ id: ablation.id, cv: bestFamily.cv, passed: bestFamily.passed });
      continue;
    }
    log(`ablation ${bestFamily.kind} ${ablation.id}`);
    const cvResult = crossValidate(bestFamily.kind, ablation.features, byFold);
    const passed = challengerPasses({
      oracleRecovery: cvResult.micro.oracleRecovery ?? 0,
      baselineRecovery: cvResult.current.oracleRecovery ?? 0,
      catastrophic: cvResult.micro.catastrophic,
      baselineCatastrophic: cvResult.current.catastrophic,
      goodToBad: cvResult.micro.goodToBad,
      foldsWon: cvResult.foldsWon,
      foldCount: cvResult.foldCount,
    });
    ablations.push({ id: ablation.id, features: ablation.features, cv: cvResult, passed });
  }
  const pool = [
    ...fullRuns.map(run => ({ kind: run.kind, ablation: 'all', names: FULL_FEATURES, cv: run.cv, passed: run.passed })),
    ...ablations.filter(row => row.id !== 'all').map(row => ({
      kind: bestFamily.kind,
      ablation: row.id,
      names: row.features,
      cv: row.cv,
      passed: row.passed,
    })),
  ];
  const chosen = [...pool].sort((a, b) => Number(b.passed) - Number(a.passed) || byRecovery(a, b))[0];
  const featureNames = chosen.names;
  const refit = cv.length ? fitNamed(chosen.kind, cv, featureNames) : null;
  const holdoutEval = refit ? evaluateFrames(frozen, frame => selectFrame(refit, frame, featureNames)) : null;
  const holdoutCurrent = baselineEval(frozen, 'current');
  const holdoutOk = holdoutEval ? holdoutPasses({
    n: holdoutEval.n,
    oracleRecovery: holdoutEval.oracleRecovery ?? 0,
    baselineRecovery: holdoutCurrent.oracleRecovery ?? 0,
    catastrophic: holdoutEval.catastrophic,
    baselineCatastrophic: holdoutCurrent.catastrophic,
    goodToBad: holdoutEval.goodToBad,
  }) : false;
  const anyPass = Boolean(chosen?.passed);
  const recommendation = recommend({ anyPass, holdoutOk });

  const started = performance.now();
  if (refit) {
    for (let i = 0; i < 50; i++) for (const frame of cv) selectFrame(refit, frame, featureNames);
  }
  const inferenceMs = refit && cv.length ? (performance.now() - started) / (50 * cv.length) : null;

  mkdirSync(join(registryDir, 'challengers'), { recursive: true });
  const artifact = refit ? {
    schemaVersion: 1,
    status: chosen.passed ? 'PASS' : 'FAIL',
    role: 'challenger',
    pipeline: 'PIPELINE / EARLY MODEL',
    kind: chosen.kind,
    ablation: chosen.ablation,
    featureSchema: manifest.featureSchema,
    featureNames,
    datasetHash: manifest.datasetHash,
    git: manifest.git,
    createdAt: new Date().toISOString(),
    metrics: {
      cv: strip(chosen.cv.micro),
      holdout: holdoutEval ? strip(holdoutEval) : null,
      recommendation,
    },
    model: serializeModel(refit),
  } : null;
  if (artifact) {
    const path = join(registryDir, 'challengers', `${chosen.kind}-${chosen.ablation}-${manifest.datasetHash.slice(0, 12)}.json`);
    await writeFile(path, JSON.stringify(artifact));
    artifact.path = path;
    artifact.bytes = JSON.stringify(artifact).length;
  }
  const championPath = join(registryDir, 'champion.json');
  if (!existsSync(championPath)) {
    await writeFile(championPath, `${JSON.stringify({
      role: 'champion',
      kind: 'heuristic',
      id: 'current-selector',
      note: 'Approved selector until a human promotes a passing challenger. Training does not promote.',
    }, null, 2)}\n`);
  }

  const queue = auxiliary.map(frame => {
    const picked = refit ? selectFrame(refit, frame, featureNames) : { index: frame.baselines.current.index, utility: null, secondUtility: null, iou: frame.baselines.current.iou };
    const margin = picked.utility == null || picked.secondUtility == null ? null : picked.utility - picked.secondUtility;
    const scores = frame.candidates.map(candidate => candidate.detectorScore).sort((a, b) => b - a);
    return {
      id: frame.id,
      image: frame.image,
      label: frame.label,
      captureGroup: frame.captureGroup,
      disagree: picked.index !== frame.baselines.current.index,
      margin,
      weak: picked.utility != null && bestFamily.kind.endsWith('iou') && picked.utility < 0.7,
      ambiguousDetector: scores.length > 1 && scores[0] - scores[1] < 0.02,
    };
  }).filter(row => row.disagree || row.weak || (row.margin != null && row.margin < 0.05) || row.ambiguousDetector)
    .sort((a, b) => Number(b.disagree) - Number(a.disagree) || (a.margin ?? 1) - (b.margin ?? 1))
    .slice(0, 20);
  await writeFile(join(dataDir, 'annotation-queue.json'), `${JSON.stringify({ note: 'Human review queue. These rows are not labels.', queue }, null, 2)}\n`);

  const oofModels = new Map();
  const modelForFrame = frame => {
    if (splits.holdoutGroups.includes(frame.captureGroup)) return refit;
    const fold = splits.folds[frame.captureGroup];
    if (!oofModels.has(fold)) {
      const train = [...byFold.keys()].filter(id => id !== fold).flatMap(id => byFold.get(id));
      oofModels.set(fold, fitNamed(chosen.kind, train, featureNames));
    }
    return oofModels.get(fold);
  };
  const diagnostic = DIAGNOSTIC.map(item => {
    const frame = trusted.find(row => row.image === item.image);
    if (!frame || !refit) return { ...item, missing: !frame };
    const model = modelForFrame(frame);
    const picked = selectFrame(model, frame, featureNames);
    const membership = splits.holdoutGroups.includes(frame.captureGroup) ? 'holdout' : `fold ${splits.folds[frame.captureGroup]}`;
    return {
      ...item,
      membership,
      currentIou: frame.baselines.current.iou,
      oracleIou: frame.oracleBestIou,
      selectedIou: picked.iou,
      oracleRank: rankOfOracle(model, frame, featureNames),
    };
  });

  const tagCounts = {};
  for (const frame of trusted) for (const tag of frame.tags) tagCounts[tag] = (tagCounts[tag] ?? 0) + 1;
  const report = {
    pipeline: 'PIPELINE / EARLY MODEL',
    recommendation,
    trustedFrames: trusted.length,
    trustedGroups: new Set(trusted.map(frame => frame.captureGroup)).size,
    cvFrames: cv.length,
    holdoutFrames: frozen.length,
    candidates: trusted.reduce((sum, frame) => sum + frame.candidates.length, 0),
    inferenceMs,
    artifactBytes: artifact?.bytes ?? null,
    challengerStatus: artifact?.status ?? null,
    kind: chosen?.kind ?? null,
    ablation: chosen?.ablation ?? null,
    ablationFamily: bestFamily?.kind ?? null,
    anyPass,
    holdoutOk,
  };
  await writeFile(join(reportsDir, 'ranker-v1.md'), render({
    manifest,
    report,
    current: baselineEval(cv, 'current'),
    maxScore: baselineEval(cv, 'maxScore'),
    peaked: baselineEval(cv, 'peaked'),
    oracle: evaluateFrames(cv, frame => ({ index: frame.oracleIndex, iou: frame.oracleBestIou })),
    holdoutCurrent,
    holdoutMax: baselineEval(frozen, 'maxScore'),
    holdoutPeaked: baselineEval(frozen, 'peaked'),
    holdoutOracle: evaluateFrames(frozen, frame => ({ index: frame.oracleIndex, iou: frame.oracleBestIou })),
    holdoutEval,
    fullRuns,
    ablations,
    diagnostic,
    tagCounts,
    queue,
    trusted,
  }));
  await writeFile(join(reportsDir, 'ranker-v1.json'), JSON.stringify({ ...report, diagnostic, queue: queue.length }, null, 2));
  log(`${recommendation} ${bestFamily?.kind ?? ''} ${artifact?.status ?? ''}`);
};

const strip = metrics => ({
  n: metrics.n,
  good80: metrics.good80,
  usable70: metrics.usable70,
  median: metrics.median,
  p10: metrics.p10,
  catastrophic: metrics.catastrophic,
  meanGap: metrics.meanGap,
  oracleRecovery: metrics.oracleRecovery,
  improved: metrics.improved,
  regressed: metrics.regressed,
  goodToBad: metrics.goodToBad,
});

const render = ctx => {
  const lines = [];
  lines.push('# CANDIDATE RANKER V1');
  lines.push('');
  lines.push('**PIPELINE / EARLY MODEL.** This is not a production-ready selector. The trusted real sample is too small to support that claim.');
  lines.push('');
  lines.push(`Recommendation: **${ctx.report.recommendation}**`);
  lines.push('');
  lines.push(`Trusted frames ${ctx.report.trustedFrames} across ${ctx.report.trustedGroups} capture groups. Candidates ${ctx.report.candidates}. Cross-validation frames ${ctx.report.cvFrames}. Frozen holdout frames ${ctx.report.holdoutFrames}.`);
  lines.push('');
  lines.push('## GROUPED CV');
  lines.push('');
  lines.push('Baselines and models below are scored on the cross-validation frames only.');
  lines.push('');
  lines.push(markdownTable([
    ['Selector', '≥0.80', '≥0.70', 'Median', 'p10', '<0.50', 'Gap to oracle', 'Oracle recovery', 'Improved', 'Regressed', 'Good→bad'],
    ['Current', ...metricCells(ctx.current)],
    ['Max score', ...metricCells(ctx.maxScore)],
    ['Peaked area', ...metricCells(ctx.peaked)],
    ['Oracle candidates', ...metricCells(ctx.oracle)],
    ...ctx.fullRuns.map(run => [run.kind, ...metricCells(run.cv.micro)]),
  ]));
  lines.push('');
  lines.push('## HOLDOUT');
  lines.push('');
  if (!ctx.holdoutEval) lines.push('No holdout frames.');
  else {
    lines.push(markdownTable([
      ['Selector', '≥0.80', '≥0.70', 'Median', 'p10', '<0.50', 'Gap to oracle', 'Oracle recovery', 'Improved', 'Regressed', 'Good→bad'],
      ['Current', ...metricCells(ctx.holdoutCurrent)],
      ['Max score', ...metricCells(ctx.holdoutMax)],
      ['Peaked area', ...metricCells(ctx.holdoutPeaked)],
      ['Oracle candidates', ...metricCells(ctx.holdoutOracle)],
      [`${ctx.report.kind} / ${ctx.report.ablation}`, ...metricCells(ctx.holdoutEval)],
    ]));
  }
  lines.push('');
  lines.push('## ABLATION');
  lines.push('');
  lines.push(`Ablation family ${ctx.report.ablationFamily}. Saved challenger ${ctx.report.kind} / ${ctx.report.ablation}.`);
  lines.push('');
  lines.push(markdownTable([
    ['Features', 'Oracle recovery', 'Median', 'Good→bad', 'Pass'],
    ...ctx.ablations.map(row => [row.id, pct(row.cv.micro.oracleRecovery), fmt(row.cv.micro.median), String(row.cv.micro.goodToBad), row.passed ? 'yes' : 'no']),
  ]));
  lines.push('');
  lines.push('## FIVE FRAMES');
  lines.push('');
  lines.push('Cross-validation frames use the model trained without that fold. The holdout frame uses the model trained on the cross-validation frames only.');
  lines.push('');
  lines.push(markdownTable([
    ['Card', 'Split', 'Current IoU', 'Oracle IoU', 'Ranker IoU', 'Oracle rank'],
    ...ctx.diagnostic.map(row => row.missing ? [row.card, 'missing', '—', '—', '—', '—'] : [row.card, row.membership, fmt(row.currentIou), fmt(row.oracleIou), fmt(row.selectedIou), String(row.oracleRank)]),
  ]));
  lines.push('');
  lines.push('## CORPUS');
  lines.push('');
  lines.push(`Trusted frames now: ${ctx.trusted.length}. Milestones 50, 100, 200, and 500 are progress marks, not quality guarantees.`);
  lines.push('');
  lines.push(`Tags: ${Object.entries(ctx.tagCounts).map(([tag, count]) => `${tag} ${count}`).join(', ') || 'none recorded'}.`);
  lines.push('');
  lines.push(`Challenger ${ctx.report.challengerStatus ?? 'none'} · ${ctx.report.kind} · features ${ctx.report.ablation}. Artifact ${ctx.report.artifactBytes ?? '—'} bytes. Inference ${ctx.report.inferenceMs == null ? '—' : `${ctx.report.inferenceMs.toFixed(2)} ms/frame`} on this machine.`);
  lines.push('');
  lines.push('Rerun after new human reviews: `yarn scanner:ranker:loop`.');
  lines.push('');
  lines.push('## ANNOTATION QUEUE');
  lines.push('');
  lines.push('Untrusted frames where the ranker and the current selector disagree, or the top two utilities are close. Not labels.');
  lines.push('');
  if (!ctx.queue.length) lines.push('None.');
  else {
    lines.push(markdownTable([
      ['Frame', 'Disagree', 'Utility margin', 'Weak top', 'Detector ambiguous'],
      ...ctx.queue.map(row => [row.label || row.id, row.disagree ? 'yes' : 'no', fmt(row.margin), row.weak ? 'yes' : 'no', row.ambiguousDetector ? 'yes' : 'no']),
    ]));
  }
  lines.push('');
  return lines.join('\n');
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
