import { useSyncExternalStore } from 'react';

import { pageDataStore } from '@/content/pageDataStore';
import type { ExtractionResult } from '@/sites/types';

/** Subscribe the React tree to the latest DOM extraction result. */
export const usePageData = (): ExtractionResult | null =>
  useSyncExternalStore(pageDataStore.subscribe, pageDataStore.getSnapshot);
