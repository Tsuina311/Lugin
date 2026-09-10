// Lightweight card-change watch — independent of recognition budget / hi-res lock.
//
// Domain: tiny upright card from analysis/detector pixels (not 744×1039 hi-res).
// Calibrated on Samsung swap-test-20260908-171306 / 171149 warps downsampled to 32×45:
//   same Hex→Hex ~0.29
//   different min ~0.34 (Beacon→Octopus / Octopus→Deck), typical 0.38–0.70
//
// Do NOT reuse CARD_SESSION_SAME_MAX / DIFF_MIN (those are hi-res warp thresholds).

import {
  blockDistance,
  blockMeanHash,
  differenceHash,
  hamming64,
  resizeArt,
} from '../artwork/descriptors';
import { cornersToQuad, warpQuadToCard } from '../geometry';
import type { CardCorners, ScanImage } from '../types';

/** Tiny upright card used for change watch (cheap warp). */
export const CHANGE_WATCH_WIDTH = 32;
export const CHANGE_WATCH_HEIGHT = 45;

/**
 * Calibrated for hist16 + dHash + block on 32×45 (analysis-domain proxy).
 * Overlap remains: different-card can land ~0.34. Treat mid band as suspicion.
 */
export const CHANGE_WATCH_SAME_MAX = 0.31;
export const CHANGE_WATCH_DIFF_MIN = 0.42;
export const CHANGE_WATCH_VISUAL_CONFIRM = 2;
/** Min interval between probes while a session is active (~4 Hz). */
export const CHANGE_WATCH_INTERVAL_MS = 250;

export type CardChangeState =
  | 'idle'
  | 'same'
  | 'suspect'
  | 'confirming'
  | 'identity-probe'
  | 'changed';

export type CardChangeEvidence =
  | 'none'
  | 'visual'
  | 'identity'
  | 'occlusion'
  | 'manual'
  | 'combination';

export type ChangeBand = 'same' | 'uncertain' | 'changed';

export interface ChangeFingerprint {
  block: [number, number, number, number];
  dhash: [number, number];
  hist: number[];
}

export interface CardChangeWatchSnapshot {
  baselineFingerprint: ChangeFingerprint | null;
  cardChangeState: CardChangeState;
  changeEvidence: CardChangeEvidence;
  consecutiveChangeCount: number;
  currentFingerprint: ChangeFingerprint | null;
  lastProbeAt: number | null;
  probeResult: string | null;
  swapSuspicion: number;
  visualBand: ChangeBand;
  visualDelta: number | null;
}

export interface CardChangeWatchState extends CardChangeWatchSnapshot {
  lastTickAt: number | null;
  probesUsedThisSession: number;
  /** Frames of strong visual-change toward reset. */
  pendingStrong: number;
  /** Accumulated occlusion / miss evidence 0..1. */
  occlusionScore: number;
}

export const emptyCardChangeWatch = (): CardChangeWatchState => ({
  baselineFingerprint: null,
  cardChangeState: 'idle',
  changeEvidence: 'none',
  consecutiveChangeCount: 0,
  currentFingerprint: null,
  lastProbeAt: null,
  lastTickAt: null,
  occlusionScore: 0,
  pendingStrong: 0,
  probeResult: null,
  probesUsedThisSession: 0,
  swapSuspicion: 0,
  visualBand: 'same',
  visualDelta: null,
});

export const classifyChangeDistance = (distance: number): ChangeBand => {
  if (distance < CHANGE_WATCH_SAME_MAX) return 'same';
  if (distance >= CHANGE_WATCH_DIFF_MIN) return 'changed';
  return 'uncertain';
};

export const changeFingerprintFromTinyCard = (tiny: ScanImage): ChangeFingerprint => {
  const hist = new Array(16).fill(0) as number[];
  let n = 0;
  for (let i = 0; i < tiny.data.length; i += 4) {
    const y = 0.299 * tiny.data[i] + 0.587 * tiny.data[i + 1] + 0.114 * tiny.data[i + 2];
    hist[Math.min(15, (y / 16) | 0)] += 1;
    n += 1;
  }
  if (n > 0) {
    for (let i = 0; i < 16; i++) hist[i] /= n;
  }
  const { gray } = resizeArt(tiny, 32);
  return {
    block: blockMeanHash(gray),
    dhash: differenceHash(gray),
    hist,
  };
};

