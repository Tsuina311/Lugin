// Multi-card-ready detection contracts.
//
// Production single-card UX picks one primary via choosePrimaryDetection.
// Binder Scanner (future) will consume the full frame.detections array.
// Portable: no DOM / React Native.

import type { CardCorners, Point } from '../types';
import { CARD_ASPECT, cornersToQuad, dist } from '../geometry';

import type { DetectionCandidateDebug, DetectionDebug } from './types';

export type CardDetectionRole = 'card' | 'outer-container' | 'unknown';

/**
 * One card-like rectangle in a frame.
 *
 * `trackId` is reserved for a future multi-object tracker — leave undefined
 * until tracks exist. Do not invent random per-frame IDs.
 */
export interface CardDetection {
  areaRatio: number;
  aspectRatio: number;
  corners: CardCorners;
  /** Stable across frames once tracking exists; optional today. */
  trackId?: string;
  role: CardDetectionRole;
  score: number;
}

export interface CardDetectionFrame {
  detections: CardDetection[];
  /** Detector wall time (ms), when known. */
  timingMs?: number;
  workSize?: { height: number; width: number };
}

export interface NestedRelation {
  /** Index of the outer (likely sleeve) candidate. */
  outer: number;
  /** Index of the inner (likely card) candidate. */
  inner: number;
  /** Area(inner) / area(outer) — typically ~0.75–0.95 for sleeves. */
  areaFraction: number;
  centerDistNorm: number;
}

const quadArea = (corners: CardCorners): number => {
  const q = cornersToQuad(corners);
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
};

const quadCenter = (corners: CardCorners): Point => {
  const q = cornersToQuad(corners);
  return {
    x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4,
    y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4,
  };
};

const aspectOf = (corners: CardCorners): number => {
  const q = cornersToQuad(corners);
  const w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
  const h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  return w / Math.max(h, 1e-6);
};

/** True when A fully contains B's center and B is meaningfully smaller. */
export const containsCandidate = (
  outer: CardCorners,
  inner: CardCorners,
): { ok: boolean; areaFraction: number; centerDistNorm: number } => {
  const aOuter = quadArea(outer);
  const aInner = quadArea(inner);
  if (aOuter < 1e-3 || aInner < 1e-3) {
    return { ok: false, areaFraction: 0, centerDistNorm: 1 };
  }
  const areaFraction = aInner / aOuter;
  // Sleeve: inner card fills most of the sleeve but not the whole.
  if (areaFraction < 0.55 || areaFraction > 0.97) {
    return { ok: false, areaFraction, centerDistNorm: 1 };
  }
  const cO = quadCenter(outer);
  const cI = quadCenter(inner);
  const diag = Math.sqrt(aOuter);
  const centerDistNorm = dist(cO, cI) / Math.max(diag, 1);
  if (centerDistNorm > 0.12) {
    return { ok: false, areaFraction, centerDistNorm };
  }
  // Aspect should stay card-like for both (soft).
  const aspO = aspectOf(outer);
  const aspI = aspectOf(inner);
  const aspectOk =
    Math.abs(aspI - CARD_ASPECT) / CARD_ASPECT < 0.45 &&
    Math.abs(aspO - CARD_ASPECT) / CARD_ASPECT < 0.55;
  return { ok: aspectOk, areaFraction, centerDistNorm };
};

export const findNestedRelations = (detections: readonly CardDetection[]): NestedRelation[] => {
  const out: NestedRelation[] = [];
  // Bound pairwise work: only top-N by score.
  const ranked = detections
    .map((d, i) => ({ d, i }))
    .sort((a, b) => b.d.score - a.d.score)
    .slice(0, 8);
  for (let a = 0; a < ranked.length; a++) {
    for (let b = 0; b < ranked.length; b++) {
      if (a === b) continue;
      const outer = ranked[a];
      const inner = ranked[b];
      if (outer.d.areaRatio <= inner.d.areaRatio) continue;
      const rel = containsCandidate(outer.d.corners, inner.d.corners);
      if (!rel.ok) continue;
      out.push({
        outer: outer.i,
        inner: inner.i,
        areaFraction: rel.areaFraction,
        centerDistNorm: rel.centerDistNorm,
      });
    }
  }
  return out;
};

/**
 * Prefer the inner card when nested evidence is strong; otherwise highest score.
 * Marks roles on a copy of the list.
 */
