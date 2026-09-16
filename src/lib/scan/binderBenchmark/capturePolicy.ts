/** Frame-driven Binder Benchmark capture policy (phone + host). */

import type { BinderFrameMeta, BinderPageRecord, BinderPageStatus } from './types';

/** Realistic target given ~2–5s takeSnapshot+PNG cost on Samsung. */
export const BINDER_TARGET_FRAMES = 5;
/** Minimum frames to accept a page when max duration hits (else FAILED). */
export const BINDER_MIN_FRAMES_OK = 3;
/**
 * Safety cap per page. At ~3–5s/frame, 5 frames ≈ 15–25s; leave headroom for
 * retries and AF. Not a fictional 2.7s wall clock.
 */
export const BINDER_MAX_PAGE_MS = 40_000;
/**
 * Auto-advance between binder pages is disabled — next page starts only on
 * explicit NEXT PAGE tap (avoids contaminating first frames while turning).
 */
export const BINDER_AUTO_ADVANCE_PAGES = false;
/** @deprecated Always disabled; kept so old imports do not auto-advance. */
export const BINDER_TURN_AUTO_MS = 0;

/** @deprecated Fictional cadence — kept only for reading older bundles. */
export const BINDER_LEGACY_CADENCE_MS = 280;
/** @deprecated Fictional page duration — kept only for reading older bundles. */
export const BINDER_LEGACY_CAPTURE_MS = 2700;

export type BinderAfterSaveAction = 'await-next-page' | 'await-finish' | 'retry';

/** After all writes finish for a page, decide the waiting UX (never auto-capture). */
export const binderAfterSaveAction = (args: {
  status: BinderPageStatus;
  savedNonFailedPages: number;
  targetPages: number;
}): BinderAfterSaveAction => {
  if (args.status === 'FAILED') return 'retry';
  if (args.savedNonFailedPages >= args.targetPages) return 'await-finish';
  return 'await-next-page';
};

/**
 * Next-page capture must be explicitly triggered. TURN PAGE / page-saved alone
 * must not start snapshots (BINDER_AUTO_ADVANCE_PAGES is false).
 */
export const binderCanStartNextPageCapture = (args: {
  phase: string;
  capturing: boolean;
  explicitNextTap: boolean;
}): boolean => {
  if (args.capturing) return false;
  if (!args.explicitNextTap) return false;
  return args.phase === 'turn-page' || args.phase === 'waiting-next';
};

export const classifyBinderPageStatus = (
  savedFrames: number,
  targetFrames: number = BINDER_TARGET_FRAMES,
  minOk: number = BINDER_MIN_FRAMES_OK,
): BinderPageStatus => {
  if (savedFrames >= targetFrames) return 'COMPLETE';
  if (savedFrames >= minOk) return 'SPARSE';
  return 'FAILED';
};

export const shouldStopBinderCapture = (args: {
  savedFrames: number;
  failedFrames: number;
  elapsedMs: number;
  targetFrames?: number;
  maxPageMs?: number;
}): { stop: boolean; reason: 'target' | 'max-time' | null } => {
  const target = args.targetFrames ?? BINDER_TARGET_FRAMES;
  const maxMs = args.maxPageMs ?? BINDER_MAX_PAGE_MS;
  if (args.savedFrames >= target) return { stop: true, reason: 'target' };
  if (args.elapsedMs >= maxMs) return { stop: true, reason: 'max-time' };
  return { stop: false, reason: null };
};

export const percentile = (sorted: number[], p: number): number | null => {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0]!;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
};

export type BinderLatencySummary = {
  snapshotMs: { p50: number | null; max: number | null; n: number };
  encodeWriteMs: { p50: number | null; max: number | null; n: number };
  totalFrameMs: { p50: number | null; max: number | null; n: number };
};

export const summarizeBinderLatencies = (
  frames: Array<Pick<BinderFrameMeta, 'snapshotMs' | 'encodeWriteMs' | 'totalFrameMs'>>,
): BinderLatencySummary => {
  const pick = (key: 'snapshotMs' | 'encodeWriteMs' | 'totalFrameMs') => {
    const vals = frames
      .map(f => f[key])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      .sort((a, b) => a - b);
    return {
      p50: percentile(vals, 50),
      max: vals.length ? vals[vals.length - 1]! : null,
      n: vals.length,
    };
  };
  return {
    snapshotMs: pick('snapshotMs'),
    encodeWriteMs: pick('encodeWriteMs'),
    totalFrameMs: pick('totalFrameMs'),
  };
};

export const binderPageCaptureTotals = (page: BinderPageRecord) => ({
  requestedFrames: page.requestedFrames ?? page.targetFrameCount,
  savedFrames: page.savedFrames ?? page.frames.length,
  failedFrames: page.failedFrames ?? 0,
  status: page.status ?? classifyBinderPageStatus(page.frames.length),
  latencies: summarizeBinderLatencies(page.frames),
});
