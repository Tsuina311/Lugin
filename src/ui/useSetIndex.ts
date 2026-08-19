import { useEffect, useState } from 'react';

import { requestSets } from '@/lib/messaging';
import { EMPTY_SET_INDEX, buildSetIndex, type SetIndex } from '@/lib/sets';

/**
 * How the catalogue is doing, so the filter can tell the two silences apart.
 *
 * Without this a failed load is indistinguishable from a shelf of expansions
 * Scryfall has never heard of: both put every edition under "Year unknown", and
 * the filter goes on looking like it is working. That cost real time to diagnose
 * once, so the state is now something the UI can say out loud.
 */
export type SetIndexStatus = 'failed' | 'loading' | 'ready';

export interface SetCatalogue {
  index: SetIndex;
  status: SetIndexStatus;
}

/**
 * One expansion catalogue for the whole overlay.
 *
 * Three panels want it, it cannot change within a session, and every panel stays
 * mounted at once — so this is held at module scope rather than fetched per
 * component. The worker would answer all three from the same cache anyway, but
 * this also spares the message round-trip on every tab switch.
 */
let shared: Promise<SetIndex> | null = null;

const load = (): Promise<SetIndex> =>
  (shared ??= requestSets()
    .then(buildSetIndex)
    .catch((err: unknown) => {
      // Don't cache the failure: the next panel to mount should try again rather
      // than spend the session with no release dates because of one blip.
      shared = null;
      throw err;
    }));

/**
 * The set catalogue, empty until it arrives. Callers degrade gracefully — an
 * empty index dates nothing, which sorts every edition alphabetically under
 * "unknown year" instead of throwing the filter away.
 */
export const useSetIndex = (): SetCatalogue => {
  const [catalogue, setCatalogue] = useState<SetCatalogue>({
    index: EMPTY_SET_INDEX,
    status: 'loading',
  });

  useEffect(() => {
    let alive = true;
    load()
      .then(index => {
        if (alive) setCatalogue({ index, status: 'ready' });
      })
      .catch(() => {
        if (alive) setCatalogue({ index: EMPTY_SET_INDEX, status: 'failed' });
      });
    return () => {
      alive = false;
    };
  }, []);

  return catalogue;
};
