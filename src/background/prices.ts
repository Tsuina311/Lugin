// The price table for the extension, fetched in the background and kept on disk.
//
// In the background worker rather than the overlay for two reasons: the overlay
// lives inside a Cardmarket page, whose CSP has an opinion about what it may
// connect to, and the worker is the only place with `unlimitedStorage` in mind —
// the table is a few megabytes and would be a rude thing to put in a page.
//
// The URL is build-time configuration, not a constant, because the table is served
// from wherever the phone app is deployed. The matching host permission is
// derived from the same env var in `src/manifest.config.ts` — MV3 workers need
// that; CORS alone is not enough. An extension built without a URL simply has
// no prices, and the UI says so rather than pretending.

import { NO_PRICES, PRICES_MAX_AGE_MS, type PriceSnapshot, type PriceState } from '@/lib/prices';

const KEY = 'lugin:prices';

const SOURCE: string | undefined = import.meta.env.VITE_LUGIN_PRICES_URL;

interface Held {
  fetchedAt: number;
  snapshot: PriceSnapshot;
}

const held = async (): Promise<Held | null> => {
  try {
    const stored = (await chrome.storage.local.get(KEY))[KEY] as Held | undefined;
    return stored?.snapshot && stored.fetchedAt ? stored : null;
  } catch {
    return null;
  }
};

const download = async (): Promise<PriceSnapshot | null> => {
  if (!SOURCE) return null;
  const res = await fetch(SOURCE, { cache: 'no-cache' });
  if (!res.ok) return null;
  const snapshot = (await res.json()) as PriceSnapshot;
  return snapshot.printings ? snapshot : null;
};

let inflight: Promise<PriceState> | null = null;

const read = async (): Promise<PriceState> => {
  const stored = await held();
  if (stored && Date.now() - stored.fetchedAt < PRICES_MAX_AGE_MS) {
    return { fetchedAt: stored.fetchedAt, snapshot: stored.snapshot, stale: false };
  }

  try {
    const snapshot = await download();
    if (snapshot) {
      const fetchedAt = Date.now();
      await chrome.storage.local.set({ [KEY]: { fetchedAt, snapshot } satisfies Held });
      return { fetchedAt, snapshot, stale: false };
    }
  } catch {
    // Offline, or nothing deployed to fetch.
  }

  return stored
    ? { fetchedAt: stored.fetchedAt, snapshot: stored.snapshot, stale: true }
    : NO_PRICES;
};

/** One download per worker lifetime, however many panels ask. */
export const getPrices = (): Promise<PriceState> => (inflight ??= read());
