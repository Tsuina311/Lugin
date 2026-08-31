// Favourite sellers — pin + look up.
//
// The store was built earlier from purchase-history work; this hook is the UI
// half so every list can ask "is this seller pinned?" the same way.

import { useCallback, useSyncExternalStore } from 'react';

import {
  favouriteSellersStore,
  type FavouriteSeller,
} from '@/content/favouriteSellersStore';
import { sellerSlugFromHref } from '@/sites/cardmarket/order';

export type FavouriteMap = Record<string, FavouriteSeller>;

/** Stable identity for a seller: profile slug, else the username as shown. */
export const sellerSlugOf = (url?: string | null, name?: string | null): string | undefined => {
  const fromUrl = sellerSlugFromHref(url ?? undefined);
  if (fromUrl) return fromUrl;
  const trimmed = name?.trim();
  return trimmed || undefined;
};

export const isFavouriteSeller = (
  favs: FavouriteMap,
  url?: string | null,
  name?: string | null,
): boolean => {
  const slug = sellerSlugOf(url, name);
  if (slug && slug in favs) return true;
  const lower = name?.trim().toLowerCase();
  if (!lower) return false;
  return Object.entries(favs).some(
    ([key, pin]) => key.toLowerCase() === lower || pin.name?.toLowerCase() === lower,
  );
};

/** Favourites first (stable among equals), then leave `cmp` to break ties. */
export const compareFavouriteFirst = <T>(
  favs: FavouriteMap,
  a: T,
  b: T,
  identity: (row: T) => { name?: string | null; url?: string | null },
  cmp: (a: T, b: T) => number,
): number => {
  const aFav = isFavouriteSeller(favs, identity(a).url, identity(a).name) ? 0 : 1;
  const bFav = isFavouriteSeller(favs, identity(b).url, identity(b).name) ? 0 : 1;
  if (aFav !== bFav) return aFav - bFav;
  return cmp(a, b);
};

export const useFavouriteSellers = () => {
  const favourites = useSyncExternalStore(
    favouriteSellersStore.subscribe,
    favouriteSellersStore.getSnapshot,
    favouriteSellersStore.getSnapshot,
  );

  const isFavourite = useCallback(
    (url?: string | null, name?: string | null) => isFavouriteSeller(favourites, url, name),
    [favourites],
  );

  const toggle = useCallback(
    async (url?: string | null, name?: string | null) => {
      const slug = sellerSlugOf(url, name);
      if (!slug) return;
      if (isFavouriteSeller(favourites, url, name)) {
        if (slug in favourites) {
          await favouriteSellersStore.unpin(slug);
          return;
        }
        const hit = Object.entries(favourites).find(
          ([key, pin]) =>
            key.toLowerCase() === slug.toLowerCase() ||
            pin.name?.toLowerCase() === (name?.trim().toLowerCase() ?? ''),
        );
        if (hit) await favouriteSellersStore.unpin(hit[0]);
        return;
      }
      await favouriteSellersStore.pin(slug, {
        ...(name?.trim() ? { name: name.trim() } : {}),
        ...(url ? { url } : {}),
      });
    },
    [favourites],
  );

  return { favourites, isFavourite, toggle };
};
