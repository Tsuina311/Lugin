/**
 * Host-proven Continuous fusion (Phase A bakeoff → Phase B publish rules).
 *
 * Publish when:
 *   1. strong visual margin alone
 *   2. OCR + visual agree on identity
 *   3. OCR exact while visual is weak / missing
 * Wait (no publish) on disagreement.
 */

import type { ContinuousIdentity, PublishSource } from './types';

/** Cosine / score margin: top1 − top2 (visual retrieval). */
export const CONTINUOUS_VISUAL_STRONG_SCORE = 0.82;
export const CONTINUOUS_VISUAL_STRONG_MARGIN = 0.12;
/** Below this, visual is treated as weak for OCR-exact fallback. */
export const CONTINUOUS_VISUAL_WEAK_SCORE = 0.55;
/** Exact (or near-exact) OCR title that can publish alone when visual is weak. */
export const CONTINUOUS_OCR_EXACT_SCORE = 0.94;

export type ContinuousVisualEvidence = {
  name: string;
  oracleId?: string | null;
  score: number;
  margin?: number | null;
};

export type ContinuousOcrEvidence = {
  name: string;
  oracleId?: string | null;
  score: number;
  exact?: boolean;
};

export type FuseContinuousArgs = {
  visual: ContinuousVisualEvidence | null;
  ocr: ContinuousOcrEvidence | null;
};

export type FuseContinuousResult = {
  identity: ContinuousIdentity | null;
  confidence: number;
  source: PublishSource | null;
  publish: boolean;
  reason: string;
};

const fold = (raw: string): string =>
  String(raw || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]/gu, '');

export const continuousIdentitiesAgree = (
  a: { name: string; oracleId?: string | null } | null | undefined,
  b: { name: string; oracleId?: string | null } | null | undefined,
): boolean => {
  if (!a?.name || !b?.name) return false;
  if (a.oracleId && b.oracleId && a.oracleId === b.oracleId) return true;
  const fa = fold(a.name);
  const fb = fold(b.name);
  if (fa && fb && fa === fb) return true;
  if (fa && fb && (fa.startsWith(fb) || fb.startsWith(fa)) && Math.min(fa.length, fb.length) >= 8) {
    return true;
  }
  return false;
};

const asIdentity = (
  e: { name: string; oracleId?: string | null },
): ContinuousIdentity => ({
  name: e.name,
  oracleId: e.oracleId ?? null,
});

/**
 * Fuse one visual + one OCR observation into a publish decision.
 * Pure — no track mutation.
 */
export const fuseContinuousEvidence = (args: FuseContinuousArgs): FuseContinuousResult => {
  const { visual, ocr } = args;
  const wait = (reason: string): FuseContinuousResult => ({
    identity: null,
    confidence: 0,
    source: null,
    publish: false,
    reason,
  });

  if (!visual && !ocr) return wait('no_evidence');

  const visualStrong =
    visual != null &&
    visual.score >= CONTINUOUS_VISUAL_STRONG_SCORE &&
    (visual.margin == null || visual.margin >= CONTINUOUS_VISUAL_STRONG_MARGIN);

  const visualWeak =
    !visual ||
    visual.score < CONTINUOUS_VISUAL_WEAK_SCORE ||
    (visual.margin != null && visual.margin < 0.04 && visual.score < CONTINUOUS_VISUAL_STRONG_SCORE);

  const ocrExact =
    ocr != null &&
    (ocr.exact === true || ocr.score >= CONTINUOUS_OCR_EXACT_SCORE);

  // 2. OCR + visual agree → publish DUAL (prefer max confidence).
  if (visual && ocr && continuousIdentitiesAgree(visual, ocr)) {
    return {
      identity: asIdentity(visual.score >= ocr.score ? visual : ocr),
      confidence: Math.max(visual.score, ocr.score),
      source: 'DUAL',
      publish: true,
      reason: 'ocr_visual_agree',
    };
  }

  // 1. Strong visual margin alone.
  if (visualStrong && visual) {
    // Disagreement with a confident OCR → wait (do not false-publish).
    if (ocr && ocr.score >= 0.75 && !continuousIdentitiesAgree(visual, ocr)) {
      return wait('disagreement');
    }
    return {
      identity: asIdentity(visual),
      confidence: visual.score,
      source: 'VISUAL',
      publish: true,
      reason: 'strong_visual_margin',
    };
  }

  // 3. OCR exact while visual weak / missing.
  if (ocrExact && ocr && visualWeak) {
    return {
      identity: asIdentity(ocr),
      confidence: ocr.score,
      source: 'OCR',
      publish: true,
      reason: 'ocr_exact_visual_weak',
    };
  }

  // Disagreement: both present, neither rule fires cleanly.
  if (visual && ocr && !continuousIdentitiesAgree(visual, ocr)) {
    return wait('disagreement');
  }

  return wait('insufficient');
};
