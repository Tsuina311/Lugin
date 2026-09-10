// Recognition geometry: complete-card warp quad, independent of track identity.
// Portable — no DOM / React Native.
//
// Measured on Samsung traces 0020 / 0033 / 0037 / 0041 (2026-09-07):
//   CARD_ASPECT = 63/88 ≈ 0.716
//   usable aspects: 0.663, 0.697, 0.758, 0.793  (≤11% off)
//   rejected grazing: 0.396 (44% off) on 0020
//   real sleeved pairs in continuity comments: area fraction ~0.40, IoU ~0.37
//   artwork / rules boxes sit well below 0.40 of the enclosing object

import { CARD_ASPECT, dist } from './geometry';
import { containsCandidate } from './detection/multi';
import type { CardCorners, Point } from './types';

export type RecognitionQuadSource =
  | 'tracked-card'
  | 'outer-fallback'
  | 'inner-card'
  | 'latest-raw'
  | 'refined'
  | 'none';

export interface RecognitionCandidate {
  aspect?: number;
  corners: CardCorners;
  score?: number;
}

export interface RecognitionQuadMetrics {
  area: number;
  aspect: number;
  centerOffset: number | null;
  innerArea: number | null;
  innerAspect: number | null;
  innerOuterAreaRatio: number | null;
  outerArea: number | null;
  outerAspect: number | null;
  rotationDelta: number | null;
}

export interface RecognitionQuadDecision {
  metrics: RecognitionQuadMetrics;
  recognitionQuad: CardCorners | null;
  recognitionQuadSource: RecognitionQuadSource;
  recognitionQuadValid: boolean;
  rejectReasons: string[];
  trackingQuad: CardCorners | null;
}

const pts = (c: CardCorners): Point[] => [c.topLeft, c.topRight, c.bottomRight, c.bottomLeft];

export const quadArea = (c: CardCorners): number => {
  const p = pts(c);
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const q = p[(i + 1) % 4];
    a += p[i].x * q.y - q.x * p[i].y;
  }
  return Math.abs(a) / 2;
};

export const quadCenter = (c: CardCorners): Point => ({
  x: (c.topLeft.x + c.topRight.x + c.bottomRight.x + c.bottomLeft.x) / 4,
  y: (c.topLeft.y + c.topRight.y + c.bottomRight.y + c.bottomLeft.y) / 4,
});

export const quadAspect = (c: CardCorners): number => {
  const w =
    (dist(c.topLeft, c.topRight) + dist(c.bottomLeft, c.bottomRight)) / 2;
  const h =
    (dist(c.topLeft, c.bottomLeft) + dist(c.topRight, c.bottomRight)) / 2;
  return w / Math.max(h, 1e-6);
};

const topAngle = (c: CardCorners): number =>
  Math.atan2(c.topRight.y - c.topLeft.y, c.topRight.x - c.topLeft.x);

const wrapAbs = (rad: number): number => {
  let a = rad;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return Math.abs(a);
};

const aabb = (c: CardCorners) => {
  const xs = pts(c).map(p => p.x);
  const ys = pts(c).map(p => p.y);
  return {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    y0: Math.min(...ys),
    y1: Math.max(...ys),
  };
};

/** 25% — ranking: 0033/0037/0041 pass; 0020 grazing 0.396 does not. */
export const RECOGNITION_ASPECT_TOLERANCE = 0.25;

/** Hard refuse only beyond this. 0020 error was 0.447; synthetic session quads sit ~0.34. */
export const RECOGNITION_ASPECT_HARD = 0.42;

/** Below this inner/outer area ratio the inner is an art/text box, not a sleeved card. */
export const SLEEVE_AREA_FRACTION_MIN = 0.4;

/** Top-edge inset above this (of outer height) crops away the title band. */
export const SLEEVE_TITLE_INSET_MAX = 0.12;

const CLIP_MARGIN = 0.02;

const emptyMetrics = (): RecognitionQuadMetrics => ({
  area: 0,
  aspect: 0,
  centerOffset: null,
  innerArea: null,
  innerAspect: null,
  innerOuterAreaRatio: null,
  outerArea: null,
  outerAspect: null,
  rotationDelta: null,
});

export const aspectError = (aspect: number): number =>
  Math.abs(aspect - CARD_ASPECT) / CARD_ASPECT;

export const isCardLikeAspect = (aspect: number): boolean =>
  aspectError(aspect) <= RECOGNITION_ASPECT_TOLERANCE;

