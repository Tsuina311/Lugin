// IndexedDB queue for pending development-capture samples.

import {
  CORPUS_QUEUE_MAX_BYTES,
  CORPUS_QUEUE_MAX_SAMPLES,
} from '@/lib/scan/corpus/policy';
import { pickEvictionIndex } from '@/lib/scan/corpus/throttle';
import type {
  CorpusPriority,
  ScanCorpusSampleMeta,
} from '@/lib/scan/corpus/types';

const DB_NAME = 'lugin-corpus';
const STORE = 'pending';
const DB_VERSION = 1;

export interface QueuedCorpusSample {
  bytes: number;
  enqueuedAt: string;
  id: string;
  image: ArrayBuffer | null;
  meta: ScanCorpusSampleMeta;
  mimeType: 'image/jpeg' | 'image/webp' | null;
  priority: CorpusPriority;
  uploadsFailed: number;
}

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error('idb open failed'));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });

const txDone = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('idb tx failed'));
    tx.onabort = () => reject(tx.error ?? new Error('idb tx aborted'));
  });

export const listPendingCorpus = async (): Promise<QueuedCorpusSample[]> => {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as QueuedCorpusSample[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
};

export const countPendingCorpus = async (): Promise<number> =>
  (await listPendingCorpus()).length;

const totalBytes = (rows: QueuedCorpusSample[]): number =>
  rows.reduce((s, r) => s + (r.bytes || 0), 0);

const evictIfNeeded = async (db: IDBDatabase): Promise<void> => {
  const rows = await new Promise<QueuedCorpusSample[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as QueuedCorpusSample[]) ?? []);
    req.onerror = () => reject(req.error);
  });

  while (
    rows.length > CORPUS_QUEUE_MAX_SAMPLES ||
    totalBytes(rows) > CORPUS_QUEUE_MAX_BYTES
  ) {
    const idx = pickEvictionIndex(rows.map(r => r.priority));
    if (idx < 0) break;
    const victim = rows[idx];
    // Never evict high if only highs remain and we're only slightly over — still
    // drop oldest low/medium first; if all high, drop oldest high.
    const drop =
      rows.find(r => r.priority === 'low') ??
      rows.find(r => r.priority === 'medium') ??
      victim;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(drop.id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    const i = rows.findIndex(r => r.id === drop.id);
    if (i >= 0) rows.splice(i, 1);
  }
};

export const enqueueCorpusSample = async (
  sample: Omit<QueuedCorpusSample, 'enqueuedAt' | 'uploadsFailed'>,
): Promise<void> => {
  const db = await openDb();
  const row: QueuedCorpusSample = {
    ...sample,
    enqueuedAt: new Date().toISOString(),
    uploadsFailed: 0,
  };
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(row);
  await txDone(tx);
  await evictIfNeeded(db);
};

export const removeCorpusSample = async (id: string): Promise<void> => {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await txDone(tx);
  } catch {
    // ignore
  }
};

export const clearPendingCorpus = async (): Promise<void> => {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    await txDone(tx);
  } catch {
    // ignore
  }
};

export const markUploadFailed = async (id: string): Promise<void> => {
  const rows = await listPendingCorpus();
  const row = rows.find(r => r.id === id);
  if (!row) return;
  row.uploadsFailed += 1;
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(row);
  await txDone(tx);
};
