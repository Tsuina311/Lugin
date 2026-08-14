// One hook, two platforms: the loader is passed in.
//
// The phone reads the table straight off Pages into the Cache API; the extension
// asks its background worker, which holds the same table in chrome.storage. Both
// end up with a `PriceState`, so everything above this line — the sums, the
// wording, the "priced by name" caveats — is written once.

import { useEffect, useState } from 'react';

import { NO_PRICES, type PriceState } from '@/lib/prices';

/**
 * Load a price table without blocking the screen that wants it.
 *
 * Prices are decoration on a collection, not the collection: the cards must be on
 * screen the moment they're read from disk, with a value appearing when it can.
 * So this starts empty and never suspends.
 */
export const usePrices = (load: () => Promise<PriceState>): PriceState => {
  const [state, setState] = useState<PriceState>(NO_PRICES);

  useEffect(() => {
    let alive = true;
    void load()
      .then(next => {
        if (alive) setState(next);
      })
      .catch(() => {
        // A missing table is a missing number, not an error worth a banner.
      });
    return () => {
      alive = false;
    };
  }, [load]);

  return state;
};