/** Warp analysis/detector frame corners to a tiny upright card, then fingerprint. */
export const changeFingerprintFromAnalysis = (
  frame: ScanImage,
  corners: CardCorners,
): { fingerprint: ChangeFingerprint; tiny: ScanImage } => {
  const tiny = warpQuadToCard(
    frame,
    cornersToQuad(corners),
    CHANGE_WATCH_WIDTH,
    CHANGE_WATCH_HEIGHT,
  );
  return { fingerprint: changeFingerprintFromTinyCard(tiny), tiny };
};

/** Also works on already-warped cards (host tests / swap PNGs). */
export const changeFingerprintFromWarpedCard = (warp: ScanImage): ChangeFingerprint => {
  const scaled = {
    data: new Uint8ClampedArray(CHANGE_WATCH_WIDTH * CHANGE_WATCH_HEIGHT * 4),
    height: CHANGE_WATCH_HEIGHT,
    width: CHANGE_WATCH_WIDTH,
  };
  for (let y = 0; y < CHANGE_WATCH_HEIGHT; y++) {
    const sy = Math.min(warp.height - 1, Math.floor(((y + 0.5) * warp.height) / CHANGE_WATCH_HEIGHT));
    for (let x = 0; x < CHANGE_WATCH_WIDTH; x++) {
      const sx = Math.min(warp.width - 1, Math.floor(((x + 0.5) * warp.width) / CHANGE_WATCH_WIDTH));
      const si = (sy * warp.width + sx) * 4;
      const di = (y * CHANGE_WATCH_WIDTH + x) * 4;
      scaled.data[di] = warp.data[si];
      scaled.data[di + 1] = warp.data[si + 1];
      scaled.data[di + 2] = warp.data[si + 2];
      scaled.data[di + 3] = 255;
    }
  }
  return changeFingerprintFromTinyCard(scaled);
};

export const changeFingerprintDistance = (
  a: ChangeFingerprint,
  b: ChangeFingerprint,
): number => {
  let l1 = 0;
  for (let i = 0; i < 16; i++) l1 += Math.abs((a.hist[i] ?? 0) - (b.hist[i] ?? 0));
  const ham = hamming64(a.dhash, b.dhash) / 64;
  const blk = Math.min(1, blockDistance(a.block, b.block) / (16 * 8));
  return Math.max(0, Math.min(1, 0.45 * l1 + 0.35 * ham + 0.2 * blk));
};

export type CardChangeTickInput = {
  corners: CardCorners | null;
  detectorMiss: boolean;
  /** Large corner motion this frame (fraction of diagonal). */
  geometryDelta: number;
  frame: ScanImage | null;
  now: number;
  sessionActive: boolean;
  state: CardChangeWatchState;
};

export type CardChangeTickResult = {
  /** Begin a new card session now (visual confirmation). */
  beginSession: boolean;
  /** Kick one identity probe (independent of exhausted recognize budget). */
  requestIdentityProbe: boolean;
  /** Old published identity should be treated as possibly stale. */
  resultPossiblyStale: boolean;
  state: CardChangeWatchState;
};

/**
 * Tick the change watch from cheap analysis pixels.
 * Does not OCR. Does not require hi-res. Does not require a new session first.
 */
