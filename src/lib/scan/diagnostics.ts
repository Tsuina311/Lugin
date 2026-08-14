// What the scanner did, recorded so we can find out why it failed.
//
// Phase A exists because "recognition is unreliable" is not a diagnosis. Every
// stage writes here; the debug view and the evaluation harness both read it, so
// a fixture failing in CI and a card failing in someone's hand produce the same
// evidence.

import type { CardSource } from './prepareCard';
import type { CardCorners, ScanImage } from './types';

export interface StageTiming {
  ms: number;
  stage: string;
}

export interface OcrSample {
  confidence: number;
  /** Kept for the debug view only; never uploaded anywhere. */
  crop?: ScanImage;
  cropHeight: number;
  cropWidth: number;
  ms: number;
  normalizedText: string;
  rawText: string;
  region: string;
  variant: string;
}

export interface CandidateSample {
  name: string;
  score: number;
  setCode?: string;
}

export interface ScanDiagnostics {
  candidates: CandidateSample[];
  cardImage?: ScanImage;
  corners: CardCorners | null;
  detectionScore: number;
  frameHeight: number;
  frameWidth: number;
  glare: number;
  ocr: OcrSample[];
  outcome: string;
  sharpness: number;
  source: CardSource | 'photo';
  timings: StageTiming[];
  totalMs: number;
}

export const emptyDiagnostics = (): ScanDiagnostics => ({
  candidates: [],
  corners: null,
  detectionScore: 0,
  frameHeight: 0,
  frameWidth: 0,
  glare: 0,
  ocr: [],
  outcome: 'pending',
  sharpness: 0,
  source: 'whole-frame',
  timings: [],
  totalMs: 0,
});

/** Monotonic clock, injectable so tests are deterministic. */
export type Clock = () => number;

const defaultClock: Clock = () =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

/**
 * Accumulates stage timings without every stage having to know about the
 * diagnostics object it will end up in.
 */
export class ScanTimer {
  private readonly clock: Clock;
  private readonly start: number;
  private readonly stages: StageTiming[] = [];

  constructor(clock: Clock = defaultClock) {
    this.clock = clock;
    this.start = clock();
  }

  /** Time a synchronous stage. */
  measure<T>(stage: string, run: () => T): T {
    const began = this.clock();
    try {
      return run();
    } finally {
      this.stages.push({ ms: this.clock() - began, stage });
    }
  }

  /** Time an asynchronous stage. */
  async measureAsync<T>(stage: string, run: () => Promise<T>): Promise<T> {
    const began = this.clock();
    try {
      return await run();
    } finally {
      this.stages.push({ ms: this.clock() - began, stage });
    }
  }

  get timings(): StageTiming[] {
    return [...this.stages];
  }

  get totalMs(): number {
    return this.clock() - this.start;
  }
}

/** One-line summary for a console or a log line. */
export const summarizeDiagnostics = (d: ScanDiagnostics): string => {
  const stages = d.timings.map(t => `${t.stage} ${t.ms.toFixed(0)}ms`).join(', ');
  const best = d.ocr.reduce<OcrSample | null>(
    (top, s) => (!top || s.confidence > top.confidence ? s : top),
    null,
  );
  return [
    `${d.source}${d.detectionScore ? ` (${d.detectionScore.toFixed(2)})` : ''}`,
    `sharpness ${d.sharpness.toFixed(0)}`,
    best ? `best "${best.rawText.trim()}" @${(best.confidence * 100).toFixed(0)}%` : 'no ocr',
    `${d.totalMs.toFixed(0)}ms total`,
    stages,
  ].join(' · ');
};
