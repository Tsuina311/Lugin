import { driftVsT0, seriesUsesFrozenQuad } from './geometry';
import type {
  FocusFailureClass,
  FocusQuadMode,
  FocusSeriesSample,
} from './types';

/** Title crops that look like print (Island T250 ≈ 129; good Teferi ≈ 343). */
const TITLE_READABLE_SHARP = 40;
const TITLE_READABLE_CONTRAST = 10;
/** Warp / source-card that still has card-face detail (Teferi warp ≈ 321–346). */
const CARD_DETAILED_SHARP = 80;
const SOURCE_DETAILED_SHARP = 12;
const GEOMETRY_IOU_STALE = 0.75;
const GEOMETRY_CENTER_STALE = 0.08;
const GEOMETRY_CORNER_STALE = 0.1;
/** T0 title must be this sharp before a later collapse counts as stale geometry. */
const TITLE_COLLAPSE_T0_MIN = 80;
const TITLE_COLLAPSE_RATIO = 0.25;

const identified = (sample: FocusSeriesSample): boolean =>
  sample.ocr.decision === 'exact-title' || sample.ocr.decision === 'strong-fuzzy';

const titleReadable = (sample: FocusSeriesSample): boolean =>
  sample.metrics.titleSharpness >= TITLE_READABLE_SHARP &&
  sample.metrics.titleContrast >= TITLE_READABLE_CONTRAST;

const cardDetailed = (sample: FocusSeriesSample): boolean =>
  sample.metrics.cardSharpness >= CARD_DETAILED_SHARP;

const sourceDetailed = (sample: FocusSeriesSample): boolean => {
  const sourceCard = sample.sourceCardSharpness;
  if (sourceCard != null && sourceCard >= CARD_DETAILED_SHARP) return true;
  return sample.sourceSharpness >= SOURCE_DETAILED_SHARP || cardDetailed(sample);
};

const geometryStale = (sample: FocusSeriesSample): boolean => {
  const g = sample.geometry;
  if (!g) return false;
  return (
    g.iouVsT0 < GEOMETRY_IOU_STALE ||
    g.centerDeltaVsT0 > GEOMETRY_CENTER_STALE ||
    g.cornerDeltaVsT0 > GEOMETRY_CORNER_STALE
  );
};

const titleCollapsedAfterT0 = (
  sample: FocusSeriesSample,
  t0: FocusSeriesSample | null,
): boolean => {
  if (!t0 || sample.nominalDelayMs === 0) return false;
  return (
    t0.metrics.titleSharpness >= TITLE_COLLAPSE_T0_MIN &&
    sample.metrics.titleSharpness < t0.metrics.titleSharpness * TITLE_COLLAPSE_RATIO
  );
};

/**
 * Separate soft capture from stale/wrong title geometry.
 * Do not treat every low title-sharpness number as autofocus failure.
 */
export const classifyFocusSample = (
  sample: FocusSeriesSample,
  ctx: { frozenQuadSeries: boolean; t0: FocusSeriesSample | null },
): FocusFailureClass => {
  if (identified(sample)) return 'OK';

  const detailed = sourceDetailed(sample) || cardDetailed(sample);
  if (!detailed) return 'SOURCE_BAD';

  const warpWeakerThanSource =
    sample.sourceCardSharpness != null &&
    sample.sourceCardSharpness >= CARD_DETAILED_SHARP &&
    sample.metrics.cardSharpness < CARD_DETAILED_SHARP;

  if (
    geometryStale(sample) ||
    warpWeakerThanSource ||
    (ctx.frozenQuadSeries && titleCollapsedAfterT0(sample, ctx.t0) && detailed)
  ) {
    return 'WARP_BAD';
  }

  if (cardDetailed(sample) && !titleReadable(sample)) return 'TITLE_REGION_BAD';
  if (titleReadable(sample)) return 'OCR_BAD';
  return cardDetailed(sample) ? 'TITLE_REGION_BAD' : 'SOURCE_BAD';
};

export const inferQuadMode = (samples: readonly FocusSeriesSample[]): FocusQuadMode =>
  seriesUsesFrozenQuad(samples.map(s => s.quad)) ? 'legacy-frozen' : 'per-snapshot';

const emptyGeometry = { centerDeltaVsT0: 0, cornerDeltaVsT0: 0, iouVsT0: 1 };

/** Fill drift + failure class. Safe on v1 bundles that omitted the new fields. */
export const attachFocusSeriesDiagnostics = (
  samples: readonly FocusSeriesSample[],
): FocusSeriesSample[] => {
  const t0 = samples.find(s => s.nominalDelayMs === 0) ?? samples[0] ?? null;
  const frozenQuadSeries = t0 ? seriesUsesFrozenQuad(samples.map(s => s.quad)) : false;
  return samples.map(sample => {
    const geometry = t0 ? driftVsT0(sample.quad, t0.quad) : sample.geometry ?? emptyGeometry;
    const next: FocusSeriesSample = {
      ...sample,
      cardContrast: sample.cardContrast ?? 0,
      geometry,
      quadAgeAtCaptureMs: sample.quadAgeAtCaptureMs ?? null,
      quadLatchedFrom: sample.quadLatchedFrom ?? 'live',
      quadTimestamp: sample.quadTimestamp ?? null,
      recognitionQuadSource: sample.recognitionQuadSource ?? null,
      recognitionQuadValid: sample.recognitionQuadValid ?? null,
      sourceCardContrast: sample.sourceCardContrast ?? null,
      sourceCardSharpness: sample.sourceCardSharpness ?? null,
      sourceContrast: sample.sourceContrast ?? 0,
      sourceSharpness: sample.sourceSharpness ?? 0,
      trackId: sample.trackId ?? null,
    };
    return {
      ...next,
      failureClass: classifyFocusSample(next, { frozenQuadSeries, t0 }),
    };
  });
};