export const validateRecognitionQuad = (
  quad: CardCorners | null,
  frame?: { height: number; width: number } | null,
  mode: 'rank' | 'hard' = 'rank',
): { ok: boolean; reasons: string[] } => {
  const reasons: string[] = [];
  if (!quad) return { ok: false, reasons: ['missing-quad'] };
  const aspect = quadAspect(quad);
  const err = aspectError(aspect);
  if (mode === 'rank' ? err > RECOGNITION_ASPECT_TOLERANCE : err > RECOGNITION_ASPECT_HARD) {
    reasons.push('implausible-aspect');
  }
  const area = quadArea(quad);
  if (area < 1) reasons.push('empty-area');
  if (frame && frame.width > 0 && frame.height > 0) {
    const margin = CLIP_MARGIN * Math.min(frame.width, frame.height);
    for (const p of pts(quad)) {
      if (p.x < -margin || p.y < -margin || p.x > frame.width + margin || p.y > frame.height + margin) {
        reasons.push('off-frame');
        break;
      }
    }
    const box = aabb(quad);
    const clipX = Math.max(0, -box.x0) + Math.max(0, box.x1 - frame.width);
    const clipY = Math.max(0, -box.y0) + Math.max(0, box.y1 - frame.height);
    if (clipX + clipY > 0.18 * (box.x1 - box.x0 + box.y1 - box.y0)) {
      reasons.push('severe-clip');
    }
  }
  return { ok: reasons.length === 0, reasons };
};

const titleInset = (outer: CardCorners, inner: CardCorners): number => {
  const o = aabb(outer);
  const i = aabb(inner);
  const h = Math.max(1, o.y1 - o.y0);
  return (i.y0 - o.y0) / h;
};

/**
 * Inner is a physical card in a sleeve only when size, centering, aspect,
 * and title-band inset all look like a card — not an artwork or rules box.
 */
export const isPlausibleCardInSleeve = (
  inner: CardCorners,
  outer: CardCorners,
): { ok: boolean; areaFraction: number; centerDistNorm: number; titleInset: number } => {
  const strict = containsCandidate(outer, inner);
  const areaO = quadArea(outer);
  const areaI = quadArea(inner);
  const areaFraction = areaO > 0 ? areaI / areaO : 0;
  const inset = titleInset(outer, inner);
  const centerDistNorm =
    dist(quadCenter(outer), quadCenter(inner)) / Math.max(Math.sqrt(areaO), 1);
  const aspectOk = isCardLikeAspect(quadAspect(inner)) && isCardLikeAspect(quadAspect(outer));
  const sizeOk = areaFraction >= SLEEVE_AREA_FRACTION_MIN && areaFraction <= 0.97;
  const centerOk = centerDistNorm <= 0.16;
  const titleOk = inset <= SLEEVE_TITLE_INSET_MAX && inset >= -0.04;
  const ok = (strict.ok || (sizeOk && centerOk && aspectOk)) && titleOk && aspectOk;
  return { ok, areaFraction, centerDistNorm, titleInset: inset };
};

const pairMetrics = (
  chosen: CardCorners | null,
  inner: CardCorners | null,
  outer: CardCorners | null,
): RecognitionQuadMetrics => {
  if (!chosen) return emptyMetrics();
  const areaI = inner ? quadArea(inner) : null;
  const areaO = outer ? quadArea(outer) : null;
  return {
    area: quadArea(chosen),
    aspect: quadAspect(chosen),
    centerOffset:
      inner && outer
        ? dist(quadCenter(inner), quadCenter(outer)) / Math.max(Math.sqrt(areaO ?? 1), 1)
        : null,
    innerArea: areaI,
    innerAspect: inner ? quadAspect(inner) : null,
    innerOuterAreaRatio: areaI != null && areaO != null && areaO > 0 ? areaI / areaO : null,
    outerArea: areaO,
    outerAspect: outer ? quadAspect(outer) : null,
    rotationDelta: inner && outer ? wrapAbs(topAngle(inner) - topAngle(outer)) : null,
  };
};

const aabbContainsCenter = (outer: CardCorners, inner: CardCorners): boolean => {
  const A = aabb(outer);
  const c = quadCenter(inner);
  return c.x >= A.x0 && c.x <= A.x1 && c.y >= A.y0 && c.y <= A.y1;
};

