// Rolling timing/rate stats for the frame pipeline.
//
// Phase C.2 is a measurement, so these numbers are the deliverable, not a
// debugging nicety: the RGBA-vs-YUV decision is made from them. Percentiles
// rather than means because a 12 ms median with a 90 ms tail feels broken to a
// user while averaging to "fine".
//
// Allocation-free on the hot path — a fixed ring buffer, sorted only when read.

const WINDOW = 60;

export interface StageStats {
  count: number;
  last: number;
  p50: number;
  p95: number;
}

export interface Stage {
  push(ms: number): void;
  read(): StageStats;
  reset(): void;
}

export const createStage = (): Stage => {
  const samples = new Float64Array(WINDOW);
  const sorted = new Float64Array(WINDOW);
  let filled = 0;
  let cursor = 0;
  let last = 0;
  let total = 0;

  return {
    push(ms) {
      samples[cursor] = ms;
      cursor = (cursor + 1) % WINDOW;
      if (filled < WINDOW) filled++;
      last = ms;
      total++;
    },
    read() {
      if (filled === 0) return { count: 0, last: 0, p50: 0, p95: 0 };
      const view = sorted.subarray(0, filled);
      view.set(samples.subarray(0, filled));
      view.sort();
      const at = (q: number) => view[Math.min(filled - 1, Math.floor(q * filled))];
      return { count: total, last, p50: at(0.5), p95: at(0.95) };
    },
    reset() {
      filled = 0;
      cursor = 0;
      last = 0;
      total = 0;
    },
  };
};

/** Events per second over a sliding wall-clock window. */
export interface Rate {
  mark(now: number): void;
  read(now: number): number;
  reset(): void;
}

export const createRate = (windowMs = 2000): Rate => {
  const stamps: number[] = [];
  const trim = (now: number) => {
    while (stamps.length > 0 && now - stamps[0] > windowMs) stamps.shift();
  };
  return {
    mark(now) {
      stamps.push(now);
      trim(now);
    },
    read(now) {
      trim(now);
      if (stamps.length < 2) return 0;
      const span = now - stamps[0];
      return span <= 0 ? 0 : (stamps.length / span) * 1000;
    },
    reset() {
      stamps.length = 0;
    },
  };
};

/**
 * One snapshot of the pipeline: the four stage timings the RGBA-vs-YUV
 * decision needs (convert, transfer, detect, total), the achieved cadence, and
 * where frames were lost. Fields are alphabetical to satisfy the repo lint
 * rule; `ScanMetricsPanel` renders them in pipeline order.
 */
export interface AnalysisMetrics {
  /** Analyses completed per second — the 6–12/s target. */
  analysisRate: number;
  /** BGRA→RGBA + rotate + downscale, in the worklet. */
  convertMs: StageStats;
  /** Payloads arriving on the JS thread per second. */
  deliveryRate: number;
  /** Shared `detectCardQuad`. */
  detectMs: StageStats;
  /** Frames the camera dropped because the worklet was still busy. */
  droppedByCamera: number;
  /**
   * Frames the camera handed to the worklet, per second.
   *
   * This is the frame-output rate, not the on-screen preview rate — the
   * preview is a separate camera output. Preview smoothness is judged by eye
   * against the screen's "Detector off" control.
   */
  frameRate: number;
  lastDropReason: string | null;
  /** Frames the worklet chose to sample, per second. */
  sampleRate: number;
  /** Frames the worklet skipped to hold the target cadence. */
  skippedForCadence: number;
  /** Payloads superseded on the JS thread by a newer frame. */
  supersededOnJs: number;
  /** Conversion through detection, end to end. */
  totalMs: StageStats;
  /** Worklet → JS thread handoff (one native buffer copy). */
  transferMs: StageStats;
}
