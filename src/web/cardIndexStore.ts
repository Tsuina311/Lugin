// The card-name index, fetched once and kept where a phone can reach it offline.
//
// Same storage bargain as `priceStore.ts` — the Cache API, because this is a
// response we want to keep and it is megabytes — but a different loading policy,
// and the difference is the point.
//
// Prices go stale: yesterday's number is worth showing while today's downloads.
// Card *names* effectively do not. A name index is only out of date for cards
// printed since it was built, so an old copy is a completely fine answer and
// re-downloading 1.2 MB to learn about one new set would be a poor trade on a
// phone in a shop. Hence a long expiry and no eager refresh.
//
// Loaded on first scan rather than at launch: someone opening Collection to check
// a price should not pay for the scanner.

import {
  buildNameIndex,
  type CardNameIndex,
  type CardNameIndexData,
} from '@/lib/scan/matchName';

/**
 * Named in the service worker's sweep allowlist, like the price table — otherwise
 * every deploy throws the index away and the next scan re-downloads it.
 */
export const CARD_INDEX_CACHE = 'lugin-card-index';

const URL_PATH = 'card-names.json';

/** A fortnight. New sets are the only thing that ages this, and they are rare. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const url = (): string => `${import.meta.env.BASE_URL}${URL_PATH}`;

interface Held {
  data: CardNameIndexData;
  fetchedAt: number;
}

const held = async (): Promise<Held | null> => {
  if (typeof caches === 'undefined') return null;
  try {
    const hit = await (await caches.open(CARD_INDEX_CACHE)).match(url());
    if (!hit) return null;
    const body = (await hit.json()) as Partial<Held>;
    return body.data?.names?.length && body.fetchedAt
      ? { data: body.data, fetchedAt: body.fetchedAt }
      : null;
  } catch {
    return null;
  }
};

const keep = async (data: CardNameIndexData, fetchedAt: number): Promise<void> => {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(CARD_INDEX_CACHE);
    await cache.put(
      url(),
      new Response(JSON.stringify({ data, fetchedAt } satisfies Held), {
        headers: { 'content-type': 'application/json' },
      }),
    );
  } catch {
    // A full or disabled store costs us the offline copy, not the feature.
  }
};

const download = async (): Promise<CardNameIndexData | null> => {
  const res = await fetch(url(), { cache: 'no-cache' });
  if (!res.ok) return null;
  const data = (await res.json()) as CardNameIndexData;
  return data.names?.length ? data : null;
};

export interface CardIndexState {
  /** Null when no index could be loaded; callers fall back to Scryfall. */
  index: CardNameIndex | null;
  /** How many card names it knows, for the debug view. */
  names: number;
}

export const NO_CARD_INDEX: CardIndexState = { index: null, names: 0 };

let inflight: Promise<CardIndexState> | null = null;

const read = async (): Promise<CardIndexState> => {
  const stored = await held();

  // An index older than MAX_AGE_MS is still used; the refresh is just attempted
  // first. Being a fortnight behind costs the newest set, not the feature.
  if (stored && Date.now() - stored.fetchedAt < MAX_AGE_MS) return built(stored.data);

  try {
    const data = await download();
    if (data) {
      await keep(data, Date.now());
      return built(data);
    }
  } catch {
    // No signal, or no index deployed yet.
  }

  return stored ? built(stored.data) : NO_CARD_INDEX;
};

const built = (data: CardNameIndexData): CardIndexState => ({
  index: buildNameIndex(data),
  names: data.names.length,
});

/**
 * Load the index, at most once per page load.
 *
 * Memoised on the promise so two scans starting together share one download and
 * one build rather than racing for 1.2 MB and ~130k folded strings each.
 */
export const loadCardIndex = (): Promise<CardIndexState> => (inflight ??= read());
