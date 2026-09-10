import { FOCUS_SERIES_OFFSETS_MS, type FocusSeriesNominalMs, type FocusSeriesSample } from './types';
import {
  classifySampleOutcome,
  eligibleFallback,
  ocrCallsForSample,
  shouldStopPolicy,
  type SampleOutcomeKind,
} from './outcome';

export type CapturePolicyId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

export interface CapturePolicySpec {
  fallbackMs: FocusSeriesNominalMs | null;
  firstMs: FocusSeriesNominalMs;
  id: CapturePolicyId;
  label: string;
}

export const CAPTURE_POLICIES: readonly CapturePolicySpec[] = [
  { fallbackMs: null, firstMs: 0, id: 'A', label: 'T0 only' },
  { fallbackMs: null, firstMs: 250, id: 'B', label: 'fixed T250' },
  { fallbackMs: null, firstMs: 500, id: 'C', label: 'fixed T500' },
  { fallbackMs: null, firstMs: 800, id: 'D', label: 'fixed T800' },
  { fallbackMs: 250, firstMs: 0, id: 'E', label: 'T0 then T250 on failure' },
  { fallbackMs: 500, firstMs: 0, id: 'F', label: 'T0 then T500 on failure' },
  { fallbackMs: 800, firstMs: 0, id: 'G', label: 'T0 then T800 on failure' },
];

export interface PolicyPick {
  fallbackUsed: boolean;
  first: FocusSeriesSample;
  outcome: SampleOutcomeKind;
  predicted: string | null;
  selected: FocusSeriesSample;
}

export const sampleAtDelay = (
  samples: readonly FocusSeriesSample[],
  ms: FocusSeriesNominalMs,
): FocusSeriesSample | null => samples.find(s => s.nominalDelayMs === ms) ?? null;

export const simulatePolicy = (
  samples: readonly FocusSeriesSample[],
  spec: CapturePolicySpec,
  expectedName: string,
): PolicyPick | null => {
  const first = sampleAtDelay(samples, spec.firstMs);
  if (!first) return null;
  const fallbackMs = spec.fallbackMs;
  const useFallback =
    fallbackMs != null && !shouldStopPolicy(first) && eligibleFallback(first);
  const selected =
    useFallback && fallbackMs != null
      ? sampleAtDelay(samples, fallbackMs) ?? first
      : first;
  return {
    fallbackUsed: useFallback && selected !== first,
    first,
    outcome: classifySampleOutcome(selected, expectedName),
    predicted: selected.ocr.matchName,
    selected,
  };
};

export interface PolicyAggregate {
  accuracy: number;
  additionalLatencyMs: number[];
  ambiguousWrong: number;
  correct: number;
  extraOcrCalls: number[];
  fallbackRate: number;
  fallbacks: number;
  falsePositives: number;
  ocrCalls: number[];
  selectedDelaysMs: number[];
  spec: CapturePolicySpec;
  total: number;
  unidentified: number;
}

const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

const p50 = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)] ?? null;
};

export const aggregatePolicy = (
  picks: readonly { pick: PolicyPick; t0DelayMs: number }[],
  spec: CapturePolicySpec,
): PolicyAggregate => {
  const total = picks.length;
  const correct = picks.filter(p => p.pick.outcome === 'correct').length;
  const falsePositives = picks.filter(p => p.pick.outcome === 'false-positive').length;
  const unidentified = picks.filter(
    p => p.pick.outcome === 'unidentified' || p.pick.outcome === 'ambiguous-unresolved',
  ).length;
  const ambiguousWrong = picks.filter(p => p.pick.outcome === 'ambiguous-wrong').length;
  const fallbacks = picks.filter(p => p.pick.fallbackUsed).length;
  return {
    accuracy: total ? correct / total : 0,
    additionalLatencyMs: picks.map(p =>
      Math.max(0, p.pick.selected.actualDelayFromFocusRequestMs - p.t0DelayMs),
    ),
    ambiguousWrong,
    correct,
    extraOcrCalls: picks.map(p => (p.pick.fallbackUsed ? ocrCallsForSample(p.pick.selected) : 0)),
    fallbackRate: total ? fallbacks / total : 0,
    fallbacks,
    falsePositives,
    ocrCalls: picks.map(p => {
      if (!p.pick.fallbackUsed) return ocrCallsForSample(p.pick.selected);
      return ocrCallsForSample(p.pick.first) + ocrCallsForSample(p.pick.selected);
    }),
    selectedDelaysMs: picks.map(p => p.pick.selected.actualDelayFromFocusRequestMs),
    spec,
    total,
    unidentified,
  };
};

export const formatPolicyRow = (agg: PolicyAggregate): string => {
  const pct = (n: number) => `${Math.round(100 * n)}%`;
  const ms = (xs: number[]) => {
    const m = mean(xs);
    const p = p50(xs);
    return m == null ? 'n/a' : `mean ${m.toFixed(0)} / p50 ${p?.toFixed(0) ?? 'n/a'}`;
  };
  const ocr = mean(agg.ocrCalls);
  return [
    `${agg.spec.id}  ${agg.spec.label}`.padEnd(32),
    `${agg.correct}/${agg.total} (${pct(agg.accuracy)})`.padEnd(16),
    `FP ${agg.falsePositives}`.padEnd(8),
    `amb ${agg.ambiguousWrong}`.padEnd(8),
    `unid ${agg.unidentified}`.padEnd(10),
    `fb ${pct(agg.fallbackRate)}`.padEnd(8),
    `OCR/card ${ocr == null ? 'n/a' : ocr.toFixed(2)}`.padEnd(14),
    `delay ${ms(agg.selectedDelaysMs)}`,
    `extra ${ms(agg.additionalLatencyMs)}`,
  ].join('  ');
};

export { FOCUS_SERIES_OFFSETS_MS };
