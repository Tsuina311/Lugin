// High-resolution recognition source.
//
// analysis-warp upscales detector pixels. That is a fallback, not high-res.
// True sources: snapshot (preview), photo still, or a dedicated larger frame.
//
// Do not copy full-res frames to JS on every detector tick.

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
import {
  mapCornersToHiRes,
  type HiResMapKind,
  type VisibleRect,
} from './hiresMap';

export type RecognitionSource = 'high-res-frame' | 'snapshot' | 'photo' | 'analysis-fallback';

/** Preferred capture order for a continuous scanner. Cycle on device to compare. */
export const RECOGNITION_SOURCES = ['snapshot', 'photo', 'high-res-frame'] as const;
export type PreferredSource = (typeof RECOGNITION_SOURCES)[number];

/** Long-edge cap for a hi-res copy. Enough for 744×1039; not a 12 MP dump. */
export const HIRES_MAX_LONG_EDGE = 1920;

export interface HiResSpaces {
  detector: Size2D;
  oriented: Size2D;
  overlay: Size2D;
  visible: VisibleRect;
}

export interface HiResAttempt {
  acquireMs: number;
  convertMs: number;
  mode: RecognitionSource;
  previewInterrupted: boolean;
  reason?: string;
  sourceSize: Size2D | null;
  warpMs: number;
}

export interface HiResCache {
  attempt: HiResAttempt;
  corners: CardCorners;
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

export const isTrueHiRes = (mode: RecognitionSource): boolean => mode !== 'analysis-fallback';

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

export const normalizeFromMapped = (
  source: ScanImage,
  mapped: CardCorners,
  detectionScore: number,
): PreparedCard => ({
  corners: mapped,
  detected: true,
  detection: emptyDetectionDebug(),
  image: warpQuadToCard(source, cornersToQuad(mapped)),
  score: detectionScore,
  source: 'detected',
});

export const mapAndWarp = (
  source: ScanImage,
  detectorCorners: CardCorners,
  detector: Size2D,
  kind: HiResMapKind,
  spaces: HiResSpaces,
  destMirrored: boolean,
  detectionScore: number,
): { mapped: CardCorners; prepared: PreparedCard; warpMs: number } => {
  const mapped = mapCornersToHiRes(detectorCorners, {
    dest: { height: source.height, width: source.width },
    destMirrored,
    detector,
    kind,
    oriented: spaces.oriented,
    visible: spaces.visible,
  });
  const t0 = now();
  const prepared = normalizeFromMapped(source, mapped, detectionScore);
  return { mapped, prepared, warpMs: now() - t0 };
};

export interface HiResStore {
  cache: HiResCache | null;
  inFlight: boolean;
  lastAttempt: HiResAttempt | null;
}

export const emptyHiResStore = (): HiResStore => ({
  cache: null,
  inFlight: false,
  lastAttempt: null,
});

/** Sync refine: cached hi-res only. Do not pretend analysis-warp is high-res. */
export const refineFromStore = (store: HiResStore): PreparedCard | null =>
  store.cache?.prepared ?? null;

export const putFallback = (
  store: HiResStore,
  analysis: ScanImage,
  corners: CardCorners,
  score: number,
): PreparedCard => {
  const t0 = now();
  const prepared = warpAnalysisCard(analysis, corners, score);
  const attempt: HiResAttempt = {
    acquireMs: 0,
    convertMs: 0,
    mode: 'analysis-fallback',
    previewInterrupted: false,
    sourceSize: { height: analysis.height, width: analysis.width },
    warpMs: now() - t0,
  };
  store.lastAttempt = attempt;
  store.cache = {
    attempt,
    corners,
    mapped: corners,
    prepared,
    source: analysis,
  };
  return prepared;
};
