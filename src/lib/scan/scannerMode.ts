/**
 * Exclusive scanner execution / presentation owner.
 *
 * Pipeline (detector / SessionController / recognition) is separate from
 * which consumer may present results or trigger collection side effects.
 */

import { isGeometryV2Pipeline } from './singleCardCapture/pipelineFlag';

export type ScannerMode =
  | 'normal'
  | 'binder'
  | 'deck-benchmark'
  | 'binder-benchmark'
  | 'card-swap-test'
  | 'scanner-lab'
  | 'focus-series'
  | 'geometry-test';

/** Product Binder mode (and legacy binder-benchmark alias). */
export const isBinderMode = (mode: ScannerMode): boolean =>
  mode === 'binder' || mode === 'binder-benchmark';

/** Modes that exclusively own the scanner UI (block other tools). */
export const isExclusiveScannerOwner = (mode: ScannerMode): boolean => mode !== 'normal';

/** Normal Add to Collection / ScanResultCard presentation. */
export const allowsNormalResultPresentation = (mode: ScannerMode): boolean => mode === 'normal';

export const allowsNormalCollectionActions = (mode: ScannerMode): boolean => mode === 'normal';

/**
 * Deck Benchmark observes the live production recognition path.
 * Binder / Lab / Focus Series / Geometry Test do not run the normal recognize consumer.
 */
export const runsCanonicalRecognition = (mode: ScannerMode): boolean =>
  mode === 'normal' || mode === 'deck-benchmark' || mode === 'card-swap-test';

/** Suspend hi-res + SessionController recognition progression (not detector latch). */
export const suspendsNormalRecognition = (mode: ScannerMode): boolean =>
  isBinderMode(mode) ||
  mode === 'scanner-lab' ||
  mode === 'focus-series' ||
  mode === 'geometry-test';

/** Default overlays: deck/swap show raw+tracked+recognition; binder/geometry stay green-only. */
export const showsDiagnosticPolygonsByDefault = (mode: ScannerMode): boolean =>
  mode === 'normal' || mode === 'deck-benchmark' || mode === 'card-swap-test';

/** Geometry Test + Normal geometry-v2: draw latest plausible without presentation easing. */
export const usesLiveRawPolygon = (mode: ScannerMode): boolean =>
  mode === 'geometry-test' || (mode === 'normal' && isGeometryV2Pipeline());

/** Binder draws its own multi-card overlays (not Single Scan polygons). */
export const usesBinderOverlays = (mode: ScannerMode): boolean => isBinderMode(mode);/**
 * Claim rules: only one exclusive owner.
 * Releasing is modeled as claiming `normal` (or same mode is a no-op success).
 */
export const canClaimScannerMode = (current: ScannerMode, next: ScannerMode): boolean => {
  if (next === current) return true;
  if (next === 'normal') return true;
  if (current === 'normal') return true;
  return false;
};

export const applyScannerModeClaim = (
  current: ScannerMode,
  next: ScannerMode,
): { ok: true; mode: ScannerMode } | { ok: false; mode: ScannerMode; reason: string } => {
  if (!canClaimScannerMode(current, next)) {
    return {
      ok: false,
      mode: current,
      reason: `scanner owned by ${current}; cannot claim ${next}`,
    };
  }
  return { ok: true, mode: next };
};

/** After leaving a benchmark, consumer UI must not show the last FOUND. */
export const shouldResetSessionOnModeExit = (
  from: ScannerMode,
  to: ScannerMode,
): boolean => isExclusiveScannerOwner(from) && to === 'normal';

export const shouldDismissNormalResultOnModeEnter = (
  from: ScannerMode,
  to: ScannerMode,
): boolean => from === 'normal' && isExclusiveScannerOwner(to);
