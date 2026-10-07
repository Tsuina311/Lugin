#!/usr/bin/env node
/**
 * Compare tree-ranker settings on grouped cross-validation only.
 * The frozen holdout is not used to choose a setting.
 *
 * A setting is better only when it still passes the locked gates, does not
 * raise catastrophic selections above the accepted tree, and then has higher
 * oracle recovery, else fewer regressions, else a higher median.
 * The setting wired into train.mjs was chosen from this search:
 * depth 3, 30 rounds, learning rate 0.085, min leaf 6.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { rootDir } from '../lib/paths.mjs';
import { FULL_FEATURES, vectorOf } from './schema.mjs';
import { initSplits, partition } from './splits.mjs';
import { evaluateFrames, baselineEval } from './evaluate.mjs';
import { challengerPasses } from './criteria.mjs';
import { fitBoostedTrees } from './models.mjs';

const dataDir = join(rootDir, 'scanner-benchmark/ranker-data/v1');

const loadTrusted = async () => {
  const text = await readFile(join(dataDir, 'frames.jsonl'), 'utf8');
  const frames = text.split('\n').filter(Boolean).map(line => JSON.parse(line));
  return frames.filter(frame => frame.labelAuthority === 'human' && frame.source === 'trusted-real');
};

const stack = (frames, names, weighted) => {
  const rows = [];
  const targets = [];
  const weights = [];
  for (const frame of frames) {
    let oracle = frame.candidates[0];
    for (const candidate of frame.candidates) {
      if (candidate.iou > oracle.iou + 1e-12 || (Math.abs(candidate.iou - oracle.iou) <= 1e-12 && candidate.index < oracle.index)) {
        oracle = candidate;
      }
    }
    const bestScore = frame.candidates.reduce((best, candidate) => Math.max(best, candidate.detectorScore), 0);
    for (const candidate of frame.candidates) {
      rows.push(vectorOf(candidate.features, names));
      targets.push(candidate.iou);
      let weight = 1;
      if (weighted === 'hard') {
        if (candidate.index === oracle.index) weight = 2;
        else if (candidate.iou < 0.5) weight = 4;
        else if (candidate.iou < 0.7 && candidate.detectorScore >= bestScore - 0.05) weight = 3;
      } else if (weighted === 'mild') {
        if (candidate.index === oracle.index) weight = 1.5;
        else if (candidate.iou < 0.5) weight = 2;
        else if (candidate.iou < 0.7 && candidate.detectorScore >= bestScore - 0.05) weight = 1.5;
      }
      weights.push(weight);
    }
  }
  return { rows, targets, weights };
};

const selectFrame = (model, frame, names) => {
  let best = null;
  for (const candidate of frame.candidates) {
    const utility = model.utility(vectorOf(candidate.features, names));
    if (!best || utility > best.utility + 1e-12 || (Math.abs(utility - best.utility) <= 1e-12 && candidate.detectorScore > best.detectorScore)) {
      best = { utility, index: candidate.index, iou: candidate.iou, detectorScore: candidate.detectorScore };
    }
  }
  return best ?? { index: -1, iou: 0, utility: null };
};

const crossValidate = (options, byFold) => {
  const foldIds = [...byFold.keys()].sort((a, b) => a - b);
  const pooled = [];
  const folds = [];
  for (const foldId of foldIds) {
    const test = byFold.get(foldId) ?? [];
    const train = foldIds.filter(id => id !== foldId).flatMap(id => byFold.get(id));
    if (!test.length || !train.length) continue;
    const { rows, targets, weights } = stack(train, FULL_FEATURES, options.weighted);
    const model = fitBoostedTrees(rows, targets, { ...options, weights });
    const modelEval = evaluateFrames(test, frame => selectFrame(model, frame, FULL_FEATURES));
    const currentEval = baselineEval(test, 'current');
    pooled.push(...modelEval.rows);
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
    return { index: row.selectedIndex, iou: row.selectedIou };
  });
  const current = baselineEval(pooled.map(row => ({
    id: row.id,
    image: row.image,
    label: row.label,
    captureGroup: row.captureGroup,
    oracleBestIou: row.oracleIou,
    hasGoodCandidate: row.hasGoodCandidate,
    noUsableCandidate: row.noUsableCandidate,
    baselines: { current: { iou: row.currentIou, index: -1 } },
    candidates: [],
  })), 'current');
  const eligible = folds.filter(fold => fold.oracleFrames > 0 && fold.modelRecovery != null && fold.baselineRecovery != null);
  const foldsWon = eligible.filter(fold => fold.modelRecovery >= fold.baselineRecovery && fold.goodToBad === 0).length;
  const passed = challengerPasses({
    oracleRecovery: micro.oracleRecovery ?? 0,
    baselineRecovery: current.oracleRecovery ?? 0,
    catastrophic: micro.catastrophic,
    baselineCatastrophic: current.catastrophic,
    goodToBad: micro.goodToBad,
    foldsWon,
    foldCount: eligible.length,
  });
  return { micro, passed };
};

const CATASTROPHE_FLOOR = 2;

const better = (next, prev) => {
  if (!next.passed || next.micro.catastrophic > CATASTROPHE_FLOOR) return false;
  if (!prev?.passed) return true;
  const a = next.micro;
  const b = prev.micro;
  if ((a.oracleRecovery ?? 0) > (b.oracleRecovery ?? 0) + 0.005) return true;
  if (Math.abs((a.oracleRecovery ?? 0) - (b.oracleRecovery ?? 0)) <= 0.005 && a.catastrophic < b.catastrophic) return true;
  if (Math.abs((a.oracleRecovery ?? 0) - (b.oracleRecovery ?? 0)) <= 0.005 && a.catastrophic === b.catastrophic && a.regressed < b.regressed) return true;
  if (Math.abs((a.oracleRecovery ?? 0) - (b.oracleRecovery ?? 0)) <= 0.005 && a.catastrophic === b.catastrophic && a.regressed === b.regressed && (a.median ?? 0) > (b.median ?? 0) + 0.002) return true;
  return false;
};

const configs = [
  { name: 'deeper', depth: 3, rounds: 24, learningRate: 0.1, minLeaf: 8, weighted: false },
  { name: 'd3-m6', depth: 3, rounds: 24, learningRate: 0.1, minLeaf: 6, weighted: false },
  { name: 'd3-m10', depth: 3, rounds: 24, learningRate: 0.1, minLeaf: 10, weighted: false },
  { name: 'd3-m12', depth: 3, rounds: 24, learningRate: 0.1, minLeaf: 12, weighted: false },
  { name: 'd3-slow', depth: 3, rounds: 40, learningRate: 0.05, minLeaf: 8, weighted: false },
  { name: 'd3-r32', depth: 3, rounds: 32, learningRate: 0.08, minLeaf: 8, weighted: false },
  { name: 'd3-r16', depth: 3, rounds: 16, learningRate: 0.12, minLeaf: 8, weighted: false },
  { name: 'd3-mild', depth: 3, rounds: 24, learningRate: 0.1, minLeaf: 8, weighted: 'mild' },
  { name: 'd3-m8-r28', depth: 3, rounds: 28, learningRate: 0.09, minLeaf: 8, weighted: false },
  { name: 'd4-m16', depth: 4, rounds: 12, learningRate: 0.1, minLeaf: 16, weighted: false },
];

const trusted = await loadTrusted();
const splits = initSplits(trusted, JSON.parse(await readFile(join(dataDir, 'splits.json'), 'utf8')));
const { byFold } = partition(trusted, splits);
let best = null;
for (const config of configs) {
  const started = performance.now();
  const result = crossValidate(config, byFold);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const m = result.micro;
  const flag = result.passed ? 'PASS' : 'FAIL';
  console.log(`${config.name.padEnd(16)} ${flag} rec=${(m.oracleRecovery ?? 0).toFixed(3)} good=${m.good80}/${m.n} cat=${m.catastrophic} g2b=${m.goodToBad} reg=${m.regressed} med=${m.median?.toFixed(3)} ${seconds}s`);
  if (better(result, best)) best = { ...config, ...result };
}
console.log(`winner ${best?.name ?? 'none'}`);
