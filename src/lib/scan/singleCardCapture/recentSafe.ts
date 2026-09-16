/**
 * Tiny ring of recent CAPTURE_SAFE quads — pick the best when confirmation locks
 * so a transitional last frame does not win.
 */

import { cornersToQuad } from '../geometry';
import type { CardCorners } from '../types';
import { cornerMarginMetrics } from '../geometryTest/captureSafe';

export const RECENT_SAFE_WINDOW = 4;

export type RecentSafeSample = {
  quad: CardCorners;
  score: number;
  at: number;
  /** Analysis occupancy (area / frame). */
  occupancy: number;
  /** Min corner margin normalized (higher = better centered inset). */
  minMarginNorm: number;
};

export type RecentSafeWindow = {
  samples: RecentSafeSample[];
};

export const emptyRecentSafeWindow = (): RecentSafeWindow => ({ samples: [] });

const sampleArea = (c: CardCorners): number => {
  const q = cornersToQuad(c);
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i]!;
    const r = q[(i + 1) % 4]!;
    a += p.x * r.y - r.x * p.y;
  }
  return Math.abs(a) / 2;
};

export const pushRecentSafe = (
  prev: RecentSafeWindow,
  args: {
    quad: CardCorners;
    score: number;
    at: number;
    frame: { width: number; height: number };
  },
): RecentSafeWindow => {
  const area = sampleArea(args.quad);
  const frameArea = Math.max(1, args.frame.width * args.frame.height);
  const occupancy = area / frameArea;
  const margins = cornerMarginMetrics({ corners: args.quad, frame: args.frame });
  const sample: RecentSafeSample = {
    quad: args.quad,
    score: args.score,
    at: args.at,
    occupancy,
    minMarginNorm: margins.minCornerMarginNormalized ?? 0,
  };
  const samples = [...prev.samples, sample].slice(-RECENT_SAFE_WINDOW);
  return { samples };
};

/**
 * Score for lock pick: geometry score + inset margin + occupancy near sweet spot.
 * Prefer centered (~0.25–0.55 occupancy) over lip-hugging transitional frames.
 */
export const scoreSafeSample = (s: RecentSafeSample): number => {
  const occIdeal = 0.38;
  const occPenalty = Math.abs(s.occupancy - occIdeal);
  const occScore = Math.max(0, 1 - occPenalty / 0.35);
  const marginScore = Math.min(1, s.minMarginNorm / 0.08);
  return s.score * 0.45 + marginScore * 0.35 + occScore * 0.2;
};

/** Best sample in the tiny window, or null if empty. */
export const pickBestRecentSafe = (window: RecentSafeWindow): RecentSafeSample | null => {
  if (!window.samples.length) return null;
  let best = window.samples[0]!;
  let bestScore = scoreSafeSample(best);
  for (let i = 1; i < window.samples.length; i++) {
    const s = window.samples[i]!;
    const sc = scoreSafeSample(s);
    if (sc > bestScore) {
      best = s;
      bestScore = sc;
    }
  }
  return best;
};
