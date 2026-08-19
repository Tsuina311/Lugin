import { useEffect, useState } from 'react';

import { shouldWelcome } from './firstRun';

import { collectionStore } from '@/content/collectionStore';
import { purchaseStore } from '@/content/purchaseStore';
import { wantsStore } from '@/content/wantsStore';

// Whether the welcome screen is showing, and how to close it.
//
// Deliberately not `useSyncExternalStore` on the three stores: the shell would
// then re-render on every one of their updates, and a purchase sync reports
// progress once per order — hundreds of re-renders of the whole overlay to answer
// a question that is settled in the first few milliseconds. Instead this
// subscribes only until the answer is known, then unsubscribes for good.

const WELCOME_KEY = 'lugin:welcomed';

/**
 * Read whether the welcome has been answered.
 *
 * A page that denies storage can't remember a dismissal, so it counts as already
 * welcomed: a greeting that cannot be turned off is worse than no greeting.
 */
const readWelcomed = (): boolean => {
  try {
    return localStorage.getItem(WELCOME_KEY) === '1';
  } catch {
    return true;
  }
};

export const useFirstRun = (): { close: () => void; welcome: boolean | null } => {
  const [welcome, setWelcome] = useState<boolean | null>(null);

  useEffect(() => {
    // Decided once and then held: recomputing as data arrives would tear the
    // screen away the moment the first sync landed, which is exactly when the
    // user is watching it.
    if (welcome !== null) return;
    const decide = () => {
      const wants = wantsStore.getSnapshot();
      const purchases = purchaseStore.getSnapshot();
      const collection = collectionStore.getSnapshot();
      const decided = shouldWelcome({
        collection: !!collection.collection,
        hydrated: !wants.loading && !purchases.loading && !collection.loading,
        purchases: !!purchases.index,
        wants: !!wants.index,
        welcomed: readWelcomed(),
      });
      if (decided !== null) setWelcome(decided);
    };
    decide();
    const off = [
      wantsStore.subscribe(decide),
      purchaseStore.subscribe(decide),
      collectionStore.subscribe(decide),
    ];
    return () => off.forEach(unsubscribe => unsubscribe());
  }, [welcome]);

  return {
    close: () => {
      try {
        localStorage.setItem(WELCOME_KEY, '1');
      } catch {
        // ignore storage failures — the screen still closes for this session
      }
      setWelcome(false);
    },
    welcome,
  };
};
