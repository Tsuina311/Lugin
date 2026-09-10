/** One clock for scanner durations. Never subtract Date.now from performance.now. */

const DAY_MS = 24 * 60 * 60 * 1000;

export const monoNow = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

/**
 * Duration on a single time basis. Rejects epoch-minus-monotonic mixes
 * (those land near 1.7e12) and other non-physical spans.
 */
export const durationMs = (
  start: number | null | undefined,
  end: number | null | undefined,
): number | null => {
  if (start == null || end == null || !Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  const d = end - start;
  if (d < -1 || d > DAY_MS) return null;
  return d;
};
