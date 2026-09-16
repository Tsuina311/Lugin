/**
 * Continuous card-change — embedding similarity + absence + geometry displacement.
 * Thresholds are named constants (tune via telemetry later).
 */

import { cornersToQuad, dist } from '../geometry';
import type { CardCorners } from '../types';

/** Cosine similarity below this → treat as different card (embedding gate). */
export const CARD_CHANGE_EMBEDDING_SIM_MAX = 0.72;
/** Cosine similarity above this → same card (suppress duplicate / new track). */
export const CARD_CHANGE_EMBEDDING_SAME_MIN = 0.88;
/** Consecutive miss frames before absence fallback starts a new track. */
export const CARD_CHANGE_ABSENCE_FRAMES = 6;
/** Center displacement / frame diagonal above this → geometry displacement. */
export const CARD_CHANGE_CENTER_DISPLACEMENT_NORM = 0.18;
/** IoU below this with displacement strengthens new-track. */
export const CARD_CHANGE_IOU_MAX = 0.35;
/** Require this many consecutive “different” embedding votes (hysteresis). */
export const CARD_CHANGE_EMBEDDING_CONFIRM_FRAMES = 2;

export type CardChangeSignals = {
  /** Cosine similarity vs locked embedding; null if unavailable. */
  embeddingSimilarity: number | null;
  /** Consecutive frames with no eligible card. */
  missFrames: number;
  /** Current ROI vs locked ROI (optional). */
  corners: CardCorners | null;
  lockedCorners: CardCorners | null;
  frame: { width: number; height: number } | null;
  /** Consecutive embedding-diff frames already counted. */
  embeddingDiffStreak?: number;
};

export type CardChangeDecision = {
  startNewTrack: boolean;
  suppressDuplicate: boolean;
  reason: string;
};

const centerOf = (c: CardCorners) => {
  const q = cornersToQuad(c);
  return {
    x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4,
    y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4,
  };
};

const quadArea = (c: CardCorners): number => {
  const q = cornersToQuad(c);
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i]!;
    const r = q[(i + 1) % 4]!;
    a += p.x * r.y - r.x * p.y;
  }
  return Math.abs(a) / 2;
};

/** Cheap polygon IoU for card-change (axis-free shoelace approx via AABB fallback). */
export const continuousQuadIoU = (a: CardCorners, b: CardCorners): number => {
  const qa = cornersToQuad(a);
  const qb = cornersToQuad(b);
  const aabb = (q: typeof qa) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of q) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY };
  };
  const A = aabb(qa);
  const B = aabb(qb);
  const ix0 = Math.max(A.minX, B.minX);
  const iy0 = Math.max(A.minY, B.minY);
  const ix1 = Math.min(A.maxX, B.maxX);
  const iy1 = Math.min(A.maxY, B.maxY);
  const iw = Math.max(0, ix1 - ix0);
  const ih = Math.max(0, iy1 - iy0);
  const inter = iw * ih;
  const areaA = Math.max(1e-3, (A.maxX - A.minX) * (A.maxY - A.minY));
  const areaB = Math.max(1e-3, (B.maxX - B.minX) * (B.maxY - B.minY));
  return inter / (areaA + areaB - inter);
};

export const cosineSimilarity = (
  a: ArrayLike<number> | null | undefined,
  b: ArrayLike<number> | null | undefined,
): number | null => {
  if (!a || !b || a.length === 0 || a.length !== b.length) return null;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  if (!(d > 1e-12)) return null;
  return dot / d;
};

const geometryDisplaced = (args: CardChangeSignals): boolean => {
  if (!args.corners || !args.lockedCorners || !args.frame) return false;
  const { width, height } = args.frame;
  if (!(width > 1 && height > 1)) return false;
  const diag = Math.hypot(width, height);
  const ca = centerOf(args.corners);
  const cb = centerOf(args.lockedCorners);
  const centerNorm = dist(ca, cb) / Math.max(1, diag);
  const iou = continuousQuadIoU(args.corners, args.lockedCorners);
  // Ignore empty / nonsense quads.
  if (quadArea(args.corners) < 1 || quadArea(args.lockedCorners) < 1) return false;
  return (
    centerNorm >= CARD_CHANGE_CENTER_DISPLACEMENT_NORM && iou <= CARD_CHANGE_IOU_MAX
  );
};

/** True when locked identity should stay and not re-publish. */
export const shouldSuppressDuplicate = (args: CardChangeSignals): boolean => {
  const sim = args.embeddingSimilarity;
  if (sim != null && sim >= CARD_CHANGE_EMBEDDING_SAME_MIN) return true;
  if (args.missFrames > 0) return false;
  if (sim != null && sim >= CARD_CHANGE_EMBEDDING_SIM_MAX && !geometryDisplaced(args)) {
    return true;
  }
  return false;
};

/** True when Continuous should start a fresh track (unlock / CARD_CHANGE). */
export const shouldStartNewTrack = (args: CardChangeSignals): boolean => {
  if (shouldSuppressDuplicate(args)) {
    return false;
  }

  if (args.missFrames >= CARD_CHANGE_ABSENCE_FRAMES) {
    return true;
  }

  const sim = args.embeddingSimilarity;
  const streak = args.embeddingDiffStreak ?? 0;
  if (
    sim != null &&
    sim < CARD_CHANGE_EMBEDDING_SIM_MAX &&
    streak + 1 >= CARD_CHANGE_EMBEDDING_CONFIRM_FRAMES
  ) {
    return true;
  }

  if (geometryDisplaced(args) && (sim == null || sim < CARD_CHANGE_EMBEDDING_SAME_MIN)) {
    return true;
  }

  return false;
};

export const decideCardChange = (args: CardChangeSignals): CardChangeDecision => {
  if (shouldSuppressDuplicate(args)) {
    return { startNewTrack: false, suppressDuplicate: true, reason: 'same_card' };
  }
  if (shouldStartNewTrack(args)) {
    let reason = 'card_change';
    if (args.missFrames >= CARD_CHANGE_ABSENCE_FRAMES) reason = 'absence';
    else if (
      args.embeddingSimilarity != null &&
      args.embeddingSimilarity < CARD_CHANGE_EMBEDDING_SIM_MAX
    ) {
      reason = 'embedding_discontinuity';
    } else if (geometryDisplaced(args)) reason = 'geometry_displacement';
    return { startNewTrack: true, suppressDuplicate: false, reason };
  }
  return { startNewTrack: false, suppressDuplicate: false, reason: 'hold' };
};
