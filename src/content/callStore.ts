import type { CapturedCall } from '@/lib/types';

// A minimal external store (compatible with React's useSyncExternalStore) that
// holds the captured calls. The content script pushes updates in; the overlay
// React tree reads from it. Kept outside React so capture keeps working even
// when the overlay is closed/unmounted.

const MAX_CALLS = 500; // ring-buffer cap to bound memory on chatty sites.

let calls: CapturedCall[] = [];
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

export const callStore = {
  clear() {
    calls = [];
    emit();
  },

  /** Merge the finished call over its pending entry (matched by id). */
  end(call: CapturedCall) {
    const idx = calls.findIndex(c => c.id === call.id);
    if (idx === -1) {
      calls = [call, ...calls].slice(0, MAX_CALLS);
    } else {
      const next = calls.slice();
      next[idx] = { ...next[idx], ...call };
      calls = next;
    }
    emit();
  },

  getSnapshot(): CapturedCall[] {
    return calls;
  },

  /** Insert a new pending call (newest first). */
  start(call: CapturedCall) {
    calls = [call, ...calls].slice(0, MAX_CALLS);
    emit();
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
