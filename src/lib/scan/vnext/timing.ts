/** Development timing samples for one completed vNext recognition attempt. */

import type { VNextDecisionSource } from './decide';

export type VNextTimingSample = {
  source: VNextDecisionSource;
  candidateGenerationMs: number;
  featureMs: number;
  gbmMs: number;
  candidateCount: number;
  warpMs: number;
  artMs: number;
  clipMs: number | null;
  adapterMs: number | null;
  searchMs: number | null;
  agreementMs: number;
  titleCropMs: number | null;
  ocrMs: number | null;
  lookupMs: number | null;
  totalMs: number;
  ocrInvoked: boolean;
};

const samples: VNextTimingSample[] = [];

export const recordVNextTiming = (sample: VNextTimingSample): void => {
  samples.push(sample);
  if (samples.length > 200) samples.shift();
};

export const vnextTimingSamples = (): readonly VNextTimingSample[] => samples;

export const resetVNextTiming = (): void => {
  samples.length = 0;
};

export type VNextTimingStats = {
  n: number;
  median: number | null;
  p90: number | null;
  max: number | null;
};

export const timingStats = (values: readonly number[]): VNextTimingStats => {
  if (!values.length) return { n: 0, median: null, p90: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
  return {
    n: sorted.length,
    median: at(0.5),
    p90: at(0.9),
    max: sorted[sorted.length - 1],
  };
};

export const summarizeVNextTiming = () => {
  const of = (source: VNextDecisionSource | null) =>
    samples.filter(sample => source == null || sample.source === source);
  const totals = (rows: readonly VNextTimingSample[]) => timingStats(rows.map(row => row.totalMs));
  const field = (key: keyof VNextTimingSample) =>
    timingStats(samples.map(row => row[key]).filter((value): value is number => typeof value === 'number'));
  const ocrRows = samples.filter(row => row.ocrInvoked);
  return {
    n: samples.length,
    ocrInvoked: ocrRows.length,
    visual: totals(of('VISUAL_AGREEMENT')),
    ocrRecovery: totals(of('OCR_EXACT_TOP5_RECOVERY')),
    withheld: totals(of('WITHHELD')),
    candidateGeneration: field('candidateGenerationMs'),
    gbm: field('gbmMs'),
    feature: field('featureMs'),
    warp: field('warpMs'),
    art: field('artMs'),
    clip: field('clipMs'),
    adapter: field('adapterMs'),
    search: field('searchMs'),
    agreement: field('agreementMs'),
    ocr: timingStats(ocrRows.map(row => row.ocrMs).filter((value): value is number => value != null)),
    lookup: timingStats(ocrRows.map(row => row.lookupMs).filter((value): value is number => value != null)),
  };
};