const findOuterFor = (
  inner: CardCorners,
  candidates: readonly RecognitionCandidate[],
): CardCorners | null => {
  let best: CardCorners | null = null;
  let bestArea = 0;
  let bestLike: CardCorners | null = null;
  let bestLikeArea = 0;
  const innerArea = quadArea(inner);
  for (const c of candidates) {
    if (c.corners === inner) continue;
    const area = quadArea(c.corners);
    if (area <= innerArea * 1.05) continue;
    if (!aabbContainsCenter(c.corners, inner)) continue;
    if (area > bestArea) {
      best = c.corners;
      bestArea = area;
    }
    if (isCardLikeAspect(quadAspect(c.corners)) && area > bestLikeArea) {
      bestLike = c.corners;
      bestLikeArea = area;
    }
  }
  return bestLike ?? best;
};

export const selectRecognitionQuad = (args: {
  candidates?: readonly RecognitionCandidate[] | null;
  frame?: { height: number; width: number } | null;
  rawQuad?: CardCorners | null;
  trackingQuad?: CardCorners | null;
}): RecognitionQuadDecision => {
  const tracking = args.trackingQuad ?? null;
  const raw = args.rawQuad ?? null;
  const extras = args.candidates ?? [];
  const seen = new Set<CardCorners>();
  const pool: RecognitionCandidate[] = [];
  const add = (corners: CardCorners | null, score?: number) => {
    if (!corners || seen.has(corners)) return;
    seen.add(corners);
    pool.push({ corners, score });
  };
  add(tracking);
  add(raw);
  for (const c of extras) add(c.corners, c.score);

  const reject: string[] = [];
  if (!pool.length) {
    return {
      metrics: emptyMetrics(),
      recognitionQuad: null,
      recognitionQuadSource: 'none',
      recognitionQuadValid: false,
      rejectReasons: ['no-candidates'],
      trackingQuad: tracking,
    };
  }

  let outer: CardCorners | null = null;
  let inner: CardCorners | null = tracking ?? raw;
  if (tracking && raw && tracking !== raw) {
    const tArea = quadArea(tracking);
    const rArea = quadArea(raw);
    if (rArea > tArea) {
      outer = raw;
      inner = tracking;
    } else if (tArea > rArea) {
      outer = tracking;
      inner = raw;
    }
  }
  const nestedOuter = inner ? findOuterFor(inner, pool) : null;
  if (nestedOuter) outer = nestedOuter;

  const trackCheck = validateRecognitionQuad(tracking, args.frame, 'rank');
  const rawCheck = validateRecognitionQuad(raw, args.frame, 'rank');
  const outerCheck = validateRecognitionQuad(outer, args.frame, 'rank');

  let chosen: CardCorners | null = null;
  let source: RecognitionQuadSource = 'none';

  if (inner && outer && inner !== outer) {
    const sleeve = isPlausibleCardInSleeve(inner, outer);
    if (sleeve.ok && validateRecognitionQuad(inner, args.frame, 'rank').ok) {
      chosen = inner;
      source = 'inner-card';
    } else if (outerCheck.ok) {
      chosen = outer;
      source = 'outer-fallback';
      if (!sleeve.ok) reject.push('inner-not-complete-card');
    }
  }

  if (!chosen && tracking && trackCheck.ok) {
    chosen = tracking;
    source = 'tracked-card';
  }
  if (!chosen && raw && rawCheck.ok) {
    chosen = raw;
    source = 'latest-raw';
  }
  if (!chosen && outer && outerCheck.ok) {
    chosen = outer;
    source = 'outer-fallback';
  }

  if (!chosen) {
    const ranked = [...pool].sort((a, b) => quadArea(b.corners) - quadArea(a.corners));
    for (const c of ranked) {
      const v = validateRecognitionQuad(c.corners, args.frame, 'rank');
      if (v.ok) {
        chosen = c.corners;
        source = c.corners === raw ? 'latest-raw' : c.corners === tracking ? 'tracked-card' : 'outer-fallback';
        break;
      }
      reject.push(...v.reasons);
    }
  }
  if (!chosen && pool.length) {
    chosen = pool.slice().sort((a, b) => quadArea(b.corners) - quadArea(a.corners))[0]?.corners ?? null;
    source = chosen === raw ? 'latest-raw' : chosen === tracking ? 'tracked-card' : 'outer-fallback';
  }

  const finalCheck = validateRecognitionQuad(chosen, args.frame, 'hard');
  if (!finalCheck.ok) reject.push(...finalCheck.reasons);
  const unique = [...new Set(reject)];

  return {
    metrics: pairMetrics(chosen, inner && outer && inner !== outer ? inner : null, outer),
    recognitionQuad: finalCheck.ok ? chosen : null,
    recognitionQuadSource: finalCheck.ok ? source : 'none',
    recognitionQuadValid: finalCheck.ok,
    rejectReasons: unique,
    trackingQuad: tracking,
  };
};