export const tickCardChangeWatch = (input: CardChangeTickInput): CardChangeTickResult => {
  let state = { ...input.state };
  if (!input.sessionActive) {
    return {
      beginSession: false,
      requestIdentityProbe: false,
      resultPossiblyStale: false,
      state: emptyCardChangeWatch(),
    };
  }

  // Occlusion / swap-motion suspicion (never resets alone).
  if (input.detectorMiss) {
    state = {
      ...state,
      occlusionScore: Math.min(1, state.occlusionScore + 0.25),
      swapSuspicion: Math.min(1, state.swapSuspicion + 0.2),
    };
  } else {
    state = {
      ...state,
      occlusionScore: Math.max(0, state.occlusionScore - 0.05),
    };
  }
  if (input.geometryDelta > 0.08) {
    state = { ...state, swapSuspicion: Math.min(1, state.swapSuspicion + 0.15) };
  }

  if (!input.frame || !input.corners) {
    return {
      beginSession: false,
      requestIdentityProbe: false,
      resultPossiblyStale: state.cardChangeState === 'suspect' || state.cardChangeState === 'confirming',
      state,
    };
  }

  if (state.lastTickAt != null && input.now - state.lastTickAt < CHANGE_WATCH_INTERVAL_MS) {
    return {
      beginSession: false,
      requestIdentityProbe: false,
      resultPossiblyStale: state.cardChangeState === 'suspect' || state.cardChangeState === 'confirming',
      state,
    };
  }

  const { fingerprint } = changeFingerprintFromAnalysis(input.frame, input.corners);
  state = { ...state, currentFingerprint: fingerprint, lastTickAt: input.now };

  if (!state.baselineFingerprint) {
    return {
      beginSession: false,
      requestIdentityProbe: false,
      resultPossiblyStale: false,
      state: {
        ...state,
        baselineFingerprint: fingerprint,
        cardChangeState: 'same',
        changeEvidence: 'none',
        consecutiveChangeCount: 0,
        pendingStrong: 0,
        visualBand: 'same',
        visualDelta: 0,
      },
    };
  }

  const delta = changeFingerprintDistance(state.baselineFingerprint, fingerprint);
  const band = classifyChangeDistance(delta);
  state = { ...state, visualBand: band, visualDelta: delta };

  if (band === 'same') {
    // Slow baseline refresh for small same-card variation only.
    const refresh =
      delta < CHANGE_WATCH_SAME_MAX * 0.7
        ? fingerprint
        : state.baselineFingerprint;
    return {
      beginSession: false,
      requestIdentityProbe: false,
      resultPossiblyStale: false,
      state: {
        ...state,
        baselineFingerprint: refresh,
        cardChangeState: 'same',
        changeEvidence: 'none',
        consecutiveChangeCount: 0,
        pendingStrong: 0,
        swapSuspicion: Math.max(0, state.swapSuspicion - 0.1),
      },
    };
  }

  // uncertain or changed — do NOT absorb into baseline
  const pending = state.pendingStrong + (band === 'changed' ? 1 : 0);
  const uncertainStreak = band === 'uncertain' ? state.consecutiveChangeCount + 1 : state.consecutiveChangeCount;
  const consecutive =
    band === 'changed' ? pending : uncertainStreak > 0 ? uncertainStreak : state.consecutiveChangeCount + 1;

  let evidence: CardChangeEvidence = band === 'changed' ? 'visual' : 'visual';
  if (state.occlusionScore >= 0.5 || state.swapSuspicion >= 0.45) {
    evidence = 'combination';
  }

  const strongConfirmed = band === 'changed' && pending >= CHANGE_WATCH_VISUAL_CONFIRM;
  const uncertainNeedsProbe =
    band === 'uncertain' &&
    consecutive >= 2 &&
    state.probesUsedThisSession < 1 &&
    state.cardChangeState !== 'identity-probe';

  if (strongConfirmed) {
    return {
      beginSession: true,
      requestIdentityProbe: false,
      resultPossiblyStale: true,
      state: {
        ...state,
        cardChangeState: 'changed',
        changeEvidence: evidence,
        consecutiveChangeCount: pending,
        pendingStrong: pending,
      },
    };
  }

  const nextState: CardChangeState =
    band === 'changed' ? 'confirming' : consecutive >= 1 ? 'suspect' : 'suspect';

  return {
    beginSession: false,
    requestIdentityProbe: uncertainNeedsProbe || (band === 'changed' && pending === 1 && state.probesUsedThisSession < 1),
    resultPossiblyStale: true,
    state: {
      ...state,
      cardChangeState: nextState,
      changeEvidence: evidence,
      consecutiveChangeCount: consecutive,
      pendingStrong: band === 'changed' ? pending : state.pendingStrong,
    },
  };
};

/** Seed / replace baseline when a new card session begins. */
export const seedCardChangeWatch = (
  fingerprint: ChangeFingerprint | null,
): CardChangeWatchState => ({
  ...emptyCardChangeWatch(),
  baselineFingerprint: fingerprint,
  cardChangeState: fingerprint ? 'same' : 'idle',
  visualBand: 'same',
  visualDelta: fingerprint ? 0 : null,
});

export const noteChangeWatchProbe = (
  state: CardChangeWatchState,
  now: number,
  result: string | null,
): CardChangeWatchState => ({
  ...state,
  cardChangeState: 'identity-probe',
  lastProbeAt: now,
  probeResult: result,
  probesUsedThisSession: state.probesUsedThisSession + 1,
});

export const snapshotCardChangeWatch = (state: CardChangeWatchState): CardChangeWatchSnapshot => ({
  baselineFingerprint: state.baselineFingerprint,
  cardChangeState: state.cardChangeState,
  changeEvidence: state.changeEvidence,
  consecutiveChangeCount: state.consecutiveChangeCount,
  currentFingerprint: state.currentFingerprint,
  lastProbeAt: state.lastProbeAt,
  probeResult: state.probeResult,
  swapSuspicion: state.swapSuspicion,
  visualBand: state.visualBand,
  visualDelta: state.visualDelta,
});
