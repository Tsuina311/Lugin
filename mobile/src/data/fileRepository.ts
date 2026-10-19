// JSON files for the library when this binary has no SQLite module.
//
// Same document the sync engine already uses. A new development build switches
// the phone to SQLite; until then a kill/reopen still keeps the cards.

import { emptyData, emptyMeta, type ApplicationData, type DomainKey, type SyncMeta } from '@/core/sync/model';
import { cardKey } from '@/lib/cardName';
import type { LibraryRepository } from '@/platform/sqlite/localRepository';
import { assertDomainValue } from '@/platform/sqlite/validate';

const EPOCH = new Date(0).toISOString();

const newDeviceId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `native-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const fs = async () => import('expo-file-system/legacy');

export const createFileLibraryRepository = async (
  now: () => string = () => new Date().toISOString(),
): Promise<LibraryRepository> => {
  const FileSystem = await fs();
  const root = FileSystem.documentDirectory;
  const dir = root ? `${root}lugin-library/` : null;
  if (dir) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const dataPath = dir ? `${dir}data.json` : null;
  const metaPath = dir ? `${dir}meta.json` : null;
  let memoryData: ApplicationData | null = null;
  let memoryMeta: SyncMeta | null = null;
  let usable = Boolean(dir);

  const readFile = async (path: string | null): Promise<string | null> => {
    if (!path || !usable) return null;
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    return FileSystem.readAsStringAsync(path);
  };

  const writeFile = async (path: string | null, value: unknown): Promise<void> => {
    if (!path || !usable) return;
    await FileSystem.writeAsStringAsync(path, JSON.stringify(value));
  };

  const read = async (): Promise<ApplicationData> => {
    if (memoryData) return memoryData;
    try {
      const raw = await readFile(dataPath);
      memoryData = raw ? (JSON.parse(raw) as ApplicationData) : emptyData(EPOCH);
    } catch {
      usable = false;
      memoryData = emptyData(EPOCH);
    }
    return memoryData;
  };

  const readMeta = async (): Promise<SyncMeta> => {
    if (memoryMeta) return memoryMeta;
    try {
      const raw = await readFile(metaPath);
      const parsed = raw ? (JSON.parse(raw) as SyncMeta) : null;
      if (parsed?.deviceId) {
        memoryMeta = parsed;
        return memoryMeta;
      }
    } catch {
      usable = false;
    }
    memoryMeta = emptyMeta(newDeviceId());
    await writeFile(metaPath, memoryMeta);
    return memoryMeta;
  };

  return {
    counts: async () => {
      const data = await read();
      const cards = data.collection.value?.cards ?? [];
      return {
        copies: cards.reduce((sum, card) => sum + (card.quantity > 0 ? card.quantity : 0), 0),
        rows: cards.length,
      };
    },
    edit: async (domain, value) => {
      assertDomainValue(domain, value);
      const at = now();
      const data = await read();
      const next: ApplicationData = { ...data, [domain]: { updatedAt: at, value } };
      memoryData = next;
      await writeFile(dataPath, next);
      const meta = await readMeta();
      memoryMeta = { ...meta, dirtyAt: at };
      await writeFile(metaPath, memoryMeta);
      return next;
    },
    persistent: () => usable,
    read,
    readMeta,
    searchCards: async (query, limit) => {
      const needle = query.trim().toLowerCase();
      const cards = (await read()).collection.value?.cards ?? [];
      const matched = needle
        ? cards.filter(card => card.name.toLowerCase().includes(needle) || cardKey(card.name).includes(needle))
        : cards;
      return matched.slice(0, limit);
    },
    write: async (data, changed) => {
      for (const domain of changed) assertDomainValue(domain, data[domain].value);
      const current = await read();
      const next = { ...current };
      for (const domain of changed) {
        (next[domain] as ApplicationData[DomainKey]) = data[domain];
      }
      memoryData = next;
      await writeFile(dataPath, next);
    },
    writeMeta: async patch => {
      const meta = { ...(await readMeta()), ...patch };
      memoryMeta = meta;
      await writeFile(metaPath, meta);
    },
  };
};
