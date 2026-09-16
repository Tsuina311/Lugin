/**
 * Bounded priority queue for skipped-attempt background work.
 * Live acquisition / current-card work stays outside this queue (caller priority).
 *
 * Priority (lower number = sooner):
 *   1 current visible recognition (rarely queued here)
 *   2 skipped recognition
 *   3 diagnostic PNG encode
 *   4 upload
 */

export type BackgroundJobKind = 'recognize' | 'encode' | 'upload';

export type BackgroundJobPriority = 1 | 2 | 3 | 4;

export type BackgroundJob = {
  id: string;
  kind: BackgroundJobKind;
  priority: BackgroundJobPriority;
  attemptId: number;
  enqueuedAt: number;
  run: () => Promise<void>;
};

export type BackgroundQueueLimits = {
  maxRecognize: number;
  maxEncode: number;
  maxUpload: number;
  /** Soft backlog — excess goes deferred (not dropped without telemetry). */
  maxPending: number;
};

export const DEFAULT_BACKGROUND_LIMITS: BackgroundQueueLimits = {
  maxRecognize: 1,
  maxEncode: 1,
  maxUpload: 2,
  maxPending: 12,
};

export type BackgroundQueueSnapshot = {
  pendingRecognitionJobs: number;
  activeRecognitionJobs: number;
  pendingEncodeJobs: number;
  activeEncodeJobs: number;
  pendingUploadJobs: number;
  activeUploadJobs: number;
  backgroundAttemptCount: number;
  backgroundDeferredCount: number;
  pendingTotal: number;
};

type Internal = {
  pending: BackgroundJob[];
  deferred: BackgroundJob[];
  active: Map<string, BackgroundJob>;
  limits: BackgroundQueueLimits;
  attemptIds: Set<number>;
};

const countKind = (jobs: BackgroundJob[], kind: BackgroundJobKind): number =>
  jobs.filter(j => j.kind === kind).length;

const activeOf = (m: Map<string, BackgroundJob>, kind: BackgroundJobKind): number => {
  let n = 0;
  for (const j of m.values()) if (j.kind === kind) n += 1;
  return n;
};

export const createBackgroundQueue = (
  limits: BackgroundQueueLimits = DEFAULT_BACKGROUND_LIMITS,
): {
  enqueue: (job: BackgroundJob) => { accepted: boolean; deferred: boolean };
  snapshot: () => BackgroundQueueSnapshot;
  /** Test helper — process until idle (or maxSteps). */
  drainForTests: (maxSteps?: number) => Promise<void>;
  clear: () => void;
} => {
  const state: Internal = {
    pending: [],
    deferred: [],
    active: new Map(),
    limits,
    attemptIds: new Set(),
  };

  const sortPending = () => {
    state.pending.sort((a, b) => a.priority - b.priority || a.enqueuedAt - b.enqueuedAt);
  };

  const limitFor = (kind: BackgroundJobKind): number => {
    if (kind === 'recognize') return state.limits.maxRecognize;
    if (kind === 'encode') return state.limits.maxEncode;
    return state.limits.maxUpload;
  };

  const pump = (): void => {
    sortPending();
    for (let i = 0; i < state.pending.length; ) {
      const job = state.pending[i]!;
      if (activeOf(state.active, job.kind) >= limitFor(job.kind)) {
        i += 1;
        continue;
      }
      state.pending.splice(i, 1);
      state.active.set(job.id, job);
      state.attemptIds.add(job.attemptId);
      void job
        .run()
        .catch(() => {
          /* job owns error handling */
        })
        .finally(() => {
          state.active.delete(job.id);
          // Promote deferred if capacity.
          while (
            state.deferred.length > 0 &&
            state.pending.length + state.active.size < state.limits.maxPending
          ) {
            const d = state.deferred.shift()!;
            state.pending.push(d);
          }
          pump();
        });
    }
  };

  return {
    enqueue(job) {
      const depth = state.pending.length + state.active.size;
      if (depth >= state.limits.maxPending) {
        state.deferred.push(job);
        state.attemptIds.add(job.attemptId);
        return { accepted: true, deferred: true };
      }
      state.pending.push(job);
      state.attemptIds.add(job.attemptId);
      pump();
      return { accepted: true, deferred: false };
    },
    snapshot() {
      const pending = state.pending;
      const active = state.active;
      return {
        pendingRecognitionJobs: countKind(pending, 'recognize'),
        activeRecognitionJobs: activeOf(active, 'recognize'),
        pendingEncodeJobs: countKind(pending, 'encode'),
        activeEncodeJobs: activeOf(active, 'encode'),
        pendingUploadJobs: countKind(pending, 'upload'),
        activeUploadJobs: activeOf(active, 'upload'),
        backgroundAttemptCount: state.attemptIds.size,
        backgroundDeferredCount: state.deferred.length,
        pendingTotal: pending.length + active.size + state.deferred.length,
      };
    },
    async drainForTests(maxSteps = 50) {
      for (let i = 0; i < maxSteps; i++) {
        if (state.pending.length === 0 && state.active.size === 0 && state.deferred.length === 0) {
          return;
        }
        pump();
        await new Promise(r => setTimeout(r, 0));
      }
    },
    clear() {
      state.pending = [];
      state.deferred = [];
      state.active.clear();
      state.attemptIds.clear();
    },
  };
};

/** Module singleton for the phone app. */
let shared: ReturnType<typeof createBackgroundQueue> | null = null;

export const getScanBackgroundQueue = (): ReturnType<typeof createBackgroundQueue> => {
  if (!shared) shared = createBackgroundQueue();
  return shared;
};

export const resetScanBackgroundQueueForTests = (): void => {
  shared?.clear();
  shared = createBackgroundQueue();
};
