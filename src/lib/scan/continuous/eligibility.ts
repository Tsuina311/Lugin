/**
 * RECOGNITION_ELIGIBLE — fast identity gate (not CAPTURE_SAFE).
 * No 2.5% edge inset / 56px source-margin requirement.
 */

import { CARD_ASPECT, cornersToQuad, dist } from '../geometry';
import type { CardCorners } from '../types';
import {
  DEFAULT_RECOGNITION_ELIGIBLE_POLICY,
  type RecognitionEligiblePolicy,
} from './types';

export type RecognitionEligibleArgs = {
  corners: CardCorners | null;
  frame: { width: number; height: number };
  /** Optional detector score — if provided, must look like a real card. */
  score?: number | null;
  policy?: Partial<RecognitionEligiblePolicy>;
};

export type RecognitionEligibleVerdict = {
  eligible: boolean;
  reasons: string[];
  occupancy: number | null;
  oobFraction: number | null;
  meanSidePx: number | null;
  aspect: number | null;
};

const quadArea = (
  q: readonly { x: number; y: number }[],
): number => {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i]!;
    const r = q[(i + 1) % 4]!;
    a += p.x * r.y - r.x * p.y;
  }
  return Math.abs(a) / 2;
};

/**
 * Pure: plausible card, enough area, mostly in frame, not tiny.
 * Does NOT require capture-safe margins.
 */
export const isRecognitionEligible = (
  args: RecognitionEligibleArgs,
): RecognitionEligibleVerdict => {
  const policy: RecognitionEligiblePolicy = {
    ...DEFAULT_RECOGNITION_ELIGIBLE_POLICY,
    ...args.policy,
  };
  const empty = (reasons: string[]): RecognitionEligibleVerdict => ({
    eligible: false,
    reasons,
    occupancy: null,
    oobFraction: null,
    meanSidePx: null,
    aspect: null,
  });

  if (!args.corners) return empty(['no_geometry']);
  const w = args.frame.width;
  const h = args.frame.height;
  if (!(w > 1 && h > 1)) return empty(['no_geometry']);

  const q = cornersToQuad(args.corners);
  const reasons: string[] = [];

  let oob = 0;
  for (const p of q) {
    if (p.x < -2 || p.y < -2 || p.x > w + 2 || p.y > h + 2) oob += 1;
  }
  const oobFraction = oob / 4;
  if (oobFraction > policy.maxOobFraction) reasons.push('too_much_oob');

  const occupancy = quadArea(q) / (w * h);
  if (occupancy < policy.minOccupancy) reasons.push('too_small');
  if (occupancy > policy.maxOccupancy) reasons.push('too_large');

  const top = dist(q[0], q[1]);
  const bot = dist(q[3], q[2]);
  const left = dist(q[0], q[3]);
  const right = dist(q[1], q[2]);
  const meanSidePx = (top + bot + left + right) / 4;
  if (meanSidePx < policy.minResolutionPx) reasons.push('low_resolution');

  const meanW = (top + bot) / 2;
  const meanH = (left + right) / 2;
  const aspect = meanH > 1e-3 ? meanW / meanH : null;
  if (aspect != null) {
    const err = Math.abs(aspect - CARD_ASPECT) / CARD_ASPECT;
    if (err > policy.maxAspectErr) reasons.push('implausible_aspect');
  } else {
    reasons.push('implausible_aspect');
  }

  if (typeof args.score === 'number' && Number.isFinite(args.score) && args.score < 0.35) {
    reasons.push('weak_detector');
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    occupancy,
    oobFraction,
    meanSidePx,
    aspect,
  };
};
