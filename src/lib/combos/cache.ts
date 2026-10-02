import type { ComboBundle } from './types';

export const COMBO_CACHE_KEY = 'lugin:commander-combos';
/** A week. The cached copy is used immediately; this only decides when to refresh. */
export const COMBO_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface ComboCache {
  bundle: ComboBundle;
  fetchedAt: number;
}
