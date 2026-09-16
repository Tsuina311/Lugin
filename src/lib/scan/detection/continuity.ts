// Cross-frame candidate continuity.
//
// Instantaneous max-score selection flips between inner card and sleeve when
// scores oscillate by 0.01. Once a track exists, prefer spatial agreement.

import { CARD_ASPECT, dist, normalizeCardCorners } from '../geometry';
import {
  CONTINUITY_INNER_PROMOTE_FRAMES,
  CONTINUITY_KEEP_IOU,
  CONTINUITY_SWITCH_FRAMES,
  CONTINUITY_SWITCH_IOU,
  CONTINUITY_SWITCH_SCORE_MARGIN,
  DETECT_MIN_SCORE,
  TRACK_COAST_FRAMES,
  TRACK_SMOOTH_ALPHA,
} from '../params';
import type { CardCorners, Point } from '../types';

import { containsCandidate } from './multi';
import {
  selectRecognitionQuad,
  type RecognitionQuadSource,
} from '../recognitionQuad';

export type SelectedRole = 'card-inner' | 'outer-container' | 'single' | 'unknown';

export interface ContinuityCandidate {
  aspect?: number;
  corners: CardCorners;
  score: number;
}

export interface ContinuityTrack {
  age: number;
  coast: number;
  corners: CardCorners;
  createdAt: number;
  /**
   * After a new physical cardSession on the same geometryTrackId, force the
   * next hit to adopt raw corners immediately (do not hysteresis-hold A).
   */
  forceAdoptNext: boolean;
  /** Why tracked corners were last held instead of updated (0015 diagnostics). */
  holdReason: string | null;
  id: number;
  innerPresentCount: number;
  lastHitAt: number;
  lastReason: string;
  outerPresentCount: number;
  role: SelectedRole;
  roleAge: number;
  roleSwitchCount: number;
  score: number;
  /** When tracked corners last changed. */
  updatedAt: number;
}

export interface ContinuityMetrics {
  areaDelta: number;
  centerDelta: number;
  cornerDelta: number;
  iou: number;
  rotationDelta: number;
}

export interface ContinuityState {
  lastResetReason: string | null;
  nextId: number;
  pendingSwitch: number;
  presented: CardCorners | null;
  roleSwitchCount: number;
  track: ContinuityTrack | null;
}

export interface ContinuityDecision {
  hit: boolean;
  metrics: ContinuityMetrics;
  presentedCorners: CardCorners | null;
  rawCorners: CardCorners | null;
  recognitionQuad: CardCorners | null;
  recognitionQuadSource: RecognitionQuadSource;
  recognitionQuadValid: boolean;
  recognitionRejectReasons: string[];
  selectedIndex: number;
  selectedRole: SelectedRole;
  selectionReason: string;
  state: ContinuityState;
  switched: boolean;
  track: ContinuityTrack | null;
  trackHoldReason: string | null;
  trackUpdateReason: string | null;
  trackedCorners: CardCorners | null;
  trackedQuadUpdatedAt: number | null;
}

const nowMs = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const emptyMetrics = (): ContinuityMetrics => ({
  areaDelta: 0,
  centerDelta: 1,
  cornerDelta: 1,
  iou: 0,
  rotationDelta: 0,
});

export const emptyContinuity = (): ContinuityState => ({
  lastResetReason: null,
  nextId: 1,
  pendingSwitch: 0,
  presented: null,
  roleSwitchCount: 0,
  track: null,
});

/**
 * New physical card on the same geometry track: keep track.id, but force the
 * next detector hit to replace held corners (deck swap / cardSession bump).
 */
export const softResetContinuityForNewCardSession = (
  state: ContinuityState,
  reason = 'new-card-session',
): ContinuityState => {
  if (!state.track) {
    return { ...state, lastResetReason: reason, pendingSwitch: 0, presented: null };
  }
  return {
    ...state,
    lastResetReason: reason,
    pendingSwitch: 0,
    presented: null,
    track: {
      ...state.track,
      forceAdoptNext: true,
      holdReason: null,
      innerPresentCount: 0,
      lastReason: reason,
      outerPresentCount: 0,
      score: 0,
    },
  };
};

const pts = (c: CardCorners): Point[] => [
  c.topLeft,
  c.topRight,
  c.bottomRight,
  c.bottomLeft,
];

