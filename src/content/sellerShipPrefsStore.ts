// Per-seller shipping preferences discovered while browsing Cardmarket.
// Used so estimates skip untracked letters when a seller (or CM) forces tracked.

const STORAGE_KEY = 'lugin:sellerShipPrefs';

export interface SellerShipPref {
  /** ISO-ish country name when last seen (Item location). */
  country?: string;
  /** Seller only ships tracked / registered to the buyer. */
  requireTracked?: boolean;
  updatedAt: number;
}

type PrefMap = Record<string, SellerShipPref>;

let map: PrefMap = {};
let hydrated = false;
const listeners = new Set<() => void>();

const emit = () => {
  for (const l of listeners) l();
};

const keyOf = (sellerName: string): string => sellerName.trim().toLowerCase();

const persist = async () => {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: map });
  } catch {
    // ignore
  }
};

const hydrate = async () => {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as PrefMap | undefined;
    if (raw && typeof raw === 'object') {
      map = raw;
      emit();
    }
  } catch {
    // ignore
  }
};

void hydrate();

export const sellerShipPrefsStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): PrefMap {
    return map;
  },
  get(sellerName: string): SellerShipPref | undefined {
    return map[keyOf(sellerName)];
  },
  async note(
    sellerName: string,
    patch: { country?: string; requireTracked?: boolean },
  ): Promise<void> {
    await hydrate();
    const key = keyOf(sellerName);
    if (!key) return;
    const prev = map[key];
    const next: SellerShipPref = {
      country: patch.country ?? prev?.country,
      requireTracked:
        patch.requireTracked != null ? patch.requireTracked : prev?.requireTracked,
      updatedAt: Date.now(),
    };
    if (
      next.country === prev?.country &&
      next.requireTracked === prev?.requireTracked
    ) {
      return;
    }
    map = { ...map, [key]: next };
    emit();
    await persist();
  },
};
