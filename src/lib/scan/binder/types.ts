/**
 * Binder Mode V0 — multi-card tracks + identification-ready capture.
 * Recognition / collection mutation are intentionally out of scope.
 */

import type { CardCorners, ScanImage } from '../types';

export type BinderTrackPhase =
  | 'detected'
  | 'tracking'
  | 'capture_ready'
  | 'acquired'
  | 'lost';

export type BinderQualityComponents = {
  captureSafe: number;
  geometry: number;
  glare: number;
  sharpness: number;
  size: number;
};

export type BinderQualityScore = {
  /** 0..1 — IDENTIFICATION_READY when score >= threshold and gates pass. */
  score: number;
  components: BinderQualityComponents;
  reasons: string[];
  identificationReady: boolean;
};

export type BinderBestCapture = {
  captureId: number;
  sourceFrameId: number;
  quad: CardCorners;
  /** Canonical 744×1039 warp — kept in memory; PNG encode is deferred. */
  warp: ScanImage;
  quality: BinderQualityScore;
  sharpness: number;
  capturedAt: number;
};

/** Diagnostics-only quality evolution (no images). */
export type BinderQualityHistoryEntry = {
  timestamp: number;
  sourceFrameId: number;
  captureId: number;
  qualityScore: number;
  sharpness: number;
  glare: number;
  geometryScore: number;
  becameBest: boolean;
  becameReady: boolean;
};

export type BinderTrack = {
  binderTrackId: number;
  phase: BinderTrackPhase;
  currentQuad: CardCorners;
  lastSeenAt: number;
  ageFrames: number;
  missFrames: number;
  confidence: number;
  gridSlot: number | null;
  best: BinderBestCapture | null;
  acquired: boolean;
  /** Diagnostics only — first observation wall/mono time. */
  firstSeenAt?: number | null;
  /** Diagnostics only — when identificationReady first became true. */
  identificationReadyAt?: number | null;
  /** Diagnostics only — significant best-candidate updates (no images). */
  qualityHistory?: BinderQualityHistoryEntry[];
};

export type BinderPageSession = {
  pageId: string;
  pageIndex: number;
  startedAt: number;
  tracks: BinderTrack[];
  nextTrackId: number;
  nextCaptureId: number;
  nextSourceFrameId: number;
  lastPageSnapshotAt: number | null;
  gridRows: number;
  gridCols: number;
};

export type BinderOverlayCard = {
  binderTrackId: number;
  quad: CardCorners;
  phase: BinderTrackPhase;
  acquired: boolean;
  qualityScore: number | null;
  gridSlot: number | null;
};

export type BinderPageHud = {
  acquiredCount: number;
  trackedCount: number;
  expectedSlots: number;
  hint: string;
  pageReady: boolean;
};

export const BINDER_IDENTIFICATION_READY_MIN = 0.55;
export const BINDER_SHARPNESS_SOFT = 80;
export const BINDER_SHARPNESS_GOOD = 200;
export const BINDER_TRACK_IOU_MATCH = 0.28;
export const BINDER_TRACK_CENTER_MATCH_NORM = 0.12;
export const BINDER_TRACK_LOST_FRAMES = 18;
export const BINDER_PAGE_SNAPSHOT_MIN_MS = 450;
export const BINDER_GRID_ROWS = 3;
export const BINDER_GRID_COLS = 3;

export const qualityHistoryEntry = (args: {
  timestamp: number;
  capture: BinderBestCapture;
  becameBest: boolean;
  becameReady: boolean;
}): BinderQualityHistoryEntry => ({
  timestamp: args.timestamp,
  sourceFrameId: args.capture.sourceFrameId,
  captureId: args.capture.captureId,
  qualityScore: args.capture.quality.score,
  sharpness: args.capture.sharpness,
  glare: args.capture.quality.components.glare,
  geometryScore: args.capture.quality.components.geometry,
  becameBest: args.becameBest,
  becameReady: args.becameReady,
});

export const emptyBinderPageSession = (
  pageIndex = 0,
  now = performance.now(),
): BinderPageSession => ({
  pageId: `binder-page-${pageIndex}-${Math.round(now)}`,
  pageIndex,
  startedAt: now,
  tracks: [],
  nextTrackId: 1,
  nextCaptureId: 1,
  nextSourceFrameId: 1,
  lastPageSnapshotAt: null,
  gridRows: BINDER_GRID_ROWS,
  gridCols: BINDER_GRID_COLS,
});
