// Persisted known-offer observations (chrome.storage.local). Bounded retention
// — see knownPriceMap prune rules. Buyer-side only; no remote logic.

import {
  emptyKnownPriceMap,
  recordObservations,
  type KnownOfferObservation,
  type KnownPriceEntry,
} from '@/lib/knownPriceMap';

const STORAGE_KEY = 'lugin:knownPriceMap';

let map: Record<string, KnownPriceEntry> = emptyKnownPriceMap();
let hydrated = false;
const listeners = new Set<() => void>();

const emit = () => {
  for (const l of listeners) l();
};

const persist = async () => {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: map });
  } catch {
    // Quota / context failures — keep in-memory map.
  }
};

const hydrate = async () => {
  if (hydrated) return;
  hydrated = true;
  try {
    const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as
      | Record<string, KnownPriceEntry>
      | undefined;
    if (stored && typeof stored === 'object') {
      map = stored;
      emit();
    }
  } catch {
    // ignore
  }
};

void hydrate();

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[STORAGE_KEY]) return;
    const next = changes[STORAGE_KEY].newValue as Record<string, KnownPriceEntry> | undefined;
    if (next && typeof next === 'object') {
      map = next;
      emit();
    }
  });
} catch {
  // Non-extension test contexts.
}

export const knownPriceStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): Record<string, KnownPriceEntry> {
    return map;
  },
  async note(observations: readonly KnownOfferObservation[]): Promise<void> {
    await hydrate();
    if (observations.length === 0) return;
    map = recordObservations(map, observations);
    emit();
    await persist();
  },
};
