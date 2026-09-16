// Physical card session fingerprint — change detection, not identification.
// Reuses artwork dHash/block/hue; adds a coarse full-card structure hash.
// Calibrated on Samsung focus-series warps (2026-09-08).

import {
  blockDistance,
  blockMeanHash,
  describeArtwork,
  descriptorSimilarity,
  differenceHash,
  hamming64,
  resizeArt,
  type ArtworkDescriptor,
} from '../artwork/descriptors';
import { profileForCard } from '../regions';
import { cropImage, type ScanImage } from '../types';

/**
 * Combo distance distributions (focus-series 744×1039 warps):
 *   same-card:  min 0.07  p50 0.20  p90 0.26  max 0.37
 *   different:  min 0.32  p50 0.32  max 0.41
 * Threshold 0.38 sits above measured same-card max; require 2 confirms.
 */
export const CARD_SESSION_SAME_MAX = 0.3;
export const CARD_SESSION_DIFF_MIN = 0.38;
export const CARD_SESSION_VISUAL_CONFIRM = 2;

export type CardVisualClass = 'same' | 'changed' | 'uncertain';

export type CardSessionResetReason =
  | 'initial'
  | 'manual'
  | 'manual-swap-test'
  | 'card-gone'
  | 'visual-change'
  | 'identity-change'
  | 'scan-again'
  | 'result-dismissed'
  | 'debug-focus-series'
  | 'verified-next'
  | 'verified-retake'
  | 'verified-add-next';

export interface CardFingerprint {
  art: ArtworkDescriptor;
  fullBlock: [number, number, number, number];
  fullDhash: [number, number];
}

export const cardFingerprintFromWarp = (warp: ScanImage): CardFingerprint => {
  const profile = profileForCard(warp.width, warp.height);
  const art = describeArtwork(cropImage(warp, profile.artwork));
  const { gray } = resizeArt(warp, 32);
  return {
    art,
    fullBlock: blockMeanHash(gray),
    fullDhash: differenceHash(gray),
  };
};

/** 0 = identical, 1 = maximally different. */
export const cardFingerprintDistance = (a: CardFingerprint, b: CardFingerprint): number => {
  const artSim = descriptorSimilarity(a.art, b.art);
  const fullHam = hamming64(a.fullDhash, b.fullDhash);
  const fullBlock = blockDistance(a.fullBlock, b.fullBlock);
  const fullSim = 0.6 * (1 - fullHam / 64) + 0.4 * (1 - Math.min(1, fullBlock / (16 * 8)));
  const combo = 0.65 * artSim + 0.35 * fullSim;
  return Math.max(0, Math.min(1, 1 - combo));
};

export const classifyFingerprintDistance = (distance: number): CardVisualClass => {
  if (distance < CARD_SESSION_SAME_MAX) return 'same';
  if (distance >= CARD_SESSION_DIFF_MIN) return 'changed';
  return 'uncertain';
};

export interface CardSessionVisualState {
  fingerprint: CardFingerprint | null;
  fingerprintDelta: number | null;
  pendingVisualChanges: number;
  visualChange: CardVisualClass;
}

export const emptyCardSessionVisual = (): CardSessionVisualState => ({
  fingerprint: null,
  fingerprintDelta: null,
  pendingVisualChanges: 0,
  visualChange: 'same',
});

/**
 * Observe a hi-res warp against the current session fingerprint.
 * Returns whether a new card session should begin (visual-change confirmed).
 */
export const observeCardFingerprint = (
  state: CardSessionVisualState,
  warp: ScanImage,
  opts: { allowReset: boolean },
): { reset: boolean; state: CardSessionVisualState } => {
  const next = cardFingerprintFromWarp(warp);
  if (!state.fingerprint) {
    return {
      reset: false,
      state: {
        fingerprint: next,
        fingerprintDelta: 0,
        pendingVisualChanges: 0,
        visualChange: 'same',
      },
    };
  }
  const distance = cardFingerprintDistance(state.fingerprint, next);
  const visualChange = classifyFingerprintDistance(distance);
  if (visualChange === 'same') {
    return {
      reset: false,
      state: {
        fingerprint: next,
        fingerprintDelta: distance,
        pendingVisualChanges: 0,
        visualChange,
      },
    };
  }
  if (visualChange === 'uncertain' || !opts.allowReset) {
    return {
      reset: false,
      state: {
        ...state,
        fingerprintDelta: distance,
        pendingVisualChanges: visualChange === 'changed' ? state.pendingVisualChanges : 0,
        visualChange,
      },
    };
  }
  const pending = state.pendingVisualChanges + 1;
  if (pending >= CARD_SESSION_VISUAL_CONFIRM) {
    return {
      reset: true,
      state: {
        fingerprint: next,
        fingerprintDelta: distance,
        pendingVisualChanges: 0,
        visualChange: 'changed',
      },
    };
  }
  return {
    reset: false,
    state: {
      ...state,
      fingerprintDelta: distance,
      pendingVisualChanges: pending,
      visualChange: 'changed',
    },
  };
};