export const choosePrimaryDetection = (
  frame: CardDetectionFrame,
): {
  primary: CardDetection | null;
  detections: CardDetection[];
  nested: NestedRelation[];
  provisionalOuter: CardDetection | null;
} => {
  const detections = frame.detections.map(d => ({ ...d }));
  if (!detections.length) {
    return { primary: null, detections, nested: [], provisionalOuter: null };
  }

  const nested = findNestedRelations(detections);
  let primaryIndex = 0;
  for (let i = 1; i < detections.length; i++) {
    if (detections[i].score > detections[primaryIndex].score) primaryIndex = i;
  }

  let provisionalOuter: CardDetection | null = null;
  if (nested.length) {
    // Prefer the nested pair whose inner has the best score among inners.
    let best = nested[0];
    for (const n of nested) {
      if (detections[n.inner].score > detections[best.inner].score) best = n;
    }
    detections[best.outer] = { ...detections[best.outer], role: 'outer-container' };
    detections[best.inner] = { ...detections[best.inner], role: 'card' };
    // Switch to inner when it is at least moderately confident, or outer is
    // only marginally better (sleeve silhouette often scores higher).
    const inner = detections[best.inner];
    const outer = detections[best.outer];
    if (inner.score >= 0.28 || inner.score >= outer.score * 0.75) {
      primaryIndex = best.inner;
      provisionalOuter = outer;
    } else {
      // Outer only — use as provisional tracking geometry.
      primaryIndex = best.outer;
      provisionalOuter = outer;
      detections[best.outer] = { ...detections[best.outer], role: 'outer-container' };
    }
  } else {
    detections[primaryIndex] = { ...detections[primaryIndex], role: 'card' };
  }

  return {
    primary: detections[primaryIndex] ?? null,
    detections,
    nested,
    provisionalOuter,
  };
};

/** Build CardDetection list from shared detect debug candidates (accepted only). */
export const detectionsFromDebug = (
  debug: DetectionDebug,
  frameArea: number,
): CardDetection[] => {
  const accepted = debug.candidates.filter(c => c.corners && !c.rejectedBecause.length);
  // Deduplicate near-identical quads (same component across masks).
  const kept: CardDetection[] = [];
  for (const c of accepted) {
    if (!c.corners) continue;
    const areaRatio =
      frameArea > 0 ? quadArea(c.corners) / frameArea : c.components.area;
    const aspectRatio = aspectOf(c.corners);
    const next: CardDetection = {
      areaRatio,
      aspectRatio,
      corners: c.corners,
      role: 'unknown',
      score: c.score,
    };
    const dup = kept.find(k => {
      const rel = containsCandidate(k.corners, next.corners);
      const rev = containsCandidate(next.corners, k.corners);
      if (rel.ok || rev.ok) return false; // keep nested pairs
      const ck = quadCenter(k.corners);
      const cn = quadCenter(next.corners);
      return dist(ck, cn) < 8 && Math.abs(k.areaRatio - next.areaRatio) < 0.04;
    });
    if (dup) {
      if (next.score > dup.score) {
        const i = kept.indexOf(dup);
        kept[i] = next;
      }
      continue;
    }
    kept.push(next);
  }
  return kept.sort((a, b) => b.score - a.score).slice(0, 12);
};

/** Compatibility: multi frame → single DetectResult-shaped primary. */
export const primaryCornersFromFrame = (
  frame: CardDetectionFrame,
): { corners: CardCorners | null; score: number; debugExtras?: DetectionCandidateDebug } => {
  const { primary } = choosePrimaryDetection(frame);
  if (!primary) return { corners: null, score: 0 };
  return { corners: primary.corners, score: primary.score };
};

/** Apply nested preference to an already-chosen DetectResult debug list. */
export const selectPrimaryAmongDebugCandidates = (
  candidates: DetectionCandidateDebug[],
  frameW: number,
  frameH: number,
): { selectedIndex: number; roleByIndex: Map<number, CardDetectionRole> } => {
  const frame: CardDetectionFrame = {
    detections: [],
  };
  const indexMap: number[] = [];
  const area = Math.max(1, frameW * frameH);
  candidates.forEach((c, i) => {
    if (!c.corners || c.rejectedBecause.length) return;
    indexMap.push(i);
    frame.detections.push({
      areaRatio: quadArea(c.corners) / area,
      aspectRatio: aspectOf(c.corners),
      corners: c.corners,
      role: 'unknown',
      score: c.score,
    });
  });
  if (!frame.detections.length) {
    return { selectedIndex: -1, roleByIndex: new Map() };
  }
  const choice = choosePrimaryDetection(frame);
  const roleByIndex = new Map<number, CardDetectionRole>();
  choice.detections.forEach((d, j) => {
    roleByIndex.set(indexMap[j], d.role);
  });
  if (!choice.primary) return { selectedIndex: -1, roleByIndex };
  const primaryLocal = choice.detections.indexOf(choice.primary);
  const selectedIndex = primaryLocal >= 0 ? indexMap[primaryLocal] : -1;
  return { selectedIndex, roleByIndex };
};
