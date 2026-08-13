import { useEffect, useMemo, useState } from 'react';

import { rememberFaces } from './components/cardPreview';

import { cardKey, looseKey } from '@/lib/cardName';
import { requestScryfall, requestScryfallCached } from '@/lib/messaging';
import type { CardMetadata } from '@/lib/mtg';

/**
 * Scryfall metadata for a list of card names, keyed by card key.
 *
 * Whatever the background worker already has cached is served first, so images
 * and types are there on the first render for cards we've seen before; only the
 * misses cost a request. `merge` lets a caller drop in metadata it looked up
 * itself (adding a card, say) without waiting for the next pass.
 *
 * Scryfall answers with its own spelling, so a card asked for as "Lim-Dûl's
 * Vault" comes back under "lim-dul's vault". Results are therefore also filed
 * under the key the caller asked with — otherwise the card would look missing to
 * the very list that requested it, and be requested again on every pass.
 */
export const useCardMetadata = (
  names: string[],
): {
  merge: (list: CardMetadata[]) => void;
  metaByKey: Record<string, CardMetadata>;
} => {
  const [fetched, setFetched] = useState<Record<string, CardMetadata>>({});

  const merge = (list: CardMetadata[]): void => {
    // The hover preview asks Scryfall which faces a card has; anything we learn
    // here answers that in advance.
    rememberFaces(list);
    setFetched(prev => {
      const next = { ...prev };
      for (const m of list) next[cardKey(m.name)] = m;
      return next;
    });
  };

  // The name list is rebuilt on every render, so compare it by content.
  const namesKey = useMemo(() => names.map(n => cardKey(n)).join('|'), [names]);

  // What we hold, answerable by either spelling.
  const metaByKey = useMemo(() => {
    const byLoose = new Map(Object.entries(fetched).map(([key, m]) => [looseKey(key), m]));
    const out = { ...fetched };
    for (const key of namesKey.split('|')) {
      if (!key || out[key]) continue;
      const found = byLoose.get(looseKey(key));
      if (found) out[key] = found;
    }
    return out;
  }, [fetched, namesKey]);

  useEffect(() => {
    if (names.length === 0) return;
    let cancelled = false;
    void (async () => {
      const cached = await requestScryfallCached(names);
      if (cancelled) return;
      merge(cached);
      const have = new Set(cached.map(m => looseKey(m.name)));
      const missing = names.filter(n => !have.has(looseKey(n)));
      if (missing.length === 0) return;
      const fresh = await requestScryfall(missing);
      if (!cancelled) merge(fresh);
    })();
    return () => {
      cancelled = true;
    };
    // `names` is covered by namesKey; re-running on a new array would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey]);

  return { merge, metaByKey };
};
