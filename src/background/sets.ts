// Scryfall's catalogue of expansions, fetched in the background and kept on disk.
//
// One request returns every set Magic has ever had — about a thousand entries,
// a few hundred kilobytes — which is why it lives here rather than in the
// overlay: the overlay sits inside a Cardmarket page whose CSP has an opinion
// about what it may connect to, and the worker already holds the card metadata
// cache for the same reason.
//
// Kept for a week. New sets appear about monthly and old ones never move, so
// this is a slow-moving list where being a few days behind costs nothing worse
// than a brand-new expansion sorting under "unknown year" until the next fetch.

import type { SetInfo } from '@/lib/sets';

const KEY = 'lugin:sets';
const SOURCE = 'https://api.scryfall.com/sets';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface Held {
  fetchedAt: number;
  sets: SetInfo[];
}

const held = async (): Promise<Held | null> => {
  try {
    const stored = (await chrome.storage.local.get(KEY))[KEY] as Held | undefined;
    return stored?.sets?.length && stored.fetchedAt ? stored : null;
  } catch {
    return null;
  }
};

const download = async (): Promise<SetInfo[] | null> => {
  const res = await fetch(SOURCE, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: Record<string, unknown>[] };
  // Only the three fields we sort and match on. The full payload carries icons,
  // card counts and a dozen booleans per set, none of which we would use and all
  // of which we would then be storing on every user's disk.
  const sets = (json.data ?? [])
    .map(raw => ({
      code: String(raw.code ?? '').toLowerCase(),
      name: String(raw.name ?? ''),
      ...(typeof raw.released_at === 'string' ? { releasedAt: raw.released_at } : {}),
    }))
    .filter(set => set.code && set.name);
  return sets.length ? sets : null;
};

const read = async (): Promise<SetInfo[]> => {
  const stored = await held();
  if (stored && Date.now() - stored.fetchedAt < MAX_AGE_MS) return stored.sets;

  try {
    const sets = await download();
    if (sets) {
      await chrome.storage.local.set({ [KEY]: { fetchedAt: Date.now(), sets } satisfies Held });
      return sets;
    }
  } catch {
    // Offline, or Scryfall is having a moment.
  }

  // A stale catalogue still dates every set that existed when it was written,
  // which is all of them but the newest. Far better than no years at all.
  return stored?.sets ?? [];
};

let inflight: Promise<SetInfo[]> | null = null;

/** One download per worker lifetime, however many panels ask. */
export const getSets = (): Promise<SetInfo[]> => (inflight ??= read());
