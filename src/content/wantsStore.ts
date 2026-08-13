import { type SyncProgress, type WantsIndex } from '@/sites/cardmarket/wants';

// Observable store for the user's want-list index. Persists to chrome.storage
// so a sync survives page reloads (it's expensive to rebuild). Mirrors the
// useSyncExternalStore contract used elsewhere.
//
// The actual sync now runs through the shared task queue (so it's sequential
// and survives navigation); this store only holds the data + a display status
// that the queue drives via begin/setProgress/finish/fail/abort.

export const WANTS_STORAGE_KEY = 'lugin:wantsIndex';

export type SyncStatus = 'idle' | 'queued' | 'syncing' | 'done' | 'error';

interface WantsState {
  error: string | null;
  index: WantsIndex | null;
  progress: SyncProgress | null;
  status: SyncStatus;
}

let state: WantsState = { error: null, index: null, progress: null, status: 'idle' };
const listeners = new Set<() => void>();

const set = (partial: Partial<WantsState>) => {
  state = { ...state, ...partial };
  for (const l of listeners) l();
};

// Load any previously-synced index on startup.
void chrome.storage.local.get(WANTS_STORAGE_KEY).then(stored => {
  const index = stored[WANTS_STORAGE_KEY] as WantsIndex | undefined;
  if (index && state.status === 'idle') set({ index, status: 'done' });
});

export const wantsStore = {
  abortSync() {
    set({ progress: null, status: state.index ? 'done' : 'idle' });
  },
  /** Replace the index in place (e.g. after removing wants) and persist it. */
  async applyIndex(index: WantsIndex) {
    await chrome.storage.local.set({ [WANTS_STORAGE_KEY]: index });
    set({ index });
  },

  beginSync() {
    set({ error: null, progress: null, status: 'syncing' });
  },

  async clear() {
    await chrome.storage.local.remove(WANTS_STORAGE_KEY);
    set({ error: null, index: null, progress: null, status: 'idle' });
  },

  failSync(message: string) {
    set({ error: message, progress: null, status: 'error' });
  },

  async finishSync(index: WantsIndex) {
    await chrome.storage.local.set({ [WANTS_STORAGE_KEY]: index });
    set({ index, progress: null, status: 'done' });
  },

  getSnapshot(): WantsState {
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
