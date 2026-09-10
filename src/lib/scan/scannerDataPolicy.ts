// Pure policy for scanner-data manifest checks (testable without Expo FS).

import { SCANNER_MANIFEST_CHECK_INTERVAL_MS } from './scannerManifest';

/**
 * Whether a background manifest network check may be skipped.
 *
 * Critical assets (PrintingIndex when advertised; TypeIndex when advertised)
 * that are still missing MUST NOT be throttled — that was the Samsung bug
 * where a failed large download suppressed retries for 18h.
 */
export const shouldThrottleScannerManifestCheck = (opts: {
  force?: boolean;
  lastCheckAt: number | null | undefined;
  now: number;
  intervalMs?: number;
  /** True when a required-for-quality index is still absent in memory/disk. */
  criticalAssetMissing?: boolean;
}): boolean => {
  if (opts.force) return false;
  if (opts.criticalAssetMissing) return false;
  const last = opts.lastCheckAt;
  if (last == null) return false;
  const interval = opts.intervalMs ?? SCANNER_MANIFEST_CHECK_INTERVAL_MS;
  return opts.now - last < interval;
};

/** Whether a failed check may advance lastCheckAt (enabling the 18h throttle). */
export const mayAdvanceLastCheckAfterFailure = (opts: {
  printingMissing: boolean;
  typeMissing: boolean;
}): boolean => !opts.printingMissing && !opts.typeMissing;

export const needPrintingAsset = (opts: {
  manifestHasPrinting: boolean;
  diskPrintingExists: boolean;
  metaSha256: string | null | undefined;
  manifestSha256: string | null | undefined;
  activePrintingLoaded: boolean;
}): boolean => {
  if (!opts.manifestHasPrinting) return false;
  if (!opts.diskPrintingExists) return true;
  if (!opts.activePrintingLoaded) return true;
  const meta = (opts.metaSha256 ?? '').toLowerCase();
  const want = (opts.manifestSha256 ?? '').toLowerCase();
  if (!meta || !want) return true;
  return meta !== want;
};

export const needTypeAsset = (opts: {
  manifestHasType: boolean;
  diskTypeExists: boolean;
  metaSha256: string | null | undefined;
  manifestSha256: string | null | undefined;
  activeTypeLoaded: boolean;
}): boolean => {
  if (!opts.manifestHasType) return false;
  if (!opts.diskTypeExists) return true;
  if (!opts.activeTypeLoaded) return true;
  const meta = (opts.metaSha256 ?? '').toLowerCase();
  const want = (opts.manifestSha256 ?? '').toLowerCase();
  if (!meta || !want) return true;
  return meta !== want;
};
