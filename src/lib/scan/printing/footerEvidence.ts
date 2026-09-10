// Structured footer OCR evidence — extract candidates, don't require a perfect string.

import type { CollectorParts } from '../parseCollector';
import { normalizeSetCode, tidyOcr } from '../parseCollector';
import { editDistance } from '../matchName';
import { collectorLookupForms, normalizeCollectorNumberOcr } from './normalize';
import type { PrintingIndex, PrintingIndexEntry, PrintingLookupHit } from './types';
import { listPrintingsByName, lookupPrinting, uniqueOracle, uniquePrinting } from './index';

export interface RankedToken {
  score: number;
  value: string;
}

export interface FooterEvidence {
  collectorCandidates: RankedToken[];
  languageCandidates: RankedToken[];
  rawText: string;
  setCodeCandidates: RankedToken[];
}

/** Tokens that look like set codes but are rarity / layout noise. */
const SET_NOISE = new Set([
  'EN',
  'FR',
  'DE',
  'IT',
  'ES',
  'PT',
  'JA',
  'JP',
  'KO',
  'ZHS',
  'ZHT',
  'THE',
  'AND',
  'FOR',
  'SET',
  'LLC',
  'INC',
  'ALL',
  'ANY',
  'ONE',
  'TWO',
  'RED',
  'WOT',
  'FFVII', // Final Fantasy VII product token, not a set code
  'EMENT',
  'SOUS',
  'WIZARDS',
]);

const LANG_TOKENS = new Set(['EN', 'FR', 'DE', 'IT', 'ES', 'PT', 'JA', 'JP', 'KO', 'PH', 'ZHS', 'ZHT']);

/**
 * Pull ranked collector / set / language candidates from noisy footer OCR.
 *
 * Examples:
 * - `R0337 FFVII` → collectors 0337/337, tokens R / FFVII (not treated as set)
 * - `RO360 TDC` → collector 360, set TDC
 * - `457 L` → collector 457
 */
export const extractFooterEvidence = (raw: string): FooterEvidence => {
  const line = tidyOcr(raw);
  const collectorCandidates: RankedToken[] = [];
  const setCodeCandidates: RankedToken[] = [];
  const languageCandidates: RankedToken[] = [];
  const seenCollector = new Set<string>();
  const seenSet = new Set<string>();

  const pushCollector = (value: string, score: number) => {
    const n = normalizeCollectorNumberOcr(value);
    if (!n || seenCollector.has(n.toLowerCase())) return;
    seenCollector.add(n.toLowerCase());
    collectorCandidates.push({ score, value: n });
    for (const form of collectorLookupForms(n)) {
      if (seenCollector.has(form)) continue;
      seenCollector.add(form);
      collectorCandidates.push({ score: score * 0.95, value: form });
    }
  };

  const pushSet = (value: string, score: number) => {
    const code = normalizeSetCode(value);
    if (!code || SET_NOISE.has(code) || LANG_TOKENS.has(code)) return;
    if (seenSet.has(code)) return;
    seenSet.add(code);
    setCodeCandidates.push({ score, value: code });
  };

  if (!line) {
    return { collectorCandidates, languageCandidates, rawText: line, setCodeCandidates };
  }

  // Classic NNN/MMM
  for (const m of line.matchAll(/\b(\d{1,4}[A-Z]?)\/\d{1,4}\b/g)) {
    pushCollector(m[1], 0.95);
  }

  // Glued rarity+number: R0337, RO360, U123
  for (const m of line.matchAll(/\b([CURML])(\d{2,4}[A-Z]?)\b/g)) {
    pushCollector(m[2], 0.9);
  }
  for (const m of line.matchAll(/\b([CURML]O)(\d{2,4}[A-Z]?)\b/g)) {
    pushCollector(m[2], 0.88);
  }

  // Bare numbers
  for (const m of line.matchAll(/\b(\d{2,4}[A-Z]?)\b/g)) {
    pushCollector(m[1], 0.75);
  }

  // Uppercase tokens
  for (const m of line.matchAll(/\b([A-Z0-9]{2,6})\b/g)) {
    const tok = m[1];
    if (LANG_TOKENS.has(tok)) {
      languageCandidates.push({ score: 0.9, value: tok === 'JP' ? 'JA' : tok });
      continue;
    }
    if (/^\d/.test(tok) || SET_NOISE.has(tok)) continue;
    if (/^[CURML]$/.test(tok)) continue;
    pushSet(tok, 0.7);
  }

  collectorCandidates.sort((a, b) => b.score - a.score);
  setCodeCandidates.sort((a, b) => b.score - a.score);
  languageCandidates.sort((a, b) => b.score - a.score);

  return { collectorCandidates, languageCandidates, rawText: line, setCodeCandidates };
};

