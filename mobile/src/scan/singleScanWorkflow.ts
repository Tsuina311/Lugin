/**
 * Single Scan workflow: Continuous (ManaBox-class) vs Verified (NEXT-based).
 * Independent of ScannerMode exclusivity (binder/lab/etc.).
 */

export type SingleScanWorkflow = 'continuous' | 'verified';

/** Default Continuous for ManaBox-class testing; chip still toggles Verified. */
let active: SingleScanWorkflow = 'continuous';

export const getSingleScanWorkflow = (): SingleScanWorkflow => active;

export const setSingleScanWorkflow = (w: SingleScanWorkflow): SingleScanWorkflow => {
  active = w;
  return active;
};

export const cycleSingleScanWorkflow = (): SingleScanWorkflow => {
  active = active === 'verified' ? 'continuous' : 'verified';
  return active;
};

/** Feature flags — Continuous requires native CLIP APK. */
export type ContinuousFlags = {
  continuousScanEnabled: boolean;
  nativeClipEnabled: boolean;
};

let flags: ContinuousFlags = {
  continuousScanEnabled: true,
  nativeClipEnabled: true,
};

export const getContinuousFlags = (): ContinuousFlags => ({ ...flags });

export const setContinuousFlags = (patch: Partial<ContinuousFlags>): ContinuousFlags => {
  flags = { ...flags, ...patch };
  return { ...flags };
};
