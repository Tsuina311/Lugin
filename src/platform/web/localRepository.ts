// The phone's own copy of the synced document.
//
// The extension spreads its data over several chrome.storage keys and its stores
// own them, so its LocalRepository is mostly translation. A phone has no stores
// and no other reader, so this keeps the document whole, exactly as the engine
// wants it, and there is nothing to translate.
//
// IndexedDB rather than localStorage. A scanned collection is tens of thousands
// of rows — several megabytes of JSON — and localStorage's ~5 MB quota is a hard
// wall you discover as an exception halfway through a write, having already lost
// the old value. IDB is also asynchronous, so saving a big import doesn't freeze
// the list the user is looking at.
//
// If IDB can't be opened at all (iOS private browsing, a locked-down profile),
// this degrades to memory rather than throwing: the app still works for the
// session, `persistent()` says it won't outlive it, and the *cloud* copy is
// still the real one either way.

import {
  emptyData,
  emptyMeta,
  type ApplicationData,
  type DomainKey,
  type SyncMeta,
} from '@/core/sync/model';
import type { LocalRepository } from '@/core/sync/repository';

const DB_NAME = 'lugin';
const DB_VERSION = 1;
const STORE = 'sync';
const DATA_KEY = 'data';
const META_KEY = 'meta';

/** A domain nothing has ever written here loses to anything the cloud holds. */
const NEVER = new Date(0).toISOString();

const newDeviceId = (): string =>
  typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

interface Store {
  get<T>(key: string): Promise<T | undefined>;
  persistent(): boolean;
  /** Resolves false when the write could not be persisted. */
  put(key: string, value: unknown): Promise<boolean>;
}

const createStore = (): Store => {
  const memory = new Map<string, unknown>();
  let usable = true;
  let opening: Promise<IDBDatabase> | null = null;

  const open = (): Promise<IDBDatabase> => {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('no IndexedDB in this context'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      // Safari in private mode answers the open request with an error rather
      // than refusing up front, which is why this is a runtime fallback and not
      // a feature test.
      request.onerror = () => reject(request.error ?? new Error('IndexedDB refused to open'));
      request.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
    });
    return opening;
  };

  const transact = async <T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const database = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = database.transaction(STORE, mode);
      const request = work(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  };

  // Probe now rather than at the first read, so `persistent()` has a real answer
  // to give before anything has been stored — otherwise it would claim success
  // until the first failure and the warning would arrive after the import it was
  // supposed to precede.
  void open().catch(() => {
    usable = false;
  });

  return {
    async get<T>(key: string): Promise<T | undefined> {
      if (usable) {
        try {
          return await transact<T | undefined>('readonly', store => store.get(key));
        } catch {
          usable = false;
        }
      }
      return memory.get(key) as T | undefined;
    },

    persistent(): boolean {
      return usable;
    },

    async put(key: string, value: unknown): Promise<boolean> {
      // Always keep the memory copy in step, so a store that fails mid-session
      // leaves the app with correct data rather than a stale read.
      memory.set(key, value);
      if (!usable) return false;
      try {
        await transact('readwrite', store => store.put(value, key));
        return true;
      } catch {
        usable = false;
        return false;
      }
    },
  };
};

export interface WebLocalRepository extends LocalRepository {
  /**
   * Replace one domain as this device's own edit: stamped now, and marked dirty
   * so the next sync pushes it. Returns the document as it now stands, since the
   * caller is invariably about to render it.
   */
  edit<K extends DomainKey>(domain: K, value: ApplicationData[K]['value']): Promise<ApplicationData>;
  /**
   * False when this device couldn't open a real store, so data lives in memory
   * for this session only. Settles as soon as the store has been probed, which
   * the app does before its first paint.
   */
  persistent(): boolean;
}

export const createWebLocalRepository = (
  now: () => string = () => new Date().toISOString(),
): WebLocalRepository => {
  const store = createStore();

  const readData = async (): Promise<ApplicationData> =>
    (await store.get<ApplicationData>(DATA_KEY)) ?? emptyData(NEVER);

  const readMeta = async (): Promise<SyncMeta> => {
    const stored = await store.get<SyncMeta>(META_KEY);
    if (stored?.deviceId) return stored;
    // First run on this phone: mint an id and keep it, so a conflict copy can
    // name which device wrote it.
    const meta = emptyMeta(newDeviceId());
    await store.put(META_KEY, meta);
    return meta;
  };

  return {
    async edit<K extends DomainKey>(
      domain: K,
      value: ApplicationData[K]['value'],
    ): Promise<ApplicationData> {
      const at = now();
      const data = await readData();
      const next: ApplicationData = { ...data, [domain]: { updatedAt: at, value } };
      await store.put(DATA_KEY, next);
      const meta = await readMeta();
      await store.put(META_KEY, { ...meta, dirtyAt: at });
      return next;
    },

    persistent: () => store.persistent(),

    read: readData,

    readMeta,

    async write(data: ApplicationData, changed: readonly DomainKey[]): Promise<void> {
      const current = await readData();
      const next = { ...current };
      // Only the domains named: adopting a deck edit must not rewrite — or
      // restamp — a 20,000-row collection.
      for (const domain of changed) {
        (next[domain] as ApplicationData[DomainKey]) = data[domain];
      }
      await store.put(DATA_KEY, next);
    },

    async writeMeta(patch: Partial<SyncMeta>): Promise<void> {
      const meta = await readMeta();
      await store.put(META_KEY, { ...meta, ...patch });
    },
  };
};
