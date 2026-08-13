// Running the sync, and holding the little bit of state the UI shows for it.
//
// The reconciliation lives here rather than in the worker because this is where
// the data is: the stores, and the preferences that sit in the page's own
// localStorage. The worker only supplies the token and the network.

import { AuthError } from '@/core/sync/auth';
import { createSyncEngine, type SyncReport } from '@/core/sync/engine';
import { UnsupportedSchemaError } from '@/core/sync/repository';
import { createChromeLocalRepository } from '@/platform/chrome/localRepository';
import {
  connectGoogle,
  createRemoteRepository,
  disconnectGoogle,
  googleStatus,
} from '@/platform/chrome/remoteRepository';

export interface SyncState {
  /** Set while a sync is running, so the UI can say so and not start another. */
  busy: boolean;
  connected: boolean;
  error: string | null;
  lastSyncedAt: number | null;
  /** What the last sync did, in a few words, or null if it hasn't run. */
  summary: string | null;
}

/** The bookkeeping key the change watcher stamps; see the platform repository. */
const RECORD_KEY = 'lugin:sync';
const LOCK_KEY = 'lugin:syncLock';
const STAMP_KEY = 'lugin:syncStamp';

/** Long enough for a slow sync, short enough that a dead tab isn't fatal. */
const LOCK_TTL_MS = 60_000;

/** How long after an edit to sync, so a burst of edits is one upload. */
const SETTLE_MS = 20_000;

/** A page left open shouldn't sit on the other device's stale data forever. */
const POLL_MS = 5 * 60_000;

let state: SyncState = {
  busy: false,
  connected: false,
  error: null,
  lastSyncedAt: null,
  summary: null,
};

const listeners = new Set<() => void>();
const set = (partial: Partial<SyncState>) => {
  state = { ...state, ...partial };
  for (const l of listeners) l();
};

const local = createChromeLocalRepository();
const engine = createSyncEngine({ local, remote: createRemoteRepository() });

// Every Cardmarket tab runs this. Without a lock they'd all wake for the same
// change, and each would lose the race the others started.
const runner = Math.random().toString(36).slice(2);

const claimLock = async (): Promise<boolean> => {
  const stored = await chrome.storage.local.get(LOCK_KEY);
  const held = stored[LOCK_KEY] as { at: number; runner: string } | undefined;
  if (held && Date.now() - held.at < LOCK_TTL_MS && held.runner !== runner) return false;
  await chrome.storage.local.set({ [LOCK_KEY]: { at: Date.now(), runner } });
  return true;
};

const releaseLock = async (): Promise<void> => {
  const stored = await chrome.storage.local.get(LOCK_KEY);
  const held = stored[LOCK_KEY] as { runner: string } | undefined;
  if (held?.runner === runner) await chrome.storage.local.remove(LOCK_KEY);
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Turn what happened into something worth reading. */
const describe = (report: SyncReport): string => {
  if (report.seeded) return 'Copied this device’s data to your Google account.';
  const parts: string[] = [];
  if (report.applied.length > 0) parts.push(`brought in ${report.applied.join(', ')}`);
  if (report.pushed.length > 0) parts.push(`sent ${report.pushed.join(', ')}`);
  if (parts.length === 0) return 'Already up to date.';
  const note =
    report.conflicted.length > 0
      ? ` ${plural(report.conflicted.length, 'change')} differed on both devices; the older ${
          report.conflicted.length === 1 ? 'version was' : 'versions were'
        } kept in your Google account.`
      : '';
  return `Synced — ${parts.join(' and ')}.${note}`;
};

const message = (err: unknown): string => {
  if (err instanceof AuthError) {
    return err.failure === 'no-session'
      ? 'Google needs you to sign in again — reconnect to carry on syncing.'
      : err.message;
  }
  if (err instanceof UnsupportedSchemaError) {
    return 'Your other device is running a newer version. Update this one — nothing was changed here.';
  }
  return err instanceof Error ? err.message : String(err);
};

let settle: ReturnType<typeof setTimeout> | null = null;

const run = async (reason: 'auto' | 'user'): Promise<void> => {
  if (state.busy || !state.connected) return;
  // A tab that can't get the lock isn't failing — another tab is doing the work
  // and will write the result where this one can see it.
  if (!(await claimLock())) return;

  set({ busy: true, error: reason === 'user' ? null : state.error });
  try {
    const report = await engine.sync();
    const at = Date.now();
    await chrome.storage.local.set({ [STAMP_KEY]: at });
    set({ error: null, lastSyncedAt: at, summary: describe(report) });
  } catch (err) {
    set({ error: message(err) });
  } finally {
    set({ busy: false });
    await releaseLock();
  }
};

/** Sync soon, once the edits stop. */
const scheduleSync = () => {
  if (!state.connected) return;
  if (settle) clearTimeout(settle);
  settle = setTimeout(() => void run('auto'), SETTLE_MS);
};

export const syncStore = {
  /** Ask for access, then immediately carry this device's data up. */
  async connect(): Promise<void> {
    set({ busy: true, error: null });
    let connected = false;
    try {
      connected = await connectGoogle();
    } catch (err) {
      set({ error: message(err) });
    } finally {
      set({ busy: false, connected });
    }
    // The first sync is also the moment preferences that have only ever existed
    // in this browser's local storage travel anywhere. Nothing is moved or
    // cleared: they keep working exactly where they are.
    if (connected) {
      await run('user');
      // Connecting mid-session has to start the watching a connected page would
      // have started on load, or nothing would sync again until a reload.
      beginWatching();
    }
  },

  /** Stop syncing. Leaves both this device's data and the Drive copy alone. */
  async disconnect(): Promise<void> {
    if (settle) clearTimeout(settle);
    try {
      await disconnectGoogle();
    } catch (err) {
      set({ error: message(err) });
    }
    set({ connected: false, summary: null });
  },

  getSnapshot(): SyncState {
    return state;
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Sync now, because the user asked. */
  async syncNow(): Promise<void> {
    await run('user');
  },
};

/** Did this storage change mean "the user edited something"? */
const isLocalEdit = (change: chrome.storage.StorageChange): boolean => {
  const now = (change.newValue as { meta?: { dirtyAt?: string | null } } | undefined)?.meta?.dirtyAt;
  const before = (change.oldValue as { meta?: { dirtyAt?: string | null } } | undefined)?.meta
    ?.dirtyAt;
  // A sync writes this record too. Only a fresh dirty stamp means new work —
  // without that test, finishing a sync would schedule the next one forever.
  return now != null && now !== before;
};

let watching = false;

/** React to local edits and to time passing. Safe to call more than once. */
const beginWatching = (): void => {
  if (watching) return;
  watching = true;

  setInterval(() => void run('auto'), POLL_MS);
  chrome.storage.onChanged.addListener((changes, area) => {
    const change = changes[RECORD_KEY];
    if (area !== 'local' || !change) return;
    if (isLocalEdit(change)) scheduleSync();
  });
};

/**
 * Start watching, once per page.
 *
 * Does nothing until an account is connected: no messages to the worker, no
 * timers, and — since the token lives in the worker — nothing that could prompt
 * the user out of nowhere.
 */
export const startSync = (): void => {
  void (async () => {
    const [connected, stored] = await Promise.all([
      googleStatus().catch(() => false),
      chrome.storage.local.get(STAMP_KEY),
    ]);
    set({ connected, lastSyncedAt: (stored[STAMP_KEY] as number | undefined) ?? null });
    if (!connected) return;

    // Catch up on whatever the other device did while this page was closed.
    await run('auto');
    beginWatching();
  })();
};