const quadArea = (c: CardCorners): number => {
  const p = pts(c);
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const q = p[(i + 1) % 4];
    a += p[i].x * q.y - q.x * p[i].y;
  }
  return Math.abs(a) / 2;
};

const quadCenter = (c: CardCorners): Point => ({
  x: (c.topLeft.x + c.topRight.x + c.bottomRight.x + c.bottomLeft.x) / 4,
  y: (c.topLeft.y + c.topRight.y + c.bottomRight.y + c.bottomLeft.y) / 4,
});

const diagonal = (c: CardCorners): number =>
  Math.max(dist(c.topLeft, c.bottomRight), dist(c.topRight, c.bottomLeft), 1);

const quadAspect = (c: CardCorners): number => {
  const w =
    (dist(c.topLeft, c.topRight) + dist(c.bottomLeft, c.bottomRight)) / 2;
  const h =
    (dist(c.topLeft, c.bottomLeft) + dist(c.topRight, c.bottomRight)) / 2;
  return w / Math.max(h, 1e-6);
};

/** Soft MTG aspect gate — title bands / glare islands sit well outside. */
const plausibleCardAspect = (c: CardCorners): boolean =>
  Math.abs(quadAspect(c) - CARD_ASPECT) / CARD_ASPECT < 0.45;

/**
 * Adopt a larger raw only when the track is a false inner (title band / glare
 * island), NEVER when it is a plausible sleeved card.
 *
 * Sleeve signature: nest raw-is-outer, track role card-inner, card-like aspect,
 * areaFrac typically ≳ 0.28. "Just larger" is not enough.
 */
const shouldAdoptLargerRawAsFalseInner = (
  track: ContinuityTrack,
  compare: CardCorners,
  metrics: ContinuityMetrics,
  nest: NestedKind,
): boolean => {
  if (nest !== 'raw-is-outer' && nest !== 'none') return false;
  if (metrics.iou >= CONTINUITY_SWITCH_IOU) return false;
  const areaT = quadArea(track.corners);
  const areaR = quadArea(compare);
  if (areaR <= areaT) return false;
  const areaFrac = areaT / Math.max(1, areaR);

  // Established sleeved card — keep the physical card, ignore sleeve outer.
  if (
    nest === 'raw-is-outer' &&
    track.role === 'card-inner' &&
    track.age >= 5 &&
    plausibleCardAspect(track.corners) &&
    areaFrac >= 0.28
  ) {
    return false;
  }

  const tiny = areaFrac < 0.22;
  const weirdAspect = !plausibleCardAspect(track.corners);
  // Require strong evidence the track is wrong — not merely smaller.
  return tiny || weirdAspect;
};

const aabb = (c: CardCorners) => {
  const xs = [c.topLeft.x, c.topRight.x, c.bottomRight.x, c.bottomLeft.x];
  const ys = [c.topLeft.y, c.topRight.y, c.bottomRight.y, c.bottomLeft.y];
  return {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    y0: Math.min(...ys),
    y1: Math.max(...ys),
  };
};

export const aabbIou = (a: CardCorners, b: CardCorners): number => {
  const A = aabb(a);
  const B = aabb(b);
  const x0 = Math.max(A.x0, B.x0);
  const y0 = Math.max(A.y0, B.y0);
  const x1 = Math.min(A.x1, B.x1);
  const y1 = Math.min(A.y1, B.y1);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const areaA = Math.max(1, (A.x1 - A.x0) * (A.y1 - A.y0));
  const areaB = Math.max(1, (B.x1 - B.x0) * (B.y1 - B.y0));
  const union = areaA + areaB - inter;
  return union > 1e-6 ? inter / union : 0;
};

const topEdgeAngle = (c: CardCorners): number =>
  Math.atan2(c.topRight.y - c.topLeft.y, c.topRight.x - c.topLeft.x);

const wrapAngle = (rad: number): number => {
  let a = rad;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return Math.abs(a);
};

const meanCornerMove = (a: CardCorners, b: CardCorners): number => {
  const pa = pts(a);
  const pb = pts(b);
  let sum = 0;
  for (let i = 0; i < 4; i++) sum += dist(pa[i], pb[i]);
  return sum / 4;
};

