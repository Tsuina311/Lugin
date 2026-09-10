// Capture-quality A/B types. Does not change live recognition.

import type { CardCorners } from '../types';

export const FAST_SNAPSHOT_LABEL = 'fast-snapshot';
export const PHOTO_LABEL = 'photo';
export const VIDEO_FRAME_LABEL = 'video-frame';
export const ANALYSIS_FALLBACK_LABEL = 'analysis-fallback';

export type CaptureSourceLabel =
  | typeof FAST_SNAPSHOT_LABEL
  | typeof PHOTO_LABEL
  | typeof VIDEO_FRAME_LABEL
  | typeof ANALYSIS_FALLBACK_LABEL;

export type MotionClass = 'stationary' | 'minor-motion' | 'moving';

export type CaptureQualityKind = 'good-capture' | 'bad-capture';

export interface CardDensity {
  cardAreaPx: number;
  cardBoundingHeightPx: number;
  cardBoundingWidthPx: number;
  sourceHeight: number;
  sourceWidth: number;
  warpHeight: number;
  warpUpscaleX: number;
  warpUpscaleY: number;
  warpWidth: number;
}

export interface CaptureSideMetrics {
  cardGlare: number;
  cardSharpness: number;
  titleContrast: number;
  titleGlare: number;
  titleSharpness: number;
}

export interface MotionSample {
  areaChange: number;
  centerDeltaPx: number;
  classification: MotionClass;
  rotationDeg: number;
}

export interface FocusAtCapture {
  currentTrackId?: number | null;
  focusAgeMs: number | null;
  focusAttemptId?: number | null;
  focusPoint: { x: number; y: number } | null;
  focusRequested: boolean;
  focusRequestedAt?: number | null;
  focusResolvedAt?: number | null;
  focusSucceeded: boolean;
  focusTimedOut: boolean;
  focusTimedOutAt?: number | null;
  focusTrackId?: number | null;
  sameTrackFocus?: boolean;
  timeSinceFocusRequestMs: number | null;
}

export interface CaptureSideOcr {
  decision: string;
  firstPassExact: boolean;
  matchName: string | null;
  matchScore: number | null;
  ocrText: string;
  ocrVariantCount: number;
  rawOcrFirst: string;
  reason: string;
  recognitionMs: number;
  status: string;
}

export interface CaptureSideTimings {
  captureRequestToSourceReadyMs: number;
  convertMs: number;
  fallbackOcrMs: number;
  firstOcrMs: number;
  lookupMs: number;
  sourceReadyToIdentityMs: number;
  totalCaptureToIdentityMs: number;
  warpMs: number;
}

export interface CaptureSideRecord {
  decodedHeight: number;
  decodedWidth: number;
  density: CardDensity;
  label: CaptureSourceLabel;
  metrics: CaptureSideMetrics;
  nativeHeight: number | null;
  nativeWidth: number | null;
  ocr: CaptureSideOcr;
  quad: CardCorners;
  timings: CaptureSideTimings;
}

export interface CaptureQualityBundle {
  capturedAt: string;
  fixtureId: string;
  focus: FocusAtCapture;
  gapAbMs: number;
  label: string;
  lockToCaptureStartMs: number | null;
  motion: MotionSample | null;
  photo: CaptureSideRecord;
  snapshot: CaptureSideRecord;
  tags: {
    borderStyle: string | null;
    foil: boolean | null;
    glare: 'low' | 'medium' | 'high' | null;
    language: string | null;
    sleeved: boolean | null;
  };
}

export const firstPassExactFromVariants = (
  variants: readonly { topScore?: number | null }[],
  titleOnlyMin: number,
): boolean => Boolean(variants[0] && (variants[0].topScore ?? 0) >= titleOnlyMin);
