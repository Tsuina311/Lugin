// High-resolution recognition source.
//
// Detection stays small. Recognition needs a sharper crop. Three native
// mechanisms exist; this module implements the architecture for all three
// and defaults to warping the last analysis frame until Samsung measures
// photo / snapshot / higher-res frame output.
//
// Do not assume photo is best. Do not copy full-res frames to JS every
// analysis tick.

import {
  CARD_HEIGHT,
  CARD_WIDTH,
  cornersToQuad,
  emptyDetectionDebug,
  warpQuadToCard,
  type CardCorners,
  type PreparedCard,
  type ScanImage,
  type Size2D,
} from './sharedCore';
import { mapCornersSameFov, mapCornersToOrientedSource, type VisibleRect } from './hiresMap';

export type HiResMode = 'analysis-warp' | 'photo' | 'snapshot' | 'hires-frame';

export interface HiResSpaces {
  detector: Size2D;
  hires: Size2D;
  oriented: Size2D;
  visible: VisibleRect;
}

export interface HiResAttempt {
  /** Wall-clock ms from request to PreparedCard (or failure). */
  latencyMs: number;
  mode: HiResMode;
  previewInterrupted: boolean;
  reason?: string;
  sourceSize: Size2D | null;
}

export interface HiResCache {
  attempt: HiResAttempt;
  corners: CardCorners;
  /** Detector quad mapped onto the hi-res raster (before warp). */
  mapped: CardCorners;
  prepared: PreparedCard;
  source: ScanImage;
}

const now = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

export const isCanonicalCard = (image: ScanImage): boolean =>
  image.width === CARD_WIDTH && image.height === CARD_HEIGHT;

/** Warp the analysis raster. Always available; sharpness is analysis-limited. */
export const warpAnalysisCard = (
  analysis: ScanImage,
  corners: CardCorners,
  detectionScore: number,
): PreparedCard => ({
  corners,
  detected: true,
  detection: emptyDetectionDebug(),
  image: warpQuadToCard(analysis, cornersToQuad(corners)),
  score: detectionScore,
  source: 'detected',
});

/**
 * Map detector corners onto a hi-res raster and warp to 744×1039.
 *
 * `sameFov` when the hi-res image is already the preview-visible crop.
 */
export const normalizeFromHiRes = (
  source: ScanImage,
  detectorCorners: CardCorners,
  spaces: HiResSpaces,
  sameFov: boolean,
  detectionScore: number,
): { mapped: CardCorners; prepared: PreparedCard } => {
  const mapped = sameFov
    ? mapCornersSameFov(detectorCorners, spaces.detector, spaces.hires)
    : mapCornersToOrientedSource(
        detectorCorners,
        spaces.detector,
        spaces.visible,
        spaces.oriented,
        spaces.hires,
      );
  return {
    mapped,
    prepared: {
      corners: mapped,
      detected: true,
      detection: emptyDetectionDebug(),
      image: warpQuadToCard(source, cornersToQuad(mapped)),
      score: detectionScore,
      source: 'detected',
    },
  };
};

export interface HiResStore {
  cache: HiResCache | null;
  lastAttempt: HiResAttempt | null;
}

export const emptyHiResStore = (): HiResStore => ({ cache: null, lastAttempt: null });

/**
 * Synchronous refineCard: return the last completed hi-res crop when the
 * detector quad still matches, otherwise warp the current analysis frame.
 *
 * Photo / snapshot capture is async and must not run inside SessionController.
 */
export const refineFromStore = (
  store: HiResStore,
  analysis: ScanImage | null,
  corners: CardCorners,
  score: number,
): PreparedCard | null => {
  if (store.cache) {
    return store.cache.prepared;
  }
  if (!analysis) return null;
  const t0 = now();
  const prepared = {
    corners,
    detected: true,
    detection: emptyDetectionDebug(),
    image: warpQuadToCard(analysis, cornersToQuad(corners)),
    score,
    source: 'detected' as const,
  };
  store.lastAttempt = {
    latencyMs: now() - t0,
    mode: 'analysis-warp',
    previewInterrupted: false,
    sourceSize: { height: analysis.height, width: analysis.width },
  };
  return prepared;
};
