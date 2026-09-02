// Cheap frame-quality signals.
//
// Phase A only *reports* these; nothing gates on them yet. They are here rather
// than in the camera module so the harness can compute the same numbers for a
// fixture that a phone computes for a live frame.

import type { ScanImage } from './types';

const luma = (data: Uint8ClampedArray, i: number) =>
  0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

/**
 * Rough focus score — higher is sharper. Variance of horizontal luminance
 * differences over a sampled mid-band; a full-frame Laplacian is too expensive
 * to run per frame on a phone at capture resolution.
 *
 * The absolute value is meaningless. It is only comparable between frames of the
 * same scene at the same resolution, which is exactly what best-frame selection
 * needs it for.
 *
 * Known limitation: sampling every fourth pixel aliases, so detail at exactly
 * that period reads as flat. Real photographs are broadband enough that this
 * does not matter in practice, but a synthetic grating will fool it.
 */
export const sharpnessScore = (image: ScanImage): number => {
  const { data, height, width } = image;
  const sampleH = Math.max(32, Math.floor(height * 0.35));
  const sampleY = Math.floor((height - sampleH) / 2);
  const from = sampleY * width * 4;
  const to = Math.min(data.length, from + sampleH * width * 4);
  if (to - from < 32) return 0;

  // Seed from the first sample rather than 0. Starting at 0 injects one
  // difference the size of the first pixel's brightness, which made a flat
  // bright frame outscore a flat dark one — a bias, since best-frame selection
  // is meant to be choosing focus, not exposure.
  let prev = luma(data, from);
  let sum = 0;
  let sumSquares = 0;
  let n = 0;
  for (let i = from + 16; i < to; i += 16) {
    const y = luma(data, i);
    const d = y - prev;
    sum += d;
    sumSquares += d * d;
    prev = y;
    n += 1;
  }
  if (n < 2) return 0;
  const mean = sum / n;
  return sumSquares / n - mean * mean;
};

/** Fraction of pixels at or near clipping — a proxy for glare and blown highlights. */
export const glareRatio = (image: ScanImage, threshold = 246): number => {
  const { data } = image;
  let hot = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 16) {
    if (luma(data, i) >= threshold) hot += 1;
    n += 1;
  }
  return n ? hot / n : 0;
};

/** Mean luminance, 0–255. Under/over-exposure shows up here before anywhere else. */
export const exposure = (image: ScanImage): number => {
  const { data } = image;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 16) {
    sum += luma(data, i);
    n += 1;
  }
  return n ? sum / n : 0;
};

export interface FrameQuality {
  /** Combined 0–1 score used to pick the best frame in a pool. */
  score: number;
  sharpness: number;
  glare: number;
  exposure: number;
  /**
   * Detector confidence for the frame, when known. Frames without a card score
   * 0 regardless of sharpness.
   */
  detectionScore: number;
}

/**
 * Rank a candidate recognition frame.
 *
 * Sharpness dominates; glare and extreme exposure penalize; a weak detection
 * cannot win even if the pixels look crisp (they may be crisp background).
 */
export const frameQualityScore = (
  image: ScanImage,
  detectionScore = 1,
): FrameQuality => {
  const sharp = sharpnessScore(image);
  const glare = glareRatio(image);
  const exp = exposure(image);
  // Sharpness dominates more aggressively — a crisp earlier frame must beat a
  // soft latest frame even when detection scores are similar.
  const sharpNorm = 1 - Math.exp(-sharp / 140);
  const glarePen = Math.min(1, glare / 0.18);
  const expPen =
    exp < 40 ? (40 - exp) / 40 : exp > 210 ? (exp - 210) / 45 : 0;
  const detect = Math.max(0, Math.min(1, detectionScore));
  const score = Math.max(
    0,
    sharpNorm *
      (1 - 0.55 * glarePen) *
      (1 - 0.4 * Math.min(1, expPen)) *
      (0.25 + 0.75 * detect),
  );
  return { detectionScore: detect, exposure: exp, glare, score, sharpness: sharp };
};

/**
 * Keep the best `limit` frames by quality score (newest wins ties so a fresher
 * equally-sharp frame replaces a stale one).
 */
export const pushQualityPool = <T extends { quality: FrameQuality }>(
  pool: readonly T[],
  item: T,
  limit: number,
): T[] =>
  [...pool, item]
    .sort((a, b) => b.quality.score - a.quality.score)
    .slice(0, Math.max(1, limit));

