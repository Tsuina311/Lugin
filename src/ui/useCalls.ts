import { useSyncExternalStore } from 'react';

import { callStore } from '@/content/callStore';
import type { CapturedCall } from '@/lib/types';

/** Subscribe the React tree to the live capture store. */
export const useCalls = (): CapturedCall[] =>
  useSyncExternalStore(callStore.subscribe, callStore.getSnapshot);
