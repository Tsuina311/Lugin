// Sellers the user has explicitly pinned.
//
// The ranking in `lib/sellerStats.ts` is derived from purchase history and needs
// no input, which is what makes the list useful on day one. This store is the
// other half: history says who you bought from most, and it cannot say who you
// *trust*. A small shop you have used twice, who packed it properly and posted it
// the same day, will never outrank a warehouse on volume — and is often the seller
// you actually want to check first.
//
// Pinning is therefore additive rather than a replacement for the ranking, and
// deliberately keyed by slug: the seller's display name can change, the profile
// path carries a locale prefix, and neither is stable enough to remember someone by.
//
// Persisted to chrome.storage.local, following `cardImageOverrideStore`, and
// exposed through the same useSyncExternalStore contract.

export const FAVOURITE_SELLERS_STORAGE_KEY = 'lugin:favouriteSellers';
const STORAGE_KEY = FAVOURITE_SELLERS_STORAGE_KEY;

export interface FavouriteSeller {
  /** Display name at the time of pinning, so a pin reads as a name before any sync. */
  name?: string;
  /** When it was pinned, so the list can be ordered by the user's own choosing. */
  pinnedAt: number;
  /** Profile path, so a pinned seller is reachable even with no history loaded. */
  url?: string;
}

/** seller slug -> pin. */
type FavouriteMap = Record<string, FavouriteSeller>;

let favourites: FavouriteMap = {};
let loading = true;
const listeners = new Set<() => void>();

const emit = () => {
  for (const l of listeners) l();
};

const persist = async () => {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: favourites });
  } catch {
    // ignore storage failures (quota/private mode) — in-memory state still works
  }
};

void chrome.storage.local.get(STORAGE_KEY).then(stored => {
  const raw = stored[STORAGE_KEY] as FavouriteMap | undefined;
  favourites = raw && typeof raw === 'object' ? raw : {};
  loading = false;
  emit();
});

export const favouriteSellersStore = {
  getSnapshot(): FavouriteMap {
    return favourites;
  },

  isLoading(): boolean {
    return loading;
  },

  /** Pin a seller, or update the name/url remembered for an existing pin. */
  async pin(slug: string, about: { name?: string; url?: string } = {}): Promise<void> {
    if (!slug) return;
    favourites = {
      ...favourites,
      [slug]: {
        pinnedAt: favourites[slug]?.pinnedAt ?? Date.now(),
        ...(about.name ? { name: about.name } : {}),
        ...(about.url ? { url: about.url } : {}),
      },
    };
    emit();
    await persist();
  },

  /** Replace every pin with a set from elsewhere (the user's other device). */
  async replaceAll(next: FavouriteMap): Promise<void> {
    favourites = { ...next };
    loading = false;
    emit();
    await persist();
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Remove a pin. The seller stays in the derived ranking on its own merits. */
  async unpin(slug: string): Promise<void> {
    if (!(slug in favourites)) return;
    const next = { ...favourites };
    delete next[slug];
    favourites = next;
    emit();
    await persist();
  },
};
