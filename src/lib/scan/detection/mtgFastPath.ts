/**
 * Conservative MTG single-card FAST_ACCEPT scoring.
 *
 * Fail-closed: if confidence is insufficient, callers must run the existing
 * detector path unchanged. No OCR. No identity.
 */

import { CARD_ASPECT, cornersToQuad, dist, type Quad } from '../geometry';
import type { CardCorners, ScanImage } from '../types';

/** Detector score floor for early accept (obvious single card). */
export const FAST_ACCEPT_MIN_SCORE = 0.88;

/** Rectified aspect must be within this relative error of 63:88. */
export const FAST_ACCEPT_MAX_ASPECT_ERR = 0.18;

/** Fraction of analysis frame the quad must occupy. */
export const FAST_ACCEPT_MIN_OCCUPANCY = 0.08;
export const FAST_ACCEPT_MAX_OCCUPANCY = 0.78;

/** Runner-up must not be within this score of the winner (competition). */
export const FAST_ACCEPT_MIN_SCORE_MARGIN = 0.06;

export type MtgFastPathVerdict = {
  accept: boolean;
  confidence: number;
  reasons: string[];
  rejectReasons: string[];
  aspect: number | null;
  occupancy: number | null;
  scoreMargin: number | null;
};

const quadArea = (q: Quad): number => {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i]!;
    const r = q[(i + 1) % 4]!;
    a += p.x * r.y - r.x * p.y;
  }
  return Math.abs(a) / 2;
};

const isConvex = (q: Quad): boolean => {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i]!;
    const b = q[(i + 1) % 4]!;
    const c = q[(i + 2) % 4]!;
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (z === 0) continue;
    const s = z > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
};

/** Perspective-tolerant aspect: mean of opposite side length ratios → w/h. */
export const perspectiveAspect = (corners: CardCorners): number | null => {
  const q = cornersToQuad(corners);
  const top = dist(q[0], q[1]);
  const bottom = dist(q[3], q[2]);
  const left = dist(q[0], q[3]);
  const right = dist(q[1], q[2]);
  const w = (top + bottom) / 2;
  const h = (left + right) / 2;
  if (h < 1e-3) return null;
  return w / h;
};

/**
 * Score whether a high-scoring detector winner is an obvious single MTG card.
 * Does not invent geometry — only validates an existing candidate.
 */
export const evaluateMtgFastAccept = (args: {
  corners: CardCorners;
  score: number;
  frame: { width: number; height: number };
  runnerUpScore?: number | null;
  /** Optional: second candidate IoU with winner (sleeve/card). Unused for accept gate. */
  competingIou?: number | null;
}): MtgFastPathVerdict => {
  const reasons: string[] = [];
  const rejectReasons: string[] = [];
  const q = cornersToQuad(args.corners);
  const frameArea = Math.max(1, args.frame.width * args.frame.height);
  const occupancy = quadArea(q) / frameArea;
  const aspect = perspectiveAspect(args.corners);
  const margin =
    args.runnerUpScore != null ? args.score - args.runnerUpScore : args.score;

  if (args.score < FAST_ACCEPT_MIN_SCORE) {
    rejectReasons.push(`score ${args.score.toFixed(3)} < ${FAST_ACCEPT_MIN_SCORE}`);
  } else {
    reasons.push('strong detector score');
  }

  if (!isConvex(q)) rejectReasons.push('non-convex');
  else reasons.push('convex quad');

  if (occupancy < FAST_ACCEPT_MIN_OCCUPANCY || occupancy > FAST_ACCEPT_MAX_OCCUPANCY) {
    rejectReasons.push(`occupancy ${occupancy.toFixed(3)} out of range`);
  } else {
    reasons.push('plausible occupancy');
  }

  if (aspect == null) rejectReasons.push('aspect undefined');
  else {
    const err = Math.abs(aspect - CARD_ASPECT) / CARD_ASPECT;
    if (err > FAST_ACCEPT_MAX_ASPECT_ERR) {
      rejectReasons.push(`aspect err ${err.toFixed(3)}`);
    } else {
      reasons.push('aspect near 63:88');
    }
  }

  if (margin < FAST_ACCEPT_MIN_SCORE_MARGIN) {
    rejectReasons.push(`weak margin ${margin.toFixed(3)}`);
  } else {
    reasons.push('no serious competitor');
  }

  const accept = rejectReasons.length === 0;
  const confidence = accept
    ? Math.min(1, 0.55 + 0.35 * args.score + 0.1 * Math.min(1, margin))
    : Math.max(0, args.score * 0.4);

  return {
    accept,
    confidence,
    reasons,
    rejectReasons,
    aspect,
    occupancy,
    scoreMargin: margin,
  };
};

/**
 * Cheap internal layout bonus after a provisional warp (optional).
 * Returns 0..1 additive confidence — never a hard gate.
 * Uses edge density in expected title / mana ROIs on a rectified card image.
 */
export const scoreMtgInternalLandmarks = (warped: ScanImage): number => {
  const { width: w, height: h, data } = warped;
  if (w < 64 || h < 64 || !data) return 0;
  const sampleBand = (x0: number, y0: number, x1: number, y1: number): number => {
    const xa = Math.max(0, Math.floor(x0 * w));
    const xb = Math.min(w, Math.ceil(x1 * w));
    const ya = Math.max(0, Math.floor(y0 * h));
    const yb = Math.min(h, Math.ceil(y1 * h));
    let edge = 0;
    let n = 0;
    for (let y = ya; y < yb; y += 2) {
      for (let x = xa; x < xb; x += 2) {
        const i = (y * w + x) * 4;
        const L = (data[i]! + data[i + 1]! + data[i + 2]!) / 3;
        const i2 = (y * w + Math.min(w - 1, x + 2)) * 4;
        const L2 = (data[i2]! + data[i2 + 1]! + data[i2 + 2]!) / 3;
        edge += Math.abs(L - L2);
        n += 1;
      }
    }
    return n ? edge / n : 0;
  };
  // Title band (left/center top) and mana ROI (top-right).
  const title = sampleBand(0.06, 0.04, 0.72, 0.12);
  const mana = sampleBand(0.72, 0.03, 0.96, 0.12);
  const art = sampleBand(0.1, 0.18, 0.9, 0.55);
  // Normalize roughly: title/mana should have structure; art should not be flat zero.
  const titleN = Math.min(1, title / 18);
  const manaN = Math.min(1, mana / 18);
  const artN = Math.min(1, art / 12);
  // Mana is a bonus only (lands have none).
  return Math.min(1, 0.45 * titleN + 0.25 * artN + 0.3 * manaN);
};
