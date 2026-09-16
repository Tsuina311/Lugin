/**
 * Persist / report helpers for Geometry Test capture-unsafe intervals.
 * Reasons stay machine-stable; labels match operator-facing HUD copy.
 */

import type { CaptureUnsafeReason } from './captureSafe';

/** Operator-facing reason keys for reports (matches HUD copy style). */
export const CAPTURE_UNSAFE_REASON_LABEL: Record<CaptureUnsafeReason, string> = {
  no_geometry: 'WAITING_FOR_GEOMETRY',
  out_of_frame: 'MOVE_CARD_INTO_FRAME',
  near_edge: 'TOO_CLOSE_TO_EDGE',
  source_near_edge: 'SOURCE_MARGIN_TIGHT',
  too_small: 'CARD_TOO_SMALL',
  too_large: 'CARD_TOO_LARGE',
  extreme_angle: 'ANGLE_TOO_EXTREME',
  non_convex: 'ANGLE_TOO_EXTREME',
  weak_support: 'WEAK_SUPPORT',
};

export const labelCaptureUnsafeReason = (reason: string): string =>
  CAPTURE_UNSAFE_REASON_LABEL[reason as CaptureUnsafeReason] ?? reason.toUpperCase();

export const accumulateUnsafeReasonMs = (
  acc: Record<string, number>,
  reasons: string[],
  dtMs: number,
): Record<string, number> => {
  if (!(dtMs > 0) || !reasons.length) return acc;
  const next = { ...acc };
  for (const r of reasons) {
    next[r] = (next[r] ?? 0) + dtMs;
  }
  return next;
};

export const dominantUnsafeReason = (acc: Record<string, number> | null | undefined): string | null => {
  if (!acc) return null;
  let best: string | null = null;
  let bestMs = -1;
  for (const [k, v] of Object.entries(acc)) {
    if (typeof v === 'number' && v > bestMs) {
      bestMs = v;
      best = k;
    }
  }
  return best;
};

/** Report-friendly map using HUD labels as keys. */
export const labeledUnsafeReasonMs = (
  acc: Record<string, number> | null | undefined,
): Record<string, number> => {
  const out: Record<string, number> = {};
  if (!acc) return out;
  for (const [k, v] of Object.entries(acc)) {
    const label = labelCaptureUnsafeReason(k);
    out[label] = (out[label] ?? 0) + v;
  }
  return out;
};
