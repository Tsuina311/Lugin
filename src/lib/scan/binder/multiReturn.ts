/**
 * Geometric multi-return NMS for Binder candidate lists.
 * Portable port of scripts/geometry/lib/binder-mode/multi-return.mjs
 */

import { polygonIoU } from '../detectCard';
import type { CardCorners } from '../types';
import { BINDER_POLICY } from './policy';

export type BinderCandidate = {
  corners: CardCorners;
  score: number;
  method?: string;
};

export const multiReturnNms = (
  cands: readonly BinderCandidate[],
  opts: { maxCards?: number; nmsIou?: number; minScore?: number } = {},
): BinderCandidate[] => {
  const maxCards = opts.maxCards ?? BINDER_POLICY.maxCards;
  const nmsIou = opts.nmsIou ?? BINDER_POLICY.nmsIou;
  const minScore = opts.minScore ?? BINDER_POLICY.minScore;
  const ranked = [...cands]
    .filter(c => c.corners && c.score >= minScore)
    .sort((a, b) => b.score - a.score);
  const kept: BinderCandidate[] = [];
  for (const c of ranked) {
    if (kept.some(k => polygonIoU(k.corners, c.corners) >= nmsIou)) continue;
    kept.push(c);
    if (kept.length >= maxCards) break;
  }
  return kept;
};
