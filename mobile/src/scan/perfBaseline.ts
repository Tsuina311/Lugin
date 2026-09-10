// Emergency performance baseline — restore UI/polygon before features.
// All flags are OTA-tunable; native async detect still needs matching APK.

export type PerfBaselineConfig = {
  /** Cap geometric detection attempts (Hz). */
  detectorHz: number;
  /** Worklet / Y-pack long edge before native WORK_WIDTH=320. */
  analysisLongEdge: number;
  /** Build gray ScanImage for quality (expensive). Off = tiny stub. */
  buildGrayProxy: boolean;
  /** Fire ML Kit warmUp on scanner enter. */
  ocrWarmup: boolean;
  /** Allow PrintingIndex/TypeIndex parse while scanner tab active. */
  heavyIndexesWhileScanning: boolean;
  /** Encode live detector/recognition PNG thumbs. */
  liveDebugImages: boolean;
  /** Publish frameMeta / counters at this Hz (not detector Hz). */
  debugMetricsHz: number;
  /** Skip nested sleeve preference (native still may compute; JS ignores). */
  nestedSleeve: boolean;
  /** Run footer OCR after title. */
  footerOcr: boolean;
  /** Run type-line OCR when ambiguous. */
  typeOcr: boolean;
  /** Run artwork match before first oracle. Off for lock→title baseline. */
  artwork: boolean;
};

/** Safe Samsung baseline — UI + polygon first. */
export const PERF_BASELINE: PerfBaselineConfig = {
  detectorHz: 8,
  analysisLongEdge: 480,
  buildGrayProxy: true,
  ocrWarmup: false,
  heavyIndexesWhileScanning: false,
  liveDebugImages: false,
  debugMetricsHz: 2,
  nestedSleeve: true,
  footerOcr: false,
  typeOcr: false,
  artwork: false,
};

/** Previous “featureful” defaults (for bisection). */
export const PERF_FULL: PerfBaselineConfig = {
  detectorHz: 10,
  analysisLongEdge: 480,
  buildGrayProxy: true,
  ocrWarmup: true,
  heavyIndexesWhileScanning: true,
  liveDebugImages: true,
  debugMetricsHz: 2.5,
  nestedSleeve: true,
  footerOcr: true,
  typeOcr: true,
  artwork: true,
};

let active: PerfBaselineConfig = { ...PERF_BASELINE };

export const getPerfBaseline = (): PerfBaselineConfig => active;

export const setPerfBaseline = (next: Partial<PerfBaselineConfig>): PerfBaselineConfig => {
  active = { ...active, ...next };
  return active;
};

export const applyPerfPreset = (preset: 'baseline' | 'full'): PerfBaselineConfig => {
  active = { ...(preset === 'baseline' ? PERF_BASELINE : PERF_FULL) };
  return active;
};
