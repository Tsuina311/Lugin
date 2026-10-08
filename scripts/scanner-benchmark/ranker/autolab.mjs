#!/usr/bin/env node
/**
 * Conservative card-quad selector search.
 * Grouped CV on trusted frames only. Identity holdout and dev capture groups
 * are sealed. This command does not print holdout metrics.
 *
 *   yarn scanner:autolab
 *   yarn scanner:autolab --dev --challenger=<id>
 *   yarn scanner:autolab --final-holdout --challenger=<id>
 *
 * --final-holdout is refused unless that challenger was already frozen by CV
 * and accepted on dev.
 */

import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { rootDir, reportsDir } from '../lib/paths.mjs';
import { hydrateModel, fitBoostedTrees, fitLinearRegression, standardizeApply, standardizeFit } from './models.mjs';
import { FULL_FEATURES, vectorOf } from './schema.mjs';

const dataDir = join(rootDir, 'scanner-benchmark/ranker-data/v1');
const labDir = join(rootDir, 'scanner-benchmark/ranker-registry/autolab');
const modelDir = join(labDir, 'challengers');
const frozenGbmPath = join(rootDir, 'scanner-benchmark/ranker-registry/challengers/gbm-iou-all-2dd2ec36b833.json');
const log = message => console.log(`${new Date().toISOString().slice(11, 19)} ${message}`);

const args = new Set(process.argv.slice(2));
const challengerArg = process.argv.find(arg => arg.startsWith('--challenger='))?.slice('--challenger='.length) ?? null;
const finalHoldout = args.has('--final-holdout');
const devOnly = args.has('--dev');

const dot = (weights, row) => {
  let sum = weights[weights.length - 1];
  for (let i = 0; i < row.length; i++) sum += weights[i] * row[i];
  return sum;
};

const quantile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - index) + sorted[hi] * (index - lo);
};

const gitInfo = () => {
  try {
    return {
      rev: execSync('git rev-parse HEAD', { cwd: rootDir, encoding: 'utf8' }).trim(),
      dirty: execSync('git status --porcelain', { cwd: rootDir, encoding: 'utf8' }).trim().length > 0,
    };
  } catch {
    return { rev: null, dirty: null };
  }
};

const sha = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

const loadFrozenGbm = () => {
  const packed = JSON.parse(readFileSync(frozenGbmPath, 'utf8'));
  const model = hydrateModel(packed.model);
  model.featureNames = packed.featureNames;
  return model;
};

