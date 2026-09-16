/**
 * Lightweight Continuous diagnostic enqueue scaffold.
 * Full PNG encode/upload uses existing bounded backgroundQueue — never blocks live CLIP.
 */

import { getScanBackgroundQueue } from '@/lib/scan/backgroundQueue';
import { monoNow } from '@/lib/scan/timing';

export type ContinuousDiagMeta = {
  trackId: number;
  publishedIdentity: string | null;
  publishSource: string | null;
  confidence: number | null;
  artCropVariant: string | null;
  visualTop1: string | null;
  visualMargin: number | null;
  timing: Record<string, number | null>;
  parentSessionId: string;
};

let autoUpload = false;

export const getContinuousAutoUpload = (): boolean => autoUpload;
export const setContinuousAutoUpload = (on: boolean): boolean => {
  autoUpload = on;
  return autoUpload;
};

/**
 * Schedule a metadata-only diagnostic job (encode/upload later when artifacts exist).
 * Priority 4 = upload tier — after recognize work.
 */
export const enqueueContinuousDiagMeta = (meta: ContinuousDiagMeta): void => {
  if (!autoUpload) return;
  getScanBackgroundQueue().enqueue({
    id: `continuous-meta-${meta.parentSessionId}-${meta.trackId}-${Date.now()}`,
    kind: 'upload',
    priority: 4,
    attemptId: meta.trackId,
    enqueuedAt: monoNow(),
    run: async () => {
      // Placeholder: wire to inbox session writer when Continuous PNG artifacts land.
      // Intentionally no-op body so live scanner is never blocked by missing upload plumbing.
      void meta;
    },
  });
};