export const measureContinuity = (prev: CardCorners, next: CardCorners): ContinuityMetrics => {
  const diag = diagonal(next);
  const c0 = quadCenter(prev);
  const c1 = quadCenter(next);
  const a0 = quadArea(prev);
  const a1 = quadArea(next);
  return {
    areaDelta: Math.abs(a1 - a0) / Math.max(a0, a1, 1),
    centerDelta: dist(c0, c1) / diag,
    cornerDelta: meanCornerMove(prev, next) / diag,
    iou: aabbIou(prev, next),
    rotationDelta: wrapAngle(topEdgeAngle(next) - topEdgeAngle(prev)),
  };
};

export const isNestedPair = (a: CardCorners, b: CardCorners): boolean =>
  containsCandidate(a, b).ok || containsCandidate(b, a).ok;

const inferRole = (
  tracked: CardCorners,
  raw: CardCorners,
  nestedHint?: boolean,
): SelectedRole => {
  const inner = containsCandidate(raw, tracked);
  const outer = containsCandidate(tracked, raw);
  if (inner.ok) return 'card-inner';
  if (outer.ok) return 'outer-container';
  if (nestedHint) return 'card-inner';
  return 'single';
};

const lerpPoint = (a: Point, b: Point, t: number): Point => ({
  x: a.x * (1 - t) + b.x * t,
  y: a.y * (1 - t) + b.y * t,
});

const smoothCorners = (prev: CardCorners | null, next: CardCorners): CardCorners => {
  if (!prev) return next;
  const w = 1 - TRACK_SMOOTH_ALPHA;
  return {
    bottomLeft: lerpPoint(prev.bottomLeft, next.bottomLeft, w),
    bottomRight: lerpPoint(prev.bottomRight, next.bottomRight, w),
    topLeft: lerpPoint(prev.topLeft, next.topLeft, w),
    topRight: lerpPoint(prev.topRight, next.topRight, w),
  };
};

const trackingScore = (score: number, metrics: ContinuityMetrics, roleBonus = 0): number =>
  score + 0.55 * metrics.iou - 0.4 * metrics.centerDelta - 0.25 * metrics.areaDelta + roleBonus;

const sameObject = (metrics: ContinuityMetrics): boolean =>
  metrics.iou >= CONTINUITY_KEEP_IOU ||
  (metrics.iou >= 0.5 && metrics.centerDelta < 0.08 && metrics.areaDelta < 0.16);

type NestedKind = 'none' | 'raw-is-inner' | 'raw-is-outer';

const aabbContainsCenter = (box: CardCorners, c: Point): boolean => {
  const A = aabb(box);
  return c.x >= A.x0 && c.x <= A.x1 && c.y >= A.y0 && c.y <= A.y1;
};

/**
 * Sleeve vs inner card. `containsCandidate` requires area fraction ≥ 0.55;
 * real sleeved traces sat near IoU 0.37 (fraction ~0.4) and failed that test,
 * so the tracker treated the pair as unrelated objects.
 */
const nestedKind = (track: CardCorners, raw: CardCorners): NestedKind => {
  if (containsCandidate(track, raw).ok) return 'raw-is-inner';
  if (containsCandidate(raw, track).ok) return 'raw-is-outer';
  const areaT = quadArea(track);
  const areaR = quadArea(raw);
  const frac = Math.min(areaT, areaR) / Math.max(areaT, areaR, 1);
  if (frac < 0.32 || frac > 0.98) return 'none';
  const cT = quadCenter(track);
  const cR = quadCenter(raw);
  const larger = areaR >= areaT ? raw : track;
  if (dist(cT, cR) / diagonal(larger) > 0.22) return 'none';
  const iou = aabbIou(track, raw);
  if (iou < 0.22 && !aabbContainsCenter(larger, areaR >= areaT ? cT : cR)) return 'none';
  return areaR < areaT ? 'raw-is-inner' : 'raw-is-outer';
};

type Intent = 'keep-update' | 'keep-hold' | 'promote-inner' | 'switch';

const intentFor = (track: ContinuityTrack, raw: CardCorners, rawScore: number): Intent => {
  const nest = nestedKind(track.corners, raw);
  if (nest === 'raw-is-outer') return 'keep-hold';
  if (nest === 'raw-is-inner') {
    if (track.role === 'card-inner') return 'keep-update';
    return track.innerPresentCount + 1 >= CONTINUITY_INNER_PROMOTE_FRAMES
      ? 'promote-inner'
      : 'keep-hold';
  }
  const metrics = measureContinuity(track.corners, raw);
  if (sameObject(metrics)) return 'keep-update';
  if (
    rawScore >= track.score + CONTINUITY_SWITCH_SCORE_MARGIN &&
    metrics.iou < CONTINUITY_SWITCH_IOU &&
    metrics.centerDelta > 0.22
  ) {
    return 'switch';
  }
  return 'keep-hold';
};

