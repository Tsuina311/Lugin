import type { ExtractionResult } from '@/sites/types';

// Observable store holding the most recent extraction result for the page.
// Mirrors callStore's shape so the overlay can subscribe with useSyncExternalStore.

let current: ExtractionResult | null = null;
const listeners = new Set<() => void>();

export const pageDataStore = {
  getSnapshot(): ExtractionResult | null {
    return current;
  },
  set(result: ExtractionResult) {
    current = result;
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
