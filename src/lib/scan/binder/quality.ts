/**
 * Per-card IDENTIFICATION_READY quality — not identity recognition.
 * Conservative: false green is worse than leaving amber.
 *
 * Note: Single-card CAPTURE_SAFE occupancy floors are wrong for binder pages
 * (each pocket is ~1/9 of the frame). Binder uses a looser in-frame gate.
 */

import { cornersToQuad, dist } from '../geometry';
import { glareRatio, sharpnessScore } from '../quality';
import type { CardCorners, ScanImage } from '../types';
import {
  BINDER_IDENTIFICATION_READY_MIN,
  BINDER_SHARPNESS_GOOD,
  BINDER_SHARPNESS_SOFT,
  type BinderQualityScore,
} from './types';

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** Binder pocket-scale geometry gate (not Single Scan occupancy). */
export const binderGeometryOk = (
  corners: CardCorners,
  frame: { width: number; height: number },
): { ok: boolean; reasons: string[] } => {
  const reasons: string[] = [];
  const q = cornersToQuad(corners);
  const w = frame.width;
  const h = frame.height;
  let out = false;
  let near = false;
  const margin = 0.01 * Math.min(w, h);
  for (const p of q) {
    if (p.x < -2 || p.y < -2 || p.x > w + 2 || p.y > h + 2) out = true;
    const m = Math.min(p.x, p.y, w - p.x, h - p.y);
    if (m < margin) near = true;
  }
  if (out) reasons.push('out_of_frame');
  if (near) reasons.push('near_edge');
  const area =
    Math.abs(
      q[0].x * q[1].y -
        q[1].x * q[0].y +
        (q[1].x * q[2].y - q[2].x * q[1].y) +
        (q[2].x * q[3].y - q[3].x * q[2].y) +
        (q[3].x * q[0].y - q[0].x * q[3].y),
    ) / 2;
  const occ = area / Math.max(1, w * h);
  if (occ < 0.015) reasons.push('too_small');
  if (occ > 0.45) reasons.push('too_large');
  const top = dist(q[0], q[1]);
  const bot = dist(q[3], q[2]);
  const left = dist(q[0], q[3]);
  const right = dist(q[1], q[2]);
  const sideRatio =
    Math.max(top, bot, left, right) / Math.max(1e-3, Math.min(top, bot, left, right));
  if (sideRatio > 3.2) reasons.push('extreme_angle');
  return { ok: reasons.length === 0, reasons };
};

export const scoreBinderCardQuality = (args: {
  corners: CardCorners;
  frame: { width: number; height: number };
  warp: ScanImage;
}): BinderQualityScore => {
  const reasons: string[] = [];
  const geom = binderGeometryOk(args.corners, args.frame);
  const captureSafe = geom.ok ? 1 : 0;
  if (!geom.ok) reasons.push(...geom.reasons.map(r => `geom:${r}`));

  const sharp = sharpnessScore(args.warp);
  let sharpness = 0;
  if (sharp >= BINDER_SHARPNESS_GOOD) sharpness = 1;
  else if (sharp >= BINDER_SHARPNESS_SOFT) {
    sharpness =
      0.45 +
      0.55 *
        ((sharp - BINDER_SHARPNESS_SOFT) /
          (BINDER_SHARPNESS_GOOD - BINDER_SHARPNESS_SOFT));
  } else {
    sharpness = clamp01(sharp / BINDER_SHARPNESS_SOFT) * 0.4;
    reasons.push('soft');
  }

  const glare = glareRatio(args.warp);
  const glareComp = clamp01(1 - glare * 2.2);
  if (glare > 0.22) reasons.push('glare');

  const px = args.warp.width * args.warp.height;
  const size = px >= 744 * 1039 * 0.95 ? 1 : clamp01(px / (744 * 1039));
  if (size < 0.95) reasons.push('undersized-warp');

  const components = {
    captureSafe,
    geometry: captureSafe,
    glare: glareComp,
    sharpness,
    size,
  };

  const score =
    0.35 * captureSafe +
    0.15 * captureSafe +
    0.3 * sharpness +
    0.15 * glareComp +
    0.05 * size;

  const identificationReady =
    captureSafe === 1 &&
    score >= BINDER_IDENTIFICATION_READY_MIN &&
    sharp >= BINDER_SHARPNESS_SOFT &&
    glareComp >= 0.45;

  if (!identificationReady && captureSafe === 1 && sharp < BINDER_SHARPNESS_SOFT) {
    reasons.push('not-sharp-enough');
  }

  return { score, components, reasons, identificationReady };
};

export const binderSharpnessOf = (warp: ScanImage): number => sharpnessScore(warp);
