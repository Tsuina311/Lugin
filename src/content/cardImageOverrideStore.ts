// User-chosen "the version I actually own" overrides for collection cards.
//
// Our automatic printing guess (Scryfall id → Cardmarket product id → set +
// number → name) is usually right, but some cards have several printings in one
// set and the source data can't disambiguate. This store lets the user pick the
// exact printing from a picker; we remember it keyed by `cardKey` so it sticks
// across re-imports and purchase re-syncs (which rebuild the collection rows).
//
// Persisted to chrome.storage.local; mirrors the useSyncExternalStore contract.

import type { CardImageOverride } from '@/lib/printing';

export type { CardImageOverride };

export const OVERRIDES_STORAGE_KEY = 'lugin:cardImageOverrides';
const STORAGE_KEY = OVERRIDES_STORAGE_KEY;

/** cardKey -> chosen printing. */
type OverrideMap = Record<string, CardImageOverride>;

let overrides: OverrideMap = {};
let loading = true;
const listeners = new Set<() => void>();

const emit = () => {
  for (const l of listeners) l();
};

const persist = async () => {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: overrides });
  } catch {
    // ignore storage failures (quota/private mode) — in-memory state still works
  }
};

// Load persisted overrides on startup.
void chrome.storage.local.get(STORAGE_KEY).then(stored => {
  const raw = stored[STORAGE_KEY] as OverrideMap | undefined;
  overrides = raw && typeof raw === 'object' ? raw : {};
  loading = false;
  emit();
});

export const cardImageOverrideStore = {
  /** Forget a card's override, reverting to the automatic guess. */
  async clear(key: string): Promise<void> {
    if (!(key in overrides)) return;
    const next = { ...overrides };
    delete next[key];
    overrides = next;
    emit();
    await persist();
  },

  getSnapshot(): OverrideMap {
    return overrides;
  },

  isLoading(): boolean {
    return loading;
  },

  /** Replace every override with a set from elsewhere (the user's other device). */
  async replaceAll(next: OverrideMap): Promise<void> {
    overrides = { ...next };
    loading = false;
    emit();
    await persist();
  },

  /** Remember the printing the user picked for this card (by cardKey). */
  async set(key: string, override: CardImageOverride): Promise<void> {
    overrides = { ...overrides, [key]: override };
    emit();
    await persist();
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
