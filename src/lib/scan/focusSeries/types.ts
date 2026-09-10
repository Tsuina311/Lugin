import type { CardDensity, CaptureSideMetrics, CaptureSideOcr, MotionSample } from '../captureQuality/types';
import type { CardCorners } from '../types';

export const FOCUS_SERIES_OFFSETS_MS = [0, 250, 500, 800] as const;

export type FocusSeriesNominalMs = (typeof FOCUS_SERIES_OFFSETS_MS)[number];

export const focusSeriesFilePrefix = (nominalMs: number): string =>
  `t${String(Math.round(nominalMs)).padStart(3, '0')}`;

export type FocusFailureClass =
  | 'OK'
  | 'SOURCE_BAD'
  | 'WARP_BAD'
  | 'TITLE_REGION_BAD'
  | 'OCR_BAD';

export type FocusQuadMode = 'per-snapshot' | 'legacy-frozen';

export type FocusQuadLatch = 'live' | 'last-valid';

export interface FocusSeriesGeometry {
  centerDeltaVsT0: number;
  cornerDeltaVsT0: number;
  iouVsT0: number;
}

export interface FocusSeriesSample {
  actualDelayFromFocusRequestMs: number;
  cardContrast: number;
  density: CardDensity;
  failureClass: FocusFailureClass | null;
  geometry: FocusSeriesGeometry | null;
  metrics: CaptureSideMetrics;
  motion: MotionSample | null;
  nominalDelayMs: FocusSeriesNominalMs;
  ocr: CaptureSideOcr;
  quad: CardCorners;
  quadAgeAtCaptureMs: number | null;
  quadLatchedFrom: FocusQuadLatch;
  quadTimestamp: number | null;
  recognitionQuadSource: string | null;
  recognitionQuadValid: boolean | null;
  sourceCardContrast: number | null;
  sourceCardSharpness: number | null;
  sourceContrast: number;
  sourceHeight: number;
  sourceSharpness: number;
  sourceWidth: number;
  trackId: number | null;
}

export interface FocusSeriesBundle {
  capturedAt: string;
  fixtureId: string;
  focusAttemptId: number | null;
  focusRequestedAt: number | null;
  focusTrackId: number | null;
  currentTrackId: number | null;
  sameTrackFocus: boolean;
  label: string;
  /** Absent on v1 bundles that reused one frozen quad. */
  quadMode?: FocusQuadMode;
  samples: FocusSeriesSample[];
  tags: {
    borderStyle: string | null;
    foil: boolean | null;
    glare: 'low' | 'medium' | 'high' | null;
    language: string | null;
    sleeved: boolean | null;
  };
  trackChangedDuringSeries?: boolean;
}
