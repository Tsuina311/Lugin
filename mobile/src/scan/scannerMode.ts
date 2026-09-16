/**
 * Phone-side mutable scanner mode owner.
 * Pure policy lives in `@/lib/scan/scannerMode`.
 */
import { useSyncExternalStore } from 'react';

import {
  applyScannerModeClaim,
  type ScannerMode,
} from '@/lib/scan/scannerMode';

export type {
  ScannerMode,
} from '@/lib/scan/scannerMode';

export {
  allowsNormalCollectionActions,
  allowsNormalResultPresentation,
  canClaimScannerMode,
  isBinderMode,
  isExclusiveScannerOwner,
  runsCanonicalRecognition,
  shouldDismissNormalResultOnModeEnter,
  shouldResetSessionOnModeExit,
  showsDiagnosticPolygonsByDefault,
  suspendsNormalRecognition,
  usesBinderOverlays,
  usesLiveRawPolygon,
} from '@/lib/scan/scannerMode';
let mode: ScannerMode = 'normal';
const listeners = new Set<() => void>();

const emit = () => {
  for (const l of listeners) l();
};

export const getScannerMode = (): ScannerMode => mode;

export const subscribeScannerMode = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Claim exclusive ownership. Returns false if another exclusive mode owns the scanner. */
export const claimScannerMode = (next: ScannerMode): boolean => {
  const result = applyScannerModeClaim(mode, next);
  if (!result.ok) return false;
  if (mode === result.mode) return true;
  mode = result.mode;
  emit();
  return true;
};

/** Release only if `from` is the current owner (avoids stomping another tool). */
export const releaseScannerMode = (from: ScannerMode): void => {
  if (mode !== from) return;
  mode = 'normal';
  emit();
};

/** Force normal — used when tearing down the camera surface. */
export const forceScannerModeNormal = (): void => {
  if (mode === 'normal') return;
  mode = 'normal';
  emit();
};

export const useScannerMode = (): ScannerMode =>
  useSyncExternalStore(subscribeScannerMode, getScannerMode, getScannerMode);
