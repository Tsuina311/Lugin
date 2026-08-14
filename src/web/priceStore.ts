// The price table, fetched once a day and kept where a phone can reach it offline.
//
// The Cache API rather than IndexedDB or localStorage: it is the one store built
// for "a response I want to keep", it holds megabytes without ceremony, and it is
// already in play for the share inbox. localStorage would be the wrong tool twice
// over — a few megabytes of JSON string against a 5 MB quota shared with
// everything else.
//
// Deliberately not part of the sync document. Prices are the same for everybody
// and rebuilt daily; pushing a 3.5 MB table into a user's Drive folder to say
// what Scryfall already says publicly would be absurd, and it would fight the
// conflict resolution every morning.

import { NO_PRICES, PRICES_MAX_AGE_MS, type PriceSnapshot, type PriceState } from '@/lib/prices';

/**
 * Named in the service worker's sweep allowlist too — otherwise every deploy
 * would throw the table away and make the next launch re-download it.
 */
export const PRICES_CACHE = 'lugin-prices';

const CACHE = PRICES_CACHE;
const URL_PATH = 'prices.json';

const url = (): string => `${import.meta.env.BASE_URL}${URL_PATH}`;

/** Our own envelope, so the fetch time survives with the data. */
interface Held {
  fetchedAt: number;
  snapshot: PriceSnapshot;
}

const held = async (): Promise<Held | null> => {
  if (typeof caches === 'undefined') return null;
  try {
    const hit = await (await caches.open(CACHE)).match(url());
    if (!hit) return null;
    const body = (await hit.json()) as Partial<Held>;
    return body.snapshot && body.fetchedAt ? { fetchedAt: body.fetchedAt, snapshot: body.snapshot } : null;
  } catch {
    return null;
  }
};

const keep = async (snapshot: PriceSnapshot, fetchedAt: number): Promise<void> => {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(CACHE);
    await cache.put(
      url(),
      new Response(JSON.stringify({ fetchedAt, snapshot } satisfies Held), {
        headers: { 'content-type': 'application/json' },
      }),
    );
  } catch {
    // A full or disabled store costs us the offline copy, not the feature.
  }
};

const download = async (): Promise<PriceSnapshot | null> => {
  const res = await fetch(url(), { cache: 'no-cache' });
  if (!res.ok) return null;
  const snapshot = (await res.json()) as PriceSnapshot;
  return snapshot.printings ? snapshot : null;
};

let inflight: Promise<PriceState> | null = null;

const read = async (): Promise<PriceState> => {
  const stored = await held();
  const fresh = stored && Date.now() - stored.fetchedAt < PRICES_MAX_AGE_MS;
  if (stored && fresh) return { fetchedAt: stored.fetchedAt, snapshot: stored.snapshot, stale: false };

  try {
    const snapshot = await download();
    if (snapshot) {
      const fetchedAt = Date.now();
      await keep(snapshot, fetchedAt);
      return { fetchedAt, snapshot, stale: false };
    }
  } catch {
    // No signal, or no snapshot deployed yet.
  }

  // An old table beats no table: yesterday's prices are a fine answer to "roughly
  // what is this worth", and the age is reported rather than hidden.
  return stored
    ? { fetchedAt: stored.fetchedAt, snapshot: stored.snapshot, stale: true }
    : NO_PRICES;
};

/**
 * Load the table, at most once per page load.
 *
 * Memoised on the promise so several screens asking at once share one download
 * rather than racing for 3.5 MB each.
 */
export const loadPrices = (): Promise<PriceState> => (inflight ??= read());
