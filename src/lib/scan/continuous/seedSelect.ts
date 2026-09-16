/**
 * Seeded local candidate selection — pick the snapshot candidate that matches
 * the live seed card, not the globally highest rectangle.
 */

import { CARD_ASPECT, cornersToQuad, dist } from '../geometry';
import type { CardCorners } from '../types';
import { continuousQuadIoU } from './cardChange';

export type SeedCandidate = {
  corners: CardCorners;
  score: number;
};

export type SeedSelectResult = {
  selected: CardCorners | null;
  index: number;
  score: number;
  reason: string;
  diagnostics: {
    seedIoU: number;
    centerDistNorm: number;
    sizeRatio: number;
    aspectErr: number;
  } | null;
};

const centerOf = (c: CardCorners) => {
  const q = cornersToQuad(c);
  return {
    x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4,
    y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4,
  };
};

const meanSide = (c: CardCorners): number => {
  const q = cornersToQuad(c);
  const top = dist(q[0], q[1]);
  const bot = dist(q[3], q[2]);
  const left = dist(q[0], q[3]);
  const right = dist(q[1], q[2]);
  return (top + bot + left + right) / 4;
};

const aspectOf = (c: CardCorners): number => {
  const q = cornersToQuad(c);
  const meanW = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
  const meanH = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  return meanH > 1e-3 ? meanW / meanH : CARD_ASPECT;
};

/**
 * Score snapshot candidates against a live seed quad (same image space).
 * Higher is better.
 */
export const scoreSeededCandidate = (
  seed: CardCorners,
  candidate: SeedCandidate,
  frame: { width: number; height: number },
): { score: number; seedIoU: number; centerDistNorm: number; sizeRatio: number; aspectErr: number } => {
  const seedIoU = continuousQuadIoU(seed, candidate.corners);
  const diag = Math.hypot(frame.width, frame.height) || 1;
  const c0 = centerOf(seed);
  const c1 = centerOf(candidate.corners);
  const centerDistNorm = Math.hypot(c0.x - c1.x, c0.y - c1.y) / diag;
  const s0 = meanSide(seed);
  const s1 = meanSide(candidate.corners);
  const sizeRatio = s0 > 1e-3 && s1 > 1e-3 ? Math.min(s0, s1) / Math.max(s0, s1) : 0;
  const aspectErr = Math.abs(aspectOf(candidate.corners) - CARD_ASPECT) / CARD_ASPECT;
  // Weighted blend — IoU dominates; reject distant / wrong-size cards.
  const score =
    0.55 * seedIoU +
    0.2 * (1 - Math.min(1, centerDistNorm / 0.35)) +
    0.15 * sizeRatio +
    0.05 * Math.max(0, 1 - aspectErr / 0.55) +
    0.05 * Math.min(1, Math.max(0, candidate.score));
  return { score, seedIoU, centerDistNorm, sizeRatio, aspectErr };
};

/**
 * Choose the snapshot candidate most spatially compatible with the live seed.
 */
export const selectSeededCandidate = (args: {
  seed: CardCorners;
  candidates: readonly SeedCandidate[];
  frame: { width: number; height: number };
  /** Min combined score to accept (else fall back to seed). */
  minScore?: number;
}): SeedSelectResult => {
  const minScore = args.minScore ?? 0.28;
  if (!args.candidates.length) {
    return {
      selected: args.seed,
      index: -1,
      score: 0,
      reason: 'no_candidates_use_seed',
      diagnostics: null,
    };
  }
  let bestI = -1;
  let bestScore = -Infinity;
  let bestDiag: SeedSelectResult['diagnostics'] = null;
  for (let i = 0; i < args.candidates.length; i++) {
    const c = args.candidates[i]!;
    const m = scoreSeededCandidate(args.seed, c, args.frame);
    if (m.score > bestScore) {
      bestScore = m.score;
      bestI = i;
      bestDiag = {
        seedIoU: m.seedIoU,
        centerDistNorm: m.centerDistNorm,
        sizeRatio: m.sizeRatio,
        aspectErr: m.aspectErr,
      };
    }
  }
  if (bestI < 0 || bestScore < minScore) {
    return {
      selected: args.seed,
      index: bestI,
      score: bestScore,
      reason: 'weak_match_use_seed',
      diagnostics: bestDiag,
    };
  }
  return {
    selected: args.candidates[bestI]!.corners,
    index: bestI,
    score: bestScore,
    reason: 'seeded_select',
    diagnostics: bestDiag,
  };
};
