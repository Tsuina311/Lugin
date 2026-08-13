// Observable, persisted index of cards the user has purchased before, built by
// scanning their Cardmarket order history. Matching is by card name (front
// face, lowercased — the same `cardKey` used elsewhere), so any printing of a
// previously-bought card counts as "purchased". Persisted to chrome.storage so
// it survives reloads and only needs an occasional (incremental) re-scan.
//
// The scan itself runs through the shared task queue (sequential + survives
// navigation); this store holds the data + a display status the queue drives.

import { type PurchaseIndex, type SyncProgress } from '@/sites/cardmarket/wants';

export type { PurchaseIndex };

export const PURCHASES_STORAGE_KEY = 'lugin:purchases';

export type PurchaseStatus = 'idle' | 'queued' | 'syncing' | 'done' | 'error';

interface PurchaseState {
  error: string | null;
  index: PurchaseIndex | null;
  progress: SyncProgress | null;
  status: PurchaseStatus;
}

let state: PurchaseState = { error: null, index: null, progress: null, status: 'idle' };
const listeners = new Set<() => void>();

const set = (partial: Partial<PurchaseState>) => {
  state = { ...state, ...partial };
  for (const l of listeners) l();
};

// Load any previously-synced index on startup.
void chrome.storage.local.get(PURCHASES_STORAGE_KEY).then(stored => {
  const index = stored[PURCHASES_STORAGE_KEY] as PurchaseIndex | undefined;
  if (index && state.status === 'idle') set({ index, status: 'done' });
});

export const purchaseStore = {
  abortSync() {
    set({ progress: null, status: state.index ? 'done' : 'idle' });
  },
  beginSync() {
    set({ error: null, progress: null, status: 'syncing' });
  },

  async clear() {
    await chrome.storage.local.remove(PURCHASES_STORAGE_KEY);
    set({ error: null, index: null, progress: null, status: 'idle' });
  },

  failSync(message: string) {
    set({ error: message, progress: null, status: 'error' });
  },

  async finishSync(index: PurchaseIndex) {
    await chrome.storage.local.set({ [PURCHASES_STORAGE_KEY]: index });
    set({ index, progress: null, status: 'done' });
  },

  getSnapshot(): PurchaseState {
    return state;
  },

  // ---- Driven by the task queue --------------------------------------------
  markQueued() {
    set({ error: null, progress: null, status: 'queued' });
  },

  setProgress(progress: SyncProgress) {
    set({ progress });
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
