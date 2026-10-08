/**
 * Frozen GBM `gbm-iou-all-2dd2ec36b833`.
 * Utility = base + learningRate * sum of tree leaves.
 * A missing left child is a leaf. Otherwise branch on row[feature] <= threshold.
 * Tie-break: higher detector score. Same walk as hydrateModel.
 */

import frozen from './gbm-iou-all.json';

export const FROZEN_GBM_ID = 'gbm-iou-all-2dd2ec36b833';

export type GbmNode = {
  feature?: number;
  threshold?: number;
  left?: GbmNode;
  right?: GbmNode;
  value?: number;
};

export type FrozenGbm = {
  featureNames: string[];
  family: string;
  base: number;
  learningRate: number;
  trees: GbmNode[];
};

export const frozenGbm = frozen as FrozenGbm;

export const predictNode = (node: GbmNode | undefined, row: readonly number[]): number => {
  if (!node?.left) return node?.value ?? 0;
  const feature = node.feature ?? 0;
  const value = row[feature] ?? 0;
  const next = value <= (node.threshold ?? 0) ? node.left : node.right;
  return predictNode(next, row);
};

export const gbmTreeValues = (model: FrozenGbm, row: readonly number[]): number[] =>
  model.trees.map(tree => predictNode(tree, row));

export const gbmUtility = (model: FrozenGbm, row: readonly number[]): number =>
  model.trees.reduce((sum, tree) => sum + model.learningRate * predictNode(tree, row), model.base);

export const vectorOf = (features: Record<string, number>, names: readonly string[]): number[] =>
  names.map(name => {
    const value = features[name];
    if (!Number.isFinite(value)) throw new Error(`missing feature ${name}`);
    return value;
  });

export const selectByUtility = <T extends { utility: number; detectorScore: number }>(
  rows: readonly T[],
): T | null => {
  let best: T | null = null;
  for (const row of rows) {
    if (
      !best ||
      row.utility > best.utility + 1e-12 ||
      (Math.abs(row.utility - best.utility) <= 1e-12 && row.detectorScore > best.detectorScore)
    ) {
      best = row;
    }
  }
  return best;
};
