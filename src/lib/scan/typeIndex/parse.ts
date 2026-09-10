// Normalize + fuzzy-match type-line OCR against TypeIndex vocabulary.

import { editDistance } from '../matchName';
import type { RankedTypeToken, TypeEvidence, TypeIndex } from './types';

const DASH = /\s*[-—–―]+\s*/;

/** Fold type-line text while keeping spaces (foldName strips whitespace). */
export const normalizeTypeLineText = (raw: string): string =>
  String(raw || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(DASH, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const foldToken = (raw: string): string =>
  String(raw || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const fuzzyToken = (
  token: string,
  vocab: readonly string[],
  idOf: Map<string, number>,
): RankedTypeToken | null => {
  const t = foldToken(token);
  if (!t || t.length < 2) return null;
  if (idOf.has(t)) {
    return { id: idOf.get(t)!, score: 1, value: t };
  }
  // Also try spaced vocab entries folded.
  for (const [k, id] of idOf) {
    if (foldToken(k) === t) return { id, score: 1, value: k };
  }
  let best: RankedTypeToken | null = null;
  for (const v of vocab) {
    const vf = foldToken(v);
    if (Math.abs(vf.length - t.length) > 2) continue;
    const d = editDistance(vf, t);
    if (d > 1 && !(t.length >= 6 && d === 2)) continue;
    const score = 1 - d / Math.max(vf.length, t.length);
    if (score < 0.75) continue;
    if (!best || score > best.score) {
      best = { id: idOf.get(v) ?? -1, score, value: v };
    }
  }
  return best && best.id >= 0 ? best : null;
};

/**
 * Parse OCR type line into ranked tokens using the generated vocabulary.
 * Multi-word subtypes are matched greedily longest-first.
 */
export const parseTypeLineReading = (
  raw: string,
  index: TypeIndex,
): TypeEvidence => {
  const normalizedText = normalizeTypeLineText(raw);
  const words = normalizedText.split(' ').filter(Boolean);
  const used = new Set<number>();
  const subtypes: RankedTypeToken[] = [];
  const cardTypes: RankedTypeToken[] = [];
  const supertypes: RankedTypeToken[] = [];

  // Longest subtype phrases first.
  const subtypeVocab = [...index.data.subtypes].sort((a, b) => b.length - a.length);
  for (let i = 0; i < words.length; i++) {
    if (used.has(i)) continue;
    let matched = false;
    for (const phrase of subtypeVocab) {
      const parts = phrase.split(' ');
      if (i + parts.length > words.length) continue;
      const slice = words.slice(i, i + parts.length).join(' ');
      const sliceFold = foldToken(slice);
      const phraseFold = foldToken(phrase);
      if (
        sliceFold === phraseFold ||
        editDistance(sliceFold, phraseFold) <= (phraseFold.length >= 8 ? 2 : 1)
      ) {
        const id = index.subtypeId.get(phrase);
        if (id == null) continue;
        for (let k = 0; k < parts.length; k++) used.add(i + k);
        subtypes.push({
          id,
          score: sliceFold === phraseFold ? 1 : 0.85,
          value: phrase,
        });
        matched = true;
        break;
      }
    }
    if (matched) continue;
  }

  for (let i = 0; i < words.length; i++) {
    if (used.has(i)) continue;
    const w = words[i];
    const st = fuzzyToken(w, index.data.supertypes, index.supertypeId);
    if (st) {
      used.add(i);
      supertypes.push(st);
      continue;
    }
    const ct = fuzzyToken(w, index.data.cardTypes, index.cardTypeId);
    if (ct) {
      used.add(i);
      cardTypes.push(ct);
      continue;
    }
    const su = fuzzyToken(w, index.data.subtypes, index.subtypeId);
    if (su) {
      used.add(i);
      subtypes.push(su);
    }
  }

  const confParts = [...supertypes, ...cardTypes, ...subtypes].map(t => t.score);
  const confidence = confParts.length
    ? confParts.reduce((a, b) => a + b, 0) / confParts.length
    : 0;

  return {
    cardTypes,
    confidence,
    normalizedText,
    rawText: raw,
    subtypes,
    supertypes,
  };
};
