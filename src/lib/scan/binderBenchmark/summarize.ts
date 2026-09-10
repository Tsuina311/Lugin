/** Binder Benchmark host summary helpers (geometry metrics filled by replay). */

import type { BinderBenchmarkBundle } from './types';

export const summarizeBinderCapture = (bundle: BinderBenchmarkBundle) => ({
  fixtureId: bundle.fixtureId,
  pages: bundle.pages.length,
  targetPages: bundle.targetPages,
  totalFrames: bundle.pages.reduce((n, p) => n + p.frames.length, 0),
  layout: bundle.layout,
  captureSource: bundle.captureSource,
  frameCadenceMs: bundle.frameCadenceMs,
  captureDurationMs: bundle.captureDurationMs,
  perPage: bundle.pages.map(p => ({
    pageIndex: p.pageIndex,
    frames: p.frames.length,
    durationMs: p.captureDurationMs,
  })),
});
