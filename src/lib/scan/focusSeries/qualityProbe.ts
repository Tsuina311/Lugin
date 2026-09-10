import { isOcrEmpty, isStrongIdentity } from './outcome';
import type { FocusSeriesSample } from './types';

export interface QualityLabeledSample {
  empty: boolean;
  titleContrast: number;
  titleSharpness: number;
  cardSharpness: number;
  usable: boolean;
}

/** Usable = strong correct identity. Empty = OCR returned nothing. Ambiguous excluded. */
export const labelQualitySample = (
  sample: FocusSeriesSample,
  correct: boolean,
): QualityLabeledSample | null => {
  const usable = isStrongIdentity(sample) && correct;
  const empty = isOcrEmpty(sample);
  if (!usable && !empty) return null;
  return {
    cardSharpness: sample.metrics.cardSharpness,
    empty,
    titleContrast: sample.metrics.titleContrast,
    titleSharpness: sample.metrics.titleSharpness,
    usable,
  };
};

export interface ThresholdEval {
  feature: 'titleSharpness' | 'cardSharpness' | 'titleContrast';
  precision: number;
  recall: number;
  threshold: number;
  trueEmpty: number;
  trueUsable: number;
}

const evalThreshold = (
  labeled: readonly QualityLabeledSample[],
  feature: ThresholdEval['feature'],
  threshold: number,
): ThresholdEval => {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const s of labeled) {
    const value = s[feature];
    const predEmpty = value < threshold;
    if (s.empty && predEmpty) tp += 1;
    if (s.usable && predEmpty) fp += 1;
    if (s.empty && !predEmpty) fn += 1;
  }
  return {
    feature,
    precision: tp + fp ? tp / (tp + fp) : 0,
    recall: tp + fn ? tp / (tp + fn) : 0,
    threshold,
    trueEmpty: labeled.filter(s => s.empty).length,
    trueUsable: labeled.filter(s => s.usable).length,
  };
};

export const bestTitleSharpnessSeparator = (
  labeled: readonly QualityLabeledSample[],
): { best: ThresholdEval | null; overlap: boolean; usableMin: number | null; emptyMax: number | null } => {
  const usable = labeled.filter(s => s.usable).map(s => s.titleSharpness);
  const empty = labeled.filter(s => s.empty).map(s => s.titleSharpness);
  const usableMin = usable.length ? Math.min(...usable) : null;
  const emptyMax = empty.length ? Math.max(...empty) : null;
  const overlap = usableMin != null && emptyMax != null && emptyMax >= usableMin;
  const candidates = [...new Set(labeled.map(s => Math.round(s.titleSharpness)))].sort((a, b) => a - b);
  let best: ThresholdEval | null = null;
  for (const t of candidates) {
    const ev = evalThreshold(labeled, 'titleSharpness', t);
    if (
      !best ||
      ev.precision + ev.recall > best.precision + best.recall ||
      (ev.precision + ev.recall === best.precision + best.recall && ev.precision > best.precision)
    ) {
      best = ev;
    }
  }
  return { best, emptyMax, overlap, usableMin };
};