/** Prefer evidence → CollectorParts for legacy lookupPrinting. */
export const footerEvidenceToParts = (ev: FooterEvidence): CollectorParts => ({
  collectorNumber: ev.collectorCandidates[0]?.value,
  foilMarker: null,
  raw: ev.rawText,
  setCode: ev.setCodeCandidates[0]?.value,
});

/**
 * Conservatively fuzzy-correct a set token against a known vocabulary.
 * Only when edit distance ≤ 1 and uniqueness is clear.
 */
export const fuzzyCorrectSetCode = (
  token: string,
  knownSets: ReadonlySet<string> | readonly string[],
): string | null => {
  const raw = normalizeSetCode(token) ?? token.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!raw || SET_NOISE.has(raw) || LANG_TOKENS.has(raw)) return null;
  const known = knownSets instanceof Set ? knownSets : new Set(knownSets);
  if (known.has(raw.toLowerCase()) || known.has(raw)) return raw.toLowerCase();
  if (raw.length < 2 || raw.length > 5) return null;
  const hits: string[] = [];
  for (const s of known) {
    const code = String(s).toUpperCase();
    if (Math.abs(code.length - raw.length) > 1) continue;
    if (editDistance(code, raw) <= 1) hits.push(code.toLowerCase());
    if (hits.length > 2) return null;
  }
  return hits.length === 1 ? hits[0] : null;
};

export interface TitleRestrictedLookupArgs {
  evidence: FooterEvidence;
  /** English / oracle display name from strong title. */
  titleName: string;
  knownSets?: ReadonlySet<string> | readonly string[];
}

/**
 * Restrict footer resolution to printings of the titled card, then match
 * collector (and optional set) candidates against that shortlist.
 */
export const lookupPrintingTitleRestricted = (
  index: PrintingIndex | null | undefined,
  args: TitleRestrictedLookupArgs,
): PrintingLookupHit | null => {
  if (!index) return null;
  const printings = listPrintingsByName(index, args.titleName);
  if (!printings.length) return null;

  const byKey = new Map<string, PrintingIndexEntry[]>();
  for (const p of printings) {
    for (const form of collectorLookupForms(p.collectorNumber)) {
      const k = `${p.setCode.toLowerCase()}|${form}`;
      const bucket = byKey.get(k) ?? [];
      bucket.push(p);
      byKey.set(k, bucket);
      const kNum = form;
      const b2 = byKey.get(kNum) ?? [];
      b2.push(p);
      byKey.set(kNum, b2);
    }
  }

  const sets = new Set(printings.map(p => p.setCode.toLowerCase()));
  const setCands = args.evidence.setCodeCandidates.map(c => {
    const corrected =
      fuzzyCorrectSetCode(c.value, args.knownSets ?? sets) ?? c.value.toLowerCase();
    return { ...c, value: corrected };
  });

  // 1) exact set + collector among title printings
  for (const set of setCands) {
    if (!sets.has(set.value.toLowerCase())) continue;
    for (const col of args.evidence.collectorCandidates) {
      const key = `${set.value.toLowerCase()}|${col.value.toLowerCase()}`;
      const hits = byKey.get(key);
      if (hits?.length) {
        return {
          candidates: uniqueById(hits),
          key,
          variantsTried: 1,
        };
      }
    }
  }

  // 2) collector unique among title printings (any set)
  for (const col of args.evidence.collectorCandidates) {
    const hits = uniqueById(byKey.get(col.value.toLowerCase()) ?? []);
    if (hits.length === 1) {
      return {
        candidates: hits,
        key: `name|${col.value}`,
        variantsTried: 1,
      };
    }
    if (hits.length > 1 && setCands.length) {
      const narrowed = hits.filter(h =>
        setCands.some(s => s.value.toLowerCase() === h.setCode.toLowerCase()),
      );
      if (narrowed.length === 1) {
        return {
          candidates: narrowed,
          key: `name+set|${col.value}`,
          variantsTried: 1,
        };
      }
    }
  }

  // 3) fall back to global lookup with best parts
  const parts = footerEvidenceToParts(args.evidence);
  if (setCands[0]) parts.setCode = setCands[0].value;
  return lookupPrinting(index, parts);
};

const uniqueById = (rows: PrintingIndexEntry[]): PrintingIndexEntry[] => {
  const seen = new Set<string>();
  const out: PrintingIndexEntry[] = [];
  for (const r of rows) {
    if (seen.has(r.scryfallId)) continue;
    seen.add(r.scryfallId);
    out.push(r);
  }
  return out;
};

export { uniqueOracle, uniquePrinting };
