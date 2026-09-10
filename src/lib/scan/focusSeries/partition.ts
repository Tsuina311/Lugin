import { inferQuadMode } from './classify';
import type { FocusSeriesBundle } from './types';

export const quadModeOf = (bundle: FocusSeriesBundle) =>
  bundle.quadMode ?? inferQuadMode(bundle.samples);

export const partitionFocusSeries = (bundles: readonly FocusSeriesBundle[]) => ({
  all: bundles,
  legacy: bundles.filter(b => quadModeOf(b) === 'legacy-frozen'),
  perSnapshot: bundles.filter(b => quadModeOf(b) === 'per-snapshot'),
});

export const warpBadCount = (bundles: readonly FocusSeriesBundle[]): number =>
  bundles.reduce((n, b) => n + b.samples.filter(s => s.failureClass === 'WARP_BAD').length, 0);
