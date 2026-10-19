import Constants from 'expo-constants';

import { NO_PRICES, PRICES_MAX_AGE_MS, type PriceSnapshot, type PriceState } from '@/lib/prices';

interface Held {
  fetchedAt: number;
  snapshot: PriceSnapshot;
}

const pricesUrl = (): string | null => {
  const extra = Constants.expoConfig?.extra as { lugin?: { pricesUrl?: string } } | undefined;
  const url = extra?.lugin?.pricesUrl?.trim();
  return url || null;
};

const file = async (): Promise<{ path: string | null; read: () => Promise<string | null>; write: (body: string) => Promise<void> }> => {
  const FileSystem = await import('expo-file-system/legacy');
  const root = FileSystem.documentDirectory;
  if (!root) return { path: null, read: async () => null, write: async () => undefined };
  const dir = `${root}lugin-library/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const path = `${dir}prices.json`;
  return {
    path,
    read: async () => {
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) return null;
      return FileSystem.readAsStringAsync(path);
    },
    write: body => FileSystem.writeAsStringAsync(path, body),
  };
};

/** The same daily table the phone site caches. Missing or stale prices do not block the collection. */
export const loadNativePrices = async (): Promise<PriceState> => {
  const store = await file();
  let held: Held | null = null;
  try {
    const raw = await store.read();
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Held>;
      if (parsed.snapshot?.printings && parsed.fetchedAt) {
        held = { fetchedAt: parsed.fetchedAt, snapshot: parsed.snapshot };
      }
    }
  } catch {
    held = null;
  }
  const fresh = held && Date.now() - held.fetchedAt < PRICES_MAX_AGE_MS;
  if (held && fresh) return { fetchedAt: held.fetchedAt, snapshot: held.snapshot, stale: false };

  const url = pricesUrl();
  if (url) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const snapshot = (await response.json()) as PriceSnapshot;
        if (snapshot.printings) {
          const fetchedAt = Date.now();
          await store.write(JSON.stringify({ fetchedAt, snapshot } satisfies Held));
          return { fetchedAt, snapshot, stale: false };
        }
      }
    } catch {
      // Keep the last table, or none.
    }
  }
  if (held) return { fetchedAt: held.fetchedAt, snapshot: held.snapshot, stale: true };
  return NO_PRICES;
};
