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

/**
 * How long SessionController may wait for a true hi-res source before allowing
 * labeled analysis-fallback recognition.
 */
export const HIRES_WAIT_MS = 800;

export type HiResPhase =
  | 'idle'
  | 'requested'
  | 'capturing'
  | 'converting'
  | 'ready'
  | 'failed'
  | 'timed-out';

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

export interface HiResSourceStats {
  failure: number;
  lastError: string | null;
  lastCompletedAt: number | null;
  lastDimensions: Size2D | null;
  lastRequestedAt: number | null;
  requested: number;
  started: number;
  success: number;
  timeout: number;
}

export interface HiResCache {
  attempt: HiResAttempt;
  corners: CardCorners;
  mapped: CardCorners;
  prepared: PreparedCard;
  source: ScanImage;
}

export interface HiResStore {
  cache: HiResCache | null;
  inFlight: boolean;
  lastAttempt: HiResAttempt | null;
  phase: HiResPhase;
  /** Wall clock when the current card's hi-res wait began. */
  waitStartedAt: number | null;
  stats: Record<'snapshot' | 'photo' | 'high-res-frame' | 'analysis-fallback', HiResSourceStats>;
}

const emptyStats = (): HiResSourceStats => ({
  failure: 0,
  lastCompletedAt: null,
  lastDimensions: null,
  lastError: null,
  lastRequestedAt: null,
  requested: 0,
  started: 0,
  success: 0,
  timeout: 0,
});

export const emptyHiResStore = (): HiResStore => ({
  cache: null,
  inFlight: false,
  lastAttempt: null,
  phase: 'idle',
  waitStartedAt: null,
  stats: {
    'analysis-fallback': emptyStats(),
    'high-res-frame': emptyStats(),
    photo: emptyStats(),
    snapshot: emptyStats(),
  },
});

const now = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

export const isCanonicalCard = (image: ScanImage): boolean =>
  image.width === CARD_WIDTH && image.height === CARD_HEIGHT;

export const isTrueHiRes = (mode: RecognitionSource): boolean => mode !== 'analysis-fallback';

export const markSourceRequest = (
  store: HiResStore,
  mode: 'snapshot' | 'photo' | 'high-res-frame',
): void => {
  const s = store.stats[mode];
  s.requested += 1;
  s.lastRequestedAt = Date.now();
  store.phase = 'requested';
};

export const markSourceStarted = (
  store: HiResStore,
  mode: 'snapshot' | 'photo' | 'high-res-frame',
): void => {
  store.stats[mode].started += 1;
  store.phase = 'capturing';
};

export const markSourceSuccess = (
  store: HiResStore,
  mode: 'snapshot' | 'photo' | 'high-res-frame',
  size: Size2D,
): void => {
  const s = store.stats[mode];
  s.success += 1;
  s.lastCompletedAt = Date.now();
  s.lastDimensions = size;
  s.lastError = null;
  store.phase = 'ready';
};

export const markSourceFailure = (
  store: HiResStore,
  mode: 'snapshot' | 'photo' | 'high-res-frame',
  error: string,
  timedOut = false,
): void => {
  const s = store.stats[mode];
  s.failure += 1;
  if (timedOut) s.timeout += 1;
  s.lastCompletedAt = Date.now();
  s.lastError = error;
  store.phase = timedOut ? 'timed-out' : 'failed';
};

/**
 * Whether recognition may proceed.
 * - In-flight capture → wait
 * - True hi-res ready → yes
 * - Within HIRES_WAIT_MS of wait start without a result → wait
 * - After timeout / failed attempt recorded → allow fallback
 */
export const canRecognizeFromStore = (store: HiResStore, waitMs = HIRES_WAIT_MS): boolean => {
  if (store.inFlight) return false;
  if (store.cache && isTrueHiRes(store.cache.attempt.mode)) return true;
  if (store.cache && store.cache.attempt.mode === 'analysis-fallback') return true;
  if (store.waitStartedAt == null) return false;
  return Date.now() - store.waitStartedAt >= waitMs;
};

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

/** Sync refine: cached hi-res only. Do not pretend analysis-warp is high-res. */
export const refineFromStore = (store: HiResStore): PreparedCard | null => {
  if (!store.cache) return null;
  if (!isTrueHiRes(store.cache.attempt.mode)) return null;
  return store.cache.prepared;
};

export const putFallback = (
  store: HiResStore,
  analysis: ScanImage,
  corners: CardCorners,
  score: number,
  reason?: string,
): PreparedCard => {
  const t0 = now();
  const prepared = warpAnalysisCard(analysis, corners, score);
  const attempt: HiResAttempt = {
    acquireMs: 0,
    convertMs: 0,
    mode: 'analysis-fallback',
    previewInterrupted: false,
    reason,
    sourceSize: { height: analysis.height, width: analysis.width },
    warpMs: now() - t0,
  };
  const s = store.stats['analysis-fallback'];
  s.requested += 1;
  s.started += 1;
  s.success += 1;
  s.lastCompletedAt = Date.now();
  s.lastDimensions = attempt.sourceSize;
  s.lastError = reason ?? null;
  store.lastAttempt = attempt;
  store.phase = 'failed';
  store.cache = {
    attempt,
    corners,
    mapped: corners,
    prepared,
    source: analysis,
  };
  return prepared;
};