const pickCandidate = (
  track: ContinuityTrack,
  raw: CardCorners,
  rawScore: number,
  candidates: readonly ContinuityCandidate[],
): { corners: CardCorners; index: number; score: number } => {
  if (!candidates.length) return { corners: raw, index: -1, score: rawScore };
  let bestI = 0;
  let best = -Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const metrics = measureContinuity(track.corners, candidates[i].corners);
    const nest = nestedKind(track.corners, candidates[i].corners);
    let bonus = 0;
    if (track.role === 'card-inner' && nest === 'raw-is-inner') bonus += 0.2;
    if (track.role === 'card-inner' && nest === 'raw-is-outer') bonus -= 0.25;
    if (track.role === 'outer-container' && nest === 'raw-is-outer') bonus += 0.08;
    const s = trackingScore(candidates[i].score, metrics, bonus);
    if (s > best) {
      best = s;
      bestI = i;
    }
  }
  const chosen = candidates[bestI];
  return { corners: chosen.corners, index: bestI, score: chosen.score };
};

/**
 * Choose this frame's tracked quad.
 *
 * Raw max-score is used only to start a track. After that, a slightly better
 * sleeve/card sibling cannot replace the established object.
 */
export const stepContinuity = (
  state: ContinuityState,
  input: {
    candidates?: readonly ContinuityCandidate[];
    frameSize?: { height: number; width: number } | null;
    now?: number;
    rawCorners: CardCorners | null;
    rawScore: number;
  },
): ContinuityDecision => {
  const now = input.now ?? nowMs();
  const rawCorners = input.rawCorners ? normalizeCardCorners(input.rawCorners) : null;
  const candidates = (input.candidates ?? []).map(c => ({
    ...c,
    corners: normalizeCardCorners(c.corners),
  }));
  const hit = Boolean(rawCorners && input.rawScore >= DETECT_MIN_SCORE);

  const finish = (
    next: ContinuityState,
    extra: Omit<
      ContinuityDecision,
      | 'state'
      | 'trackHoldReason'
      | 'trackUpdateReason'
      | 'trackedQuadUpdatedAt'
      | 'recognitionQuad'
      | 'recognitionQuadSource'
      | 'recognitionQuadValid'
      | 'recognitionRejectReasons'
    >,
  ): ContinuityDecision => {
    const rec = selectRecognitionQuad({
      candidates: input.candidates,
      frame: input.frameSize,
      rawQuad: extra.rawCorners,
      trackingQuad: extra.trackedCorners,
    });
    return {
      ...extra,
      recognitionQuad: rec.recognitionQuad,
      recognitionQuadSource: rec.recognitionQuadSource,
      recognitionQuadValid: rec.recognitionQuadValid,
      recognitionRejectReasons: rec.rejectReasons,
      state: next,
      trackHoldReason: next.track?.holdReason ?? extra.track?.holdReason ?? null,
      trackUpdateReason: next.track?.lastReason ?? extra.track?.lastReason ?? null,
      trackedQuadUpdatedAt: next.track?.updatedAt ?? extra.track?.updatedAt ?? null,
    };
  };

  if (!hit || !rawCorners) {
    if (!state.track) {
      return finish(
        { ...state, presented: null, lastResetReason: state.track ? state.lastResetReason : 'no geometry' },
        {
          hit: false,
          metrics: emptyMetrics(),
          presentedCorners: null,
          rawCorners,
          selectedIndex: -1,
          selectedRole: 'unknown',
          selectionReason: 'miss — no track',
          switched: false,
          track: null,
          trackedCorners: null,
        },
      );
    }
    const coast = state.track.coast + 1;
    if (coast > TRACK_COAST_FRAMES) {
      return finish(
        {
          ...emptyContinuity(),
          lastResetReason: 'grace exhausted',
          nextId: state.nextId,
          roleSwitchCount: state.roleSwitchCount,
        },
        {
          hit: false,
          metrics: emptyMetrics(),
          presentedCorners: null,
          rawCorners,
          selectedIndex: -1,
          selectedRole: state.track.role,
          selectionReason: 'miss — track reset after grace',
          switched: false,
          track: null,
          trackedCorners: null,
        },
      );
    }
    const coasted: ContinuityTrack = { ...state.track, coast, lastReason: 'miss — grace' };
    return finish(
      { ...state, track: coasted, pendingSwitch: 0 },
      {
        hit: false,
        metrics: emptyMetrics(),
        presentedCorners: state.presented,
        rawCorners,
        selectedIndex: -1,
        selectedRole: coasted.role,
        selectionReason: 'miss — grace, track retained',
        switched: false,
        track: coasted,
        trackedCorners: coasted.corners,
      },
    );
  }

  if (!state.track) {
    const role: SelectedRole = 'single';
    const track: ContinuityTrack = {
      age: 1,
      coast: 0,
      corners: rawCorners,
      createdAt: now,
      forceAdoptNext: false,
      holdReason: null,
      id: state.nextId,
      innerPresentCount: 0,
      lastHitAt: now,
      lastReason: 'new track',
      outerPresentCount: 0,
      role,
      roleAge: 1,
      roleSwitchCount: 0,
      score: input.rawScore,
      updatedAt: now,
    };
    return finish(
      {
        ...state,
        lastResetReason: null,
        nextId: state.nextId + 1,
        pendingSwitch: 0,
        presented: rawCorners,
        track,
      },
      {
        hit: true,
        metrics: emptyMetrics(),
        presentedCorners: rawCorners,
        rawCorners,
        selectedIndex: 0,
        selectedRole: role,
        selectionReason: 'new track from raw primary',
        switched: false,
        track,
        trackedCorners: rawCorners,
      },
    );
  }

  const picked = pickCandidate(state.track, rawCorners, input.rawScore, candidates);
  const compare = picked.corners;
  const metrics = measureContinuity(state.track.corners, compare);

  // New cardSession on same geometryTrack: adopt raw immediately (fail-open to fresh pixels).
  if (state.track.forceAdoptNext) {
    const track: ContinuityTrack = {
      ...state.track,
      age: state.track.age + 1,
      coast: 0,
      corners: compare,
      forceAdoptNext: false,
      holdReason: null,
      lastHitAt: now,
      lastReason: 'force adopt after new card session',
      score: Math.max(picked.score, input.rawScore),
      updatedAt: now,
    };
    return finish(
      {
        ...state,
        lastResetReason: null,
        pendingSwitch: 0,
        presented: compare,
        track,
      },
      {
        hit: true,
        metrics,
        presentedCorners: compare,
        rawCorners,
        selectedIndex: picked.index,
        selectedRole: track.role,
        selectionReason: track.lastReason,
        switched: false,
        track,
        trackedCorners: compare,
      },
    );
  }

  const intent = intentFor(state.track, compare, picked.score);
  const nest = nestedKind(state.track.corners, compare);
  let seenInner = nest === 'raw-is-inner';
  let seenOuter = nest === 'raw-is-outer';
  for (const c of candidates) {
    const kind = nestedKind(state.track.corners, c.corners);
    if (kind === 'raw-is-inner') seenInner = true;
    if (kind === 'raw-is-outer') seenOuter = true;
  }
  const innerPresentCount = seenInner ? state.track.innerPresentCount + 1 : 0;
  const outerPresentCount = seenOuter
    ? state.track.outerPresentCount + 1
    : state.track.outerPresentCount;

  if (intent === 'keep-update' || intent === 'keep-hold' || intent === 'promote-inner') {
    let corners = compare;
    let holdReason: string | null = null;
    let lastReason =
      intent === 'promote-inner' ? 'promote to inner card' : 'continuity update';
    let geometryUpdated = true;
    if (intent === 'keep-hold') {
      if (nest === 'raw-is-outer') {
        const innerCand = candidates.find(
          c => nestedKind(c.corners, compare) === 'raw-is-inner' || containsCandidate(compare, c.corners).ok,
        );
        if (innerCand && (sameObject(measureContinuity(state.track.corners, innerCand.corners)) || metrics.iou >= CONTINUITY_SWITCH_IOU)) {
          corners = smoothCorners(state.track.corners, innerCand.corners);
          lastReason = 'hysteresis — identity hold, geometry update';
        } else if (shouldAdoptLargerRawAsFalseInner(state.track, compare, metrics, nest)) {
          corners = smoothCorners(state.track.corners, compare);
          lastReason = 'hysteresis — adopt larger raw (false inner)';
        } else {
          corners = state.track.corners;
          geometryUpdated = false;
          lastReason = 'hysteresis — keep established object';
        }
      } else if (metrics.iou >= CONTINUITY_SWITCH_IOU) {
        corners = smoothCorners(state.track.corners, compare);
        lastReason = 'hysteresis — identity hold, geometry update';
      } else if (shouldAdoptLargerRawAsFalseInner(state.track, compare, metrics, nest)) {
        corners = smoothCorners(state.track.corners, compare);
        lastReason = 'hysteresis — adopt larger raw (false inner)';
      } else {
        corners = state.track.corners;
        geometryUpdated = false;
        lastReason = 'hysteresis — keep established object';
      }
      holdReason = lastReason;
    }
    const presented = smoothCorners(state.presented, corners);
    let role = state.track.role;
    let roleAge = state.track.roleAge + 1;
    let roleSwitch = 0;
    if (intent === 'promote-inner' && role !== 'card-inner') {
      roleSwitch = 1;
      role = 'card-inner';
      roleAge = 1;
    } else if (role === 'single' && seenOuter) {
      // Track sits inside a larger sleeve candidate — we already have the card.
      role = 'card-inner';
    } else if (role === 'single' && seenInner && !seenOuter) {
      role = 'outer-container';
    }
    const track: ContinuityTrack = {
      ...state.track,
      age: state.track.age + 1,
      coast: 0,
      corners,
      holdReason,
      innerPresentCount,
      lastHitAt: now,
      lastReason,
      outerPresentCount,
      role,
      roleAge,
      roleSwitchCount: state.track.roleSwitchCount + roleSwitch,
      score: Math.max(state.track.score, picked.score, input.rawScore),
      updatedAt: geometryUpdated ? now : state.track.updatedAt,
    };
    return finish(
      {
        ...state,
        lastResetReason: null,
        pendingSwitch: 0,
        presented,
        roleSwitchCount: state.roleSwitchCount + roleSwitch,
        track,
      },
      {
        hit: true,
        metrics,
        presentedCorners: presented,
        rawCorners,
        selectedIndex: picked.index,
        selectedRole: track.role,
        selectionReason: track.lastReason,
        switched: false,
        track,
        trackedCorners: corners,
      },
    );
  }

  const pending = state.pendingSwitch + 1;
  if (pending < CONTINUITY_SWITCH_FRAMES) {
    const presented = smoothCorners(state.presented, state.track.corners);
    const track: ContinuityTrack = {
      ...state.track,
      age: state.track.age + 1,
      coast: 0,
      holdReason: `switch pending ${pending}/${CONTINUITY_SWITCH_FRAMES}`,
      lastHitAt: now,
      lastReason: `switch pending ${pending}/${CONTINUITY_SWITCH_FRAMES}`,
    };
    return finish(
      { ...state, pendingSwitch: pending, presented, track },
      {
        hit: true,
        metrics,
        presentedCorners: presented,
        rawCorners,
        selectedIndex: picked.index,
        selectedRole: track.role,
        selectionReason: track.lastReason,
        switched: false,
        track,
        trackedCorners: track.corners,
      },
    );
  }

  const newRole = inferRole(compare, rawCorners);
  const track: ContinuityTrack = {
    age: 1,
    coast: 0,
    corners: compare,
    createdAt: now,
    forceAdoptNext: false,
    holdReason: null,
    id: state.nextId,
    innerPresentCount: 0,
    lastHitAt: now,
    lastReason: 'switched after confirmed loss of previous object',
    outerPresentCount: 0,
    role: newRole,
    roleAge: 1,
    roleSwitchCount: 0,
    score: picked.score,
    updatedAt: now,
  };
  return finish(
    {
      lastResetReason: 'object switch',
      nextId: state.nextId + 1,
      pendingSwitch: 0,
      presented: compare,
      roleSwitchCount: state.roleSwitchCount + 1,
      track,
    },
    {
      hit: true,
      metrics,
      presentedCorners: compare,
      rawCorners,
      selectedIndex: picked.index,
      selectedRole: newRole,
      selectionReason: track.lastReason,
      switched: true,
      track,
      trackedCorners: compare,
    },
  );
};
