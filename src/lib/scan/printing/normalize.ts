// Conservative OCR normalization for set codes + collector numbers.
// Never invent a different valid collector number — only OCR confusable folds.

import type { CollectorParts } from '../parseCollector';
import { normalizeSetCode } from '../parseCollector';

/** Fold OCR confusables in a collector-number *digit* context. */
export const normalizeCollectorNumberOcr = (raw: string): string => {
  let s = raw.trim();
  s = s.replace(/[^\p{L}\p{N}★✶✪*•·∙/\-]/gu, '');
  s = s.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').replace(/\s+/g, '');
  return s;
};

/** Canonical lookup form: strip leading zeros for comparison only. */
export const collectorLookupForms = (raw: string): string[] => {
  const n = normalizeCollectorNumberOcr(raw).toLowerCase();
  if (!n) return [];
  const stripped = n.replace(/^0+/, '') || '0';
  const forms = new Set<string>([n, stripped]);
  // Zero-pad variants common on modern cards (001–999).
  if (/^\d+[a-z]?$/.test(stripped)) {
    for (const len of [2, 3, 4]) {
      const digits = stripped.replace(/[a-z]+$/i, '');
      const suffix = stripped.slice(digits.length);
      if (digits.length && digits.length < len) {
        forms.add(digits.padStart(len, '0') + suffix);
      }
    }
  }
  return [...forms];
};

export const printingKey = (setCode: string, collectorNumber: string): string =>
  `${setCode.toLowerCase()}|${collectorNumber.toLowerCase()}`;

/** Expand CollectorParts into candidate lookup keys (set × number forms). */
export const collectorLookupKeys = (parts: CollectorParts): string[] => {
  const set = normalizeSetCode(parts.setCode) ?? parts.setCode?.toUpperCase();
  if (!set || !parts.collectorNumber) return [];
  const setNorm = set.toLowerCase();
  return collectorLookupForms(parts.collectorNumber).map(n => printingKey(setNorm, n));
};
