
import { COMBO_CACHE_KEY, COMBO_CACHE_MAX_AGE_MS, type ComboCache } from './cache';
import { downloadTwoCardIndex, type ComboJsonGet } from './download';
import { parseComboBundle } from './parse';
import type { ComboBundle } from './types';

import { requestApi } from '@/lib/messaging';

export interface ComboIndexSnapshot {
  bundle: ComboBundle | null;
  error: string | null;
  loading: boolean;
}

const listeners = new Set<() => void>();
let snapshot: ComboIndexSnapshot = { bundle: null, error: null, loading: false };
let pending: Promise<void> | null = null;

const publish = (next: ComboIndexSnapshot): void => {
  snapshot = next;
  for (const listener of listeners) listener();
};

const install = (value: unknown): boolean => {
  try {
    const bundle = parseComboBundle(value);
    publish({ bundle, error: null, loading: false });
    return true;
  } catch (error) {
    publish({
      bundle: snapshot.bundle,
      error: error instanceof Error ? error.message : 'Combo index rejected',
      loading: false,
    });
    return false;
  }
};

const isExtension = (): boolean => typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);

/** One Spellbook page at a time, through the worker. The page itself cannot call that host. */
const viaWorker: ComboJsonGet = async url => {
  const result = await requestApi({ headers: { Accept: 'application/json' }, url });
  if (!result.ok) throw new Error(`Spellbook ${result.status}`);
  return JSON.parse(result.body) as unknown;
};

const IDB = 'lugin-combos';
const IDB_STORE = 'index';

const idb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IDB_STORE)) request.result.createObjectStore(IDB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Combo cache could not be opened'));
  });

const readCache = async (): Promise<ComboCache | null> => {
  const db = await idb();
  const stored = await new Promise<ComboCache | undefined>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const request = tx.objectStore(IDB_STORE).get(COMBO_CACHE_KEY);
    request.onsuccess = () => resolve(request.result as ComboCache | undefined);
    request.onerror = () => reject(request.error ?? new Error('Combo cache could not be read'));
  });
  return stored?.bundle && stored.fetchedAt ? stored : null;
};

const writeCache = async (cache: ComboCache): Promise<void> => {
  const db = await idb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(cache, COMBO_CACHE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Combo cache could not be saved'));
  });
};

const fresh = (cache: ComboCache | null): boolean =>
  cache != null && Date.now() - cache.fetchedAt < COMBO_CACHE_MAX_AGE_MS;

const explain = (error: unknown): string => {
  const message = error instanceof Error ? error.message : 'Combo database couldn’t be downloaded.';
  if (/failed to fetch|networkerror/i.test(message)) {
    return 'Combo database couldn’t be downloaded. Reload the extension so Commander Spellbook is allowed.';
  }
  return message;
};

const run = async (): Promise<void> => {
  let cache: ComboCache | null = null;
  try {
    cache = await readCache();
  } catch {
    cache = null;
  }
  if (cache && install(cache.bundle) && fresh(cache)) return;
  if (!snapshot.bundle) publish({ ...snapshot, error: null, loading: true });
  try {
    const bundle = await downloadTwoCardIndex(isExtension() ? viaWorker : undefined);
    if (!install(bundle)) return;
    try {
      await writeCache({ bundle, fetchedAt: Date.now() });
    } catch {
      // The list is already in memory for this visit.
    }
  } catch (error) {
    if (snapshot.bundle) {
      publish({ ...snapshot, loading: false });
      return;
    }
    publish({ bundle: null, error: explain(error), loading: false });
  }
};

/** Download on first use, then read the saved copy. A failed refresh keeps the last good index. */
export const ensureComboIndex = (): Promise<void> => {
  if (pending) return pending;
  pending = run().finally(() => {
    pending = null;
  });
  return pending;
};

export const subscribeComboIndex = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getComboIndexSnapshot = (): ComboIndexSnapshot => snapshot;

export const getComboIndex = (): ComboBundle | null => snapshot.bundle;

export const comboIndexError = (): string | null => snapshot.error;

export const comboIndexMetadata = (): ComboBundle['metadata'] | null => snapshot.bundle?.metadata ?? null;
