/** Binder Benchmark host summary helpers (geometry metrics filled by replay). */

import {
  binderPageCaptureTotals,
  summarizeBinderLatencies,
} from './capturePolicy';
import type { BinderBenchmarkBundle } from './types';

export const summarizeBinderCapture = (bundle: BinderBenchmarkBundle) => {
  const perPage = bundle.pages.map(p => {
    const totals = binderPageCaptureTotals(p);
    return {
      pageIndex: p.pageIndex,
      frames: p.frames.length,
      requestedFrames: totals.requestedFrames,
      savedFrames: totals.savedFrames,
      failedFrames: totals.failedFrames,
      status: totals.status,
      durationMs: p.captureDurationMs,
      stopReason: p.stopReason ?? null,
      latencies: totals.latencies,
    };
  });
  const allFrames = bundle.pages.flatMap(p => p.frames);
  return {
    fixtureId: bundle.fixtureId,
    pages: bundle.pages.length,
    targetPages: bundle.targetPages,
    totalFrames: allFrames.length,
    layout: bundle.layout,
    captureSource: bundle.captureSource,
    targetFramesPerPage: bundle.targetFramesPerPage ?? null,
    minFramesOk: bundle.minFramesOk ?? null,
    maxPageMs: bundle.maxPageMs ?? null,
    /** Legacy fields — may be fictional on old bundles. */
    frameCadenceMs: bundle.frameCadenceMs,
    captureDurationMs: bundle.captureDurationMs,
    pageStatusCounts: {
      COMPLETE: perPage.filter(p => p.status === 'COMPLETE').length,
      SPARSE: perPage.filter(p => p.status === 'SPARSE').length,
      FAILED: perPage.filter(p => p.status === 'FAILED').length,
    },
    latencies: summarizeBinderLatencies(allFrames),
    perPage,
  };
};
