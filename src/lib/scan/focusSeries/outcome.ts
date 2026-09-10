import { identityMatchesExpected } from './expected';
import type { FocusSeriesSample } from './types';

export type SampleOutcomeKind =
  | 'correct'
  | 'false-positive'
  | 'ambiguous-wrong'
  | 'ambiguous-unresolved'
  | 'unidentified';

export const isStrongIdentity = (sample: FocusSeriesSample): boolean =>
  sample.ocr.decision === 'exact-title' || sample.ocr.decision === 'strong-fuzzy';

export const isOcrEmpty = (sample: FocusSeriesSample): boolean =>
  sample.ocr.decision === 'ocr-empty' || sample.ocr.status === 'ocr-empty';

export const isInsufficient = (sample: FocusSeriesSample): boolean =>
  sample.ocr.status === 'insufficient-confidence' || sample.ocr.reason === 'insufficient-confidence';

export const isAmbiguous = (sample: FocusSeriesSample): boolean =>
  sample.ocr.decision === 'ambiguous' || sample.ocr.status === 'card-ambiguous';

/** Strong identity stops a fallback policy. False positives also stop — they must not be "fixed" by pretending we did not publish. */
export const shouldStopPolicy = (sample: FocusSeriesSample): boolean => isStrongIdentity(sample);

/** ocr-empty, insufficient, and ambiguous are eligible for one fallback. */
export const eligibleFallback = (sample: FocusSeriesSample): boolean =>
  !isStrongIdentity(sample) && (isOcrEmpty(sample) || isInsufficient(sample) || isAmbiguous(sample));

export const ocrCallsForSample = (sample: FocusSeriesSample): number =>
  Math.max(1, sample.ocr.ocrVariantCount || 0);

export const classifySampleOutcome = (
  sample: FocusSeriesSample,
  expectedName: string,
): SampleOutcomeKind => {
  const predicted = sample.ocr.matchName;
  const matches = identityMatchesExpected(predicted, expectedName);
  if (isStrongIdentity(sample)) return matches ? 'correct' : 'false-positive';
  if (predicted && !matches) return 'ambiguous-wrong';
  if (isAmbiguous(sample) || isInsufficient(sample)) return 'ambiguous-unresolved';
  return 'unidentified';
};