const prepare = () => {
  const rawFrames = readFileSync(join(dataDir, 'frames.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const crops = JSON.parse(readFileSync(join(rootDir, 'scanner-benchmark/identity/crops.json'), 'utf8'));
  const rankerSplits = JSON.parse(readFileSync(join(dataDir, 'splits.json'), 'utf8'));
  const holdoutIds = new Set(crops.filter(row => row.split === 'holdout').map(row => row.frameId));
  const devIds = new Set(crops.filter(row => row.split === 'dev').map(row => row.frameId));
  const sealedGroups = new Set(rankerSplits.holdoutGroups);
  for (const frame of rawFrames) {
    if (frame.labelAuthority !== 'human') continue;
    if (holdoutIds.has(frame.id) || devIds.has(frame.id)) sealedGroups.add(frame.captureGroup);
  }
  const gbm = loadFrozenGbm();
  const decorate = frame => {
    const candidates = frame.candidates.map(candidate => ({
      ...candidate,
      gbmUtility: gbm.utility(vectorOf(candidate.features, gbm.featureNames)),
    }));
    let learned = null;
    let second = null;
    for (const candidate of candidates) {
      if (!learned || candidate.gbmUtility > learned.gbmUtility + 1e-12 || (Math.abs(candidate.gbmUtility - learned.gbmUtility) <= 1e-12 && candidate.detectorScore > learned.detectorScore)) {
        second = learned;
        learned = candidate;
      } else if (!second || candidate.gbmUtility > second.gbmUtility) second = candidate;
    }
    const current = candidates.find(candidate => candidate.index === frame.baselines.current.index) ?? null;
    return { ...frame, candidates, learned, learnedSecond: second, current };
  };
  const trusted = rawFrames.filter(frame => frame.labelAuthority === 'human').map(decorate);
  const cv = trusted.filter(frame => !sealedGroups.has(frame.captureGroup) && !holdoutIds.has(frame.id) && !devIds.has(frame.id));
  const dev = trusted.filter(frame => devIds.has(frame.id));
  const holdout = trusted.filter(frame => holdoutIds.has(frame.id));
  for (const frame of cv) {
    if (holdoutIds.has(frame.id) || devIds.has(frame.id)) throw new Error(`sealed frame leaked into CV: ${frame.id}`);
  }
  const foldOf = frame => rankerSplits.folds[frame.captureGroup];
  return { cv, dev, holdout, foldOf, sealedGroups: [...sealedGroups].sort(), gbm, rankerSplits };
};

const candidateWeight = (iou, scheme) => {
  if (scheme === 'uniform') return 1;
  if (scheme === 'catastrophe') {
    if (iou < 0.5) return 8;
    if (iou >= 0.9) return 0.5;
    return 1;
  }
  if (iou < 0.5) return 12;
  if (iou < 0.7) return 3;
  if (iou >= 0.9) return 0.35;
  return 1;
};

const featureNamesFor = kind => {
  if (kind === 'base') return [...FULL_FEATURES];
  if (kind === 'gbm') return [...FULL_FEATURES, 'gbmUtility'];
  return [...FULL_FEATURES, 'gbmUtility', 'fractionOverCurrent', 'scoreMinusCurrent'];
};

const rowFeatures = (candidate, frame, names) => names.map(name => {
  if (name === 'gbmUtility') return candidate.gbmUtility;
  if (name === 'fractionOverCurrent') {
    const current = frame.current?.features.frameFraction ?? candidate.features.frameFraction;
    return current > 1e-6 ? candidate.features.frameFraction / current : 1;
  }
  if (name === 'scoreMinusCurrent') return candidate.detectorScore - (frame.current?.detectorScore ?? candidate.detectorScore);
  return candidate.features[name];
});

const selectByUtility = (frame, utilityOf) => {
  let best = null;
  for (const candidate of frame.candidates) {
    const utility = utilityOf(candidate);
    if (!best || utility > best.utility + 1e-12 || (Math.abs(utility - best.utility) <= 1e-12 && candidate.detectorScore > best.detectorScore)) {
      best = { utility, candidate };
    }
  }
  return best?.candidate ?? null;
};

const actionOf = (currentIou, selectedIou, same) => {
  if (same) return 'SAME_AS_CURRENT';
  if (currentIou < 0.5 && selectedIou >= 0.7) return 'CATASTROPHIC_FIX';
  if (selectedIou < 0.5 && currentIou >= 0.5) return 'CATASTROPHIC_REGRESSION';
  if (currentIou >= 0.8 && selectedIou < 0.7) return 'HARMFUL_SWAP';
  if (currentIou >= 0.9 && selectedIou >= 0.9 && Math.abs(selectedIou - currentIou) < 0.05) return 'USELESS_SWAP';
  if (selectedIou + 0.02 < currentIou) return 'HARMFUL_SWAP';
  return 'SAFE_OVERRIDE';
};

const metricsOf = rows => {
  const selected = rows.map(row => row.selectedIou);
  const regret = rows.map(row => row.oracleIou - row.selectedIou);
  const actions = {};
  for (const row of rows) actions[row.action] = (actions[row.action] ?? 0) + 1;
  const swaps90 = rows.filter(row => row.currentIou >= 0.9 && !row.same);
  return {
    n: rows.length,
    ge90: selected.filter(value => value >= 0.9).length,
    ge80: selected.filter(value => value >= 0.8).length,
    ge70: selected.filter(value => value >= 0.7).length,
    catastrophic: selected.filter(value => value < 0.5).length,
    median: quantile(selected, 0.5),
    p10: quantile(selected, 0.1),
    mean: selected.length ? selected.reduce((sum, value) => sum + value, 0) / selected.length : null,
    goodToBad: rows.filter(row => row.currentIou >= 0.8 && row.selectedIou < 0.7).length,
    improved: rows.filter(row => row.selectedIou >= row.currentIou + 0.05).length,
    regressed: rows.filter(row => row.selectedIou <= row.currentIou - 0.05).length,
    meanRegret: regret.length ? regret.reduce((sum, value) => sum + value, 0) / regret.length : null,
    medianRegret: quantile(regret, 0.5),
    p90Regret: quantile(regret, 0.9),
    regretOver10: regret.filter(value => value > 0.1).length,
    regretOver25: regret.filter(value => value > 0.25).length,
    swapsAlready90: swaps90.length,
    already90: rows.filter(row => row.currentIou >= 0.9).length,
    actions,
  };
};

const lexBetter = (a, b) => {
  const keys = [
    ['catastrophic', -1],
    ['goodToBad', -1],
    ['ge80', 1],
    ['ge70', 1],
    ['p10', 1],
    ['median', 1],
    ['swapsAlready90', -1],
  ];
  for (const [key, direction] of keys) {
    const delta = (a[key] ?? 0) - (b[key] ?? 0);
    if (Math.abs(delta) < 1e-9) continue;
    return delta * direction > 0;
  }
  return false;
};

const outcome = (frame, selected) => {
  const currentIou = frame.current?.iou ?? frame.baselines.current.iou;
  const selectedIou = selected?.iou ?? 0;
  const same = Boolean(selected && frame.current && selected.index === frame.current.index);
  return {
    id: frame.id,
    currentIou,
    selectedIou,
    oracleIou: frame.oracleBestIou,
    same,
    action: actionOf(currentIou, selectedIou, same),
  };
};

const fitLogistic = (rows, labels) => {
  const norm = standardizeFit(rows);
  const scaled = rows.map(row => standardizeApply(row, norm));
  const width = scaled[0].length;
  const weights = Array(width + 1).fill(0);
  const epochs = 240;
  const lr = 0.35;
  const l2 = 0.02;
  for (let epoch = 0; epoch < epochs; epoch++) {
    const grad = Array(width + 1).fill(0);
    for (let i = 0; i < scaled.length; i++) {
      const x = [...scaled[i], 1];
      const z = dot(weights, x);
      const p = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
      const g = (p - labels[i]) / scaled.length;
      for (let j = 0; j < x.length; j++) grad[j] += g * x[j];
    }
    for (let j = 0; j < width; j++) weights[j] -= lr * (grad[j] + l2 * weights[j]);
    weights[width] -= lr * grad[width];
  }
  return { family: 'logistic', norm, weights };
};

const logisticProb = (model, row) => {
  const z = dot(model.weights, [...standardizeApply(row, model.norm), 1]);
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
};

const SWITCH_FEATURES = [
  'currentScore', 'learnedUtility', 'utilityGap', 'scoreGap', 'currentFraction', 'learnedFraction', 'fractionRatio',
  'currentAspect', 'learnedAspect', 'currentParallel', 'learnedParallel', 'currentCenter', 'learnedCenter',
  'currentRank', 'learnedRank', 'utilityMargin', 'scoreMargin', 'centerDistance', 'candidateCount',
  'currentEdge', 'currentLuma', 'currentChroma', 'learnedEdge', 'learnedLuma', 'learnedChroma',
  'currentArt', 'learnedArt', 'currentInner', 'learnedInner', 'currentOuter', 'learnedOuter',
];

const switchVector = frame => {
  const current = frame.current;
  const learned = frame.learned;
  if (!current || !learned) return null;
  const secondUtility = frame.learnedSecond?.gbmUtility ?? learned.gbmUtility;
  const ranked = [...frame.candidates].sort((a, b) => b.detectorScore - a.detectorScore);
  const secondScore = ranked[1]?.detectorScore ?? ranked[0].detectorScore;
  return [
    current.detectorScore,
    learned.gbmUtility,
    learned.gbmUtility - current.gbmUtility,
    current.detectorScore - learned.detectorScore,
    current.features.frameFraction,
    learned.features.frameFraction,
    current.features.frameFraction > 1e-6 ? learned.features.frameFraction / current.features.frameFraction : 1,
    current.features.aspectRatio,
    learned.features.aspectRatio,
    current.features.parallelScore,
    learned.features.parallelScore,
    current.features.centerScore,
    learned.features.centerScore,
    current.features.scoreRank,
    learned.features.scoreRank,
    learned.gbmUtility - secondUtility,
    current.detectorScore - secondScore,
    Math.hypot(current.features.centerX - learned.features.centerX, current.features.centerY - learned.features.centerY),
    frame.candidates.length,
    current.features.srcEdge,
    current.features.srcLuma,
    current.features.srcChroma,
    learned.features.srcEdge,
    learned.features.srcLuma,
    learned.features.srcChroma,
    current.features.artBoxConfidence,
    learned.features.artBoxConfidence,
    current.features.isNestedInner,
    learned.features.isNestedInner,
    current.features.isNestedOuter,
    learned.features.isNestedOuter,
  ];
};

const switchLabel = frame => {
  if (!frame.current || !frame.learned) return 0;
  if (frame.learned.index === frame.current.index) return 0;
  const gain = frame.learned.iou - frame.current.iou;
  if (frame.current.iou < 0.5 && frame.learned.iou >= 0.7) return 1;
  if (gain >= 0.05) return 1;
  return 0;
};

const fitRanker = (frames, spec) => {
  const names = featureNamesFor(spec.features);
  const rows = [];
  const targets = [];
  const weights = [];
  for (const frame of frames) {
    for (const candidate of frame.candidates) {
      rows.push(rowFeatures(candidate, frame, names));
      targets.push(candidate.iou);
      weights.push(candidateWeight(candidate.iou, spec.weights));
    }
  }
  if (spec.kind === 'linear') {
    const model = fitLinearRegression(rows, targets);
    return { predict: frame => selectByUtility(frame, candidate => model.utility(rowFeatures(candidate, frame, names))), model, names };
  }
  const model = fitBoostedTrees(rows, targets, {
    learningRate: spec.lr,
    rounds: spec.rounds,
    depth: spec.depth,
    minLeaf: spec.minLeaf,
    weights,
  });
  return { predict: frame => selectByUtility(frame, candidate => model.utility(rowFeatures(candidate, frame, names))), model, names };
};

const oofRanker = (cv, foldOf, spec) => {
  const folds = [...new Set(cv.map(foldOf))].sort((a, b) => a - b);
  const predictions = [];
  for (const fold of folds) {
    const train = cv.filter(frame => foldOf(frame) !== fold);
    const val = cv.filter(frame => foldOf(frame) === fold);
    const fitted = fitRanker(train, spec);
    for (const frame of val) predictions.push(outcome(frame, fitted.predict(frame)));
  }
  return metricsOf(predictions);
};

const oofSwitch = (cv, foldOf, kind) => {
  const folds = [...new Set(cv.map(foldOf))].sort((a, b) => a - b);
  const scored = [];
  for (const fold of folds) {
    const train = cv.filter(frame => foldOf(frame) !== fold);
    const val = cv.filter(frame => foldOf(frame) === fold);
    const x = [];
    const y = [];
    for (const frame of train) {
      const vector = switchVector(frame);
      if (!vector) continue;
      x.push(vector);
      y.push(switchLabel(frame));
    }
    let probOf = () => 0;
    if (kind === 'logistic' && x.length) {
      const model = fitLogistic(x, y);
      probOf = frame => {
        const vector = switchVector(frame);
        return vector ? logisticProb(model, vector) : 0;
      };
    } else if (x.length) {
      const model = fitBoostedTrees(x, y, { learningRate: 0.1, rounds: 12, depth: kind === 'tree1' ? 1 : 2, minLeaf: 3 });
      probOf = frame => {
        const vector = switchVector(frame);
        if (!vector) return 0;
        const value = model.utility(vector);
        return Math.max(0, Math.min(1, value));
      };
    }
    for (const frame of val) {
      scored.push({ frame, prob: probOf(frame) });
    }
  }
  return scored;
};

const applySwitch = (scored, threshold) => metricsOf(scored.map(({ frame, prob }) => {
  const take = frame.current && frame.learned && frame.learned.index !== frame.current.index && prob >= threshold;
  return outcome(frame, take ? frame.learned : frame.current);
}));

const applyMarginGate = (cv, threshold) => metricsOf(cv.map(frame => {
  const gap = (frame.learned?.gbmUtility ?? 0) - (frame.current?.gbmUtility ?? 0);
  const take = frame.learned && frame.current && frame.learned.index !== frame.current.index && gap >= threshold;
  return outcome(frame, take ? frame.learned : frame.current);
}));

const baselineRows = (cv, which) => metricsOf(cv.map(frame => outcome(frame, which === 'current' ? frame.current : frame.learned)));

const specId = spec => sha(spec).slice(0, 12);

const search = async pool => {
  const { cv, foldOf } = pool;
  mkdirSync(modelDir, { recursive: true });
  const runs = [];
  const record = (family, spec, metrics) => {
    const id = `${family}-${specId(spec)}`;
    runs.push({ id, family, spec, metrics, eligible: true });
    log(`${id} cat ${metrics.catastrophic} bad ${metrics.goodToBad} 80 ${metrics.ge80}/${metrics.n} p10 ${metrics.p10?.toFixed?.(3)}`);
  };
  record('baseline', { name: 'current' }, baselineRows(cv, 'current'));
  record('baseline', { name: 'frozen-gbm' }, baselineRows(cv, 'learned'));

  const featureSets = ['base', 'gbm', 'relative'];
  const weightSchemes = ['uniform', 'catastrophe', 'conservative'];
  for (const features of featureSets) {
    for (const weights of weightSchemes) {
      record('B-linear', { kind: 'linear', features, weights }, oofRanker(cv, foldOf, { kind: 'linear', features, weights }));
    }
  }
  for (const features of featureSets) {
    for (const depth of [1, 2]) {
      for (const rounds of [8, 16, 32]) {
        for (const minLeaf of [3, 6]) {
          for (const lr of [0.05, 0.1]) {
            for (const weights of weightSchemes) {
              const spec = { kind: 'gbm', features, weights, depth, rounds, minLeaf, lr };
              record('B-gbm', spec, oofRanker(cv, foldOf, spec));
            }
          }
        }
      }
    }
  }
  for (const kind of ['logistic', 'tree1', 'tree2']) {
    const scored = oofSwitch(cv, foldOf, kind);
    for (const threshold of [0.5, 0.6, 0.7, 0.8, 0.9]) {
      record('A-switch', { kind, threshold }, applySwitch(scored, threshold));
    }
  }
  for (const threshold of [0, 0.02, 0.05, 0.1, 0.2, 0.4]) {
    record('C-margin', { threshold, source: 'frozen-gbm' }, applyMarginGate(cv, threshold));
  }
  runs.sort((a, b) => (lexBetter(a.metrics, b.metrics) ? -1 : lexBetter(b.metrics, a.metrics) ? 1 : a.id.localeCompare(b.id)));
  const frontier = [];
  for (const run of runs) {
    if (frontier.some(kept => !lexBetter(run.metrics, kept.metrics) && !lexBetter(kept.metrics, run.metrics))) continue;
    if (frontier.some(kept => lexBetter(kept.metrics, run.metrics) || (
      kept.metrics.catastrophic <= run.metrics.catastrophic
      && kept.metrics.goodToBad <= run.metrics.goodToBad
      && kept.metrics.ge80 >= run.metrics.ge80
      && kept.metrics.ge70 >= run.metrics.ge70
      && kept.metrics.p10 >= run.metrics.p10 - 1e-9
      && kept.metrics.median >= run.metrics.median - 1e-9
      && kept.metrics.swapsAlready90 <= run.metrics.swapsAlready90
    ))) continue;
    frontier.push(run);
  }
  const frozenGbm = runs.find(run => run.spec.name === 'frozen-gbm');
  const rankedChallengers = runs.filter(run => run.family !== 'baseline');
  const winner = rankedChallengers[0];
  const beatsGbm = winner && lexBetter(winner.metrics, frozenGbm.metrics);
  await writeFile(join(labDir, 'runs.jsonl'), `${runs.map(run => JSON.stringify(run)).join('\n')}\n`);
  const datasetHash = sha(cv.map(frame => frame.id).sort());
  const splitHash = sha(cv.map(frame => [frame.id, foldOf(frame)]).sort());
  const saved = [];
  const toSave = rankedChallengers.slice(0, 8);
  for (const run of toSave) {
    const artifact = {
      id: run.id,
      family: run.family,
      spec: run.spec,
      featureSchema: 'ranker-features-v1+conservative-v1',
      datasetHash,
      splitHash,
      cv: run.metrics,
      dev: null,
      holdout: null,
      status: run.id === winner.id ? 'cv-selected' : 'frontier',
      beatsFrozenGbmOnCv: lexBetter(run.metrics, frozenGbm.metrics),
      createdAt: new Date().toISOString(),
      git: gitInfo(),
      seed: 'deterministic-no-rng',
      codeHash: sha(readFileSync(new URL(import.meta.url), 'utf8')),
    };
    if (run.family.startsWith('B-')) {
      const fitted = fitRanker(cv, run.spec);
      artifact.model = {
        family: fitted.model.family,
        kind: fitted.model.kind,
        names: fitted.names,
        norm: fitted.model.norm ?? null,
        weights: fitted.model.weights ?? null,
        trees: fitted.model.trees ?? null,
        base: fitted.model.base ?? null,
        learningRate: fitted.model.learningRate ?? null,
        rounds: fitted.model.rounds ?? null,
      };
    }
    if (run.family === 'A-switch') {
      const x = [];
      const y = [];
      for (const frame of cv) {
        const vector = switchVector(frame);
        if (!vector) continue;
        x.push(vector);
        y.push(switchLabel(frame));
      }
      if (run.spec.kind === 'logistic') artifact.model = { ...fitLogistic(x, y), features: SWITCH_FEATURES, threshold: run.spec.threshold };
      else {
        const fitted = fitBoostedTrees(x, y, { learningRate: 0.1, rounds: 12, depth: run.spec.kind === 'tree1' ? 1 : 2, minLeaf: 3 });
        artifact.model = {
          family: 'tree',
          features: SWITCH_FEATURES,
          threshold: run.spec.threshold,
          trees: fitted.trees,
          base: fitted.base,
          learningRate: fitted.learningRate,
        };
      }
    }
    if (run.family === 'C-margin') artifact.model = { family: 'margin-gate', threshold: run.spec.threshold, source: 'frozen-gbm' };
    artifact.modelHash = sha(artifact.model ?? run.spec);
    await writeFile(join(modelDir, `${run.id}.json`), `${JSON.stringify(artifact, null, 2)}\n`);
    saved.push(run.id);
  }
  const summary = {
    cvFrames: cv.length,
    sealedGroups: pool.sealedGroups.length,
    configurations: runs.length,
    winner: winner?.id ?? null,
    beatsFrozenGbmOnCv: Boolean(beatsGbm),
    frozenGbm: frozenGbm.metrics,
    current: runs.find(run => run.spec.name === 'current').metrics,
    top: rankedChallengers.slice(0, 8).map(run => ({ id: run.id, family: run.family, spec: run.spec, metrics: run.metrics })),
    saved,
    datasetHash,
    splitHash,
  };
  await writeFile(join(labDir, 'cv-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(join(reportsDir, 'conservative-selector-cv.json'), `${JSON.stringify(summary, null, 2)}\n`);
  log(`winner ${summary.winner} beats frozen gbm ${summary.beatsFrozenGbmOnCv} configs ${runs.length}`);
};

const loadChallenger = id => {
  const path = join(modelDir, `${id}.json`);
  if (!existsSync(path)) throw new Error(`missing frozen challenger ${id}`);
  return JSON.parse(readFileSync(path, 'utf8'));
};

const predictTree = (model, row) => {
  const visit = node => {
    if (!node?.left) return node?.value ?? 0;
    return visit(row[node.feature] <= node.threshold ? node.left : node.right);
  };
  return model.trees.reduce((sum, tree) => sum + model.learningRate * visit(tree), model.base);
};

const applyArtifact = (frame, artifact) => {
  if (artifact.family === 'baseline' && artifact.spec.name === 'current') return frame.current;
  if (artifact.family === 'baseline' && artifact.spec.name === 'frozen-gbm') return frame.learned;
  if (artifact.family === 'C-margin' || artifact.model?.family === 'margin-gate') {
    const gap = (frame.learned?.gbmUtility ?? 0) - (frame.current?.gbmUtility ?? 0);
    const take = frame.learned && frame.current && frame.learned.index !== frame.current.index && gap >= artifact.model.threshold;
    return take ? frame.learned : frame.current;
  }
  if (artifact.family === 'A-switch') {
    const vector = switchVector(frame);
    let prob = 0;
    if (vector && artifact.model.family === 'logistic') prob = logisticProb(artifact.model, vector);
    else if (vector) prob = Math.max(0, Math.min(1, predictTree(artifact.model, vector)));
    const take = frame.learned && frame.current && frame.learned.index !== frame.current.index && prob >= artifact.model.threshold;
    return take ? frame.learned : frame.current;
  }
  const names = artifact.model.names;
  const utilityOf = candidate => {
    const row = rowFeatures(candidate, frame, names);
    if (artifact.model.family === 'linear') return dot(artifact.model.weights, [...standardizeApply(row, artifact.model.norm)]);
    return predictTree(artifact.model, row);
  };
  return selectByUtility(frame, utilityOf);
};

const evalSplit = (frames, artifact) => metricsOf(frames.map(frame => outcome(frame, applyArtifact(frame, artifact))));

const writeEval = async (splitName, artifact, metrics) => {
  artifact[splitName] = metrics;
  artifact[`${splitName}EvaluatedAt`] = new Date().toISOString();
  await writeFile(join(modelDir, `${artifact.id}.json`), `${JSON.stringify(artifact, null, 2)}\n`);
  await writeFile(join(labDir, `${splitName}-${artifact.id}.json`), `${JSON.stringify({ id: artifact.id, metrics }, null, 2)}\n`);
  log(`${splitName} ${artifact.id} cat ${metrics.catastrophic} bad ${metrics.goodToBad} 80 ${metrics.ge80}/${metrics.n} p10 ${metrics.p10?.toFixed?.(3)}`);
};

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

export {
  applyArtifact,
  prepare,
  outcome,
  metricsOf,
  loadChallenger,
  SWITCH_FEATURES,
};

const main = async () => {
  if (finalHoldout && devOnly) throw new Error('choose either --dev or --final-holdout');
  const pool = prepare();
  if (!finalHoldout && !devOnly) {
    log(`cv ${pool.cv.length} dev sealed ${pool.dev.length} holdout sealed ${pool.holdout.length}`);
    await search(pool);
    return;
  }
  if (!challengerArg) throw new Error('pass --challenger=<id>');
  const artifact = loadChallenger(challengerArg);
  if (!artifact.cv) throw new Error('refusing eval because this id has no frozen CV record');
  if (finalHoldout) {
    if (!artifact.dev) throw new Error('refusing --final-holdout before --dev has been recorded for this challenger');
    if (!artifact.devRecognition) throw new Error('refusing --final-holdout before dev recognition is recorded');
    if (String(artifact.devStatus).startsWith('rejected')) throw new Error(`refusing --final-holdout for ${artifact.devStatus}`);
    const metrics = evalSplit(pool.holdout, artifact);
    await writeEval('holdout', artifact, metrics);
    return;
  }
  const metrics = evalSplit(pool.dev, artifact);
  const current = baselineRows(pool.dev, 'current');
  const learned = baselineRows(pool.dev, 'learned');
  artifact.devBaselines = { current, learned };
  const geometryRegression = metrics.catastrophic > learned.catastrophic || metrics.goodToBad > learned.goodToBad || metrics.goodToBad > current.goodToBad;
  artifact.devStatus = geometryRegression ? 'rejected-geometry' : 'geometry-pass';
  await writeEval('dev', artifact, metrics);
  log(`dev baselines current cat ${current.catastrophic} gbm cat ${learned.catastrophic} status ${artifact.devStatus}`);
};

if (isDirectRun) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
