// Observable, persisted store for Cardmarket shipping costs.
//
// The user's home country is the shipping *destination* (auto-detected from
// their account). Shipping matrices are fetched lazily, one route at a time:
// when you open a seller's page we fetch just that seller-country → home-country
// route and cache it. No bulk sync needed. Cached routes are reused until they
// go stale (prices drift), then transparently refetched. Mirrors the
// useSyncExternalStore contract used by the other stores.

import {
  fetchHomeCountryId,
  fetchShippingMatrix,
  type ShipMethod,
} from '@/sites/cardmarket/shipping';

const STORAGE_KEY = 'lugin:shipping';
// Cached shipping rates are reused for a week, then refetched on next use.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface StoredShipping {
  /** fromCountryId → shipping methods to `toCountry`. */
  matrices: Record<number, ShipMethod[]>;
  /** fromCountryId → when that route was fetched (ms), for staleness. */
  stamps: Record<number, number>;
  toCountry: number | null;
}

interface ShippingState extends StoredShipping {
  /** Source-country id → last fetch error. */
  errors: Record<number, string>;
  /** True until the initial async load from storage resolves. */
  loading: boolean;
  /** Source-country ids currently being fetched. */
  pending: number[];
}

let state: ShippingState = {
  errors: {},
  loading: true,
  matrices: {},
  pending: [],
  stamps: {},
  toCountry: null,
};

const listeners = new Set<() => void>();

const set = (partial: Partial<ShippingState>) => {
  state = { ...state, ...partial };
  for (const l of listeners) l();
};

const persist = async () => {
  const toStore: StoredShipping = {
    matrices: state.matrices,
    stamps: state.stamps,
    toCountry: state.toCountry,
  };
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: toStore });
  } catch {
    // best-effort; ignore storage failures
  }
};

void chrome.storage.local.get(STORAGE_KEY).then(stored => {
  const raw = stored[STORAGE_KEY] as StoredShipping | undefined;
  if (raw) {
    set({
      loading: false,
      matrices: raw.matrices ?? {},
      stamps: raw.stamps ?? {},
      toCountry: raw.toCountry ?? null,
    });
  } else {
    set({ loading: false });
  }
});

const inFlight = new Set<number>();

export const shippingStore = {
  async clear() {
    inFlight.clear();
    set({ errors: {}, matrices: {}, pending: [], stamps: {}, toCountry: null });
    await chrome.storage.local.remove(STORAGE_KEY);
  },

  /**
   * Auto-detect the home country from the user's Cardmarket account page and
   * set it. Best-effort — returns the detected id (or undefined on failure).
   */
  async detectHomeCountry(): Promise<number | undefined> {
    try {
      const id = await fetchHomeCountryId();
      if (id != null) await this.setToCountry(id);
      return id ?? undefined;
    } catch {
      return undefined;
    }
  },

  /**
   * Ensure the shipping matrix from `fromCountryId` to the home country is
   * loaded, fetching it once if it's missing or stale. Cheap to call on every
   * render — it no-ops when a fresh copy is cached or a fetch is already in
   * flight. Pass `force` to refetch regardless (e.g. a manual refresh).
   */
  async ensureMatrix(fromCountryId: number | null | undefined, force = false): Promise<void> {
    // Note: fromCountryId === toCountry is a valid *domestic* route (e.g.
    // Belgium → Belgium) and must be fetched like any other.
    const to = state.toCountry;
    if (to == null || fromCountryId == null) return;
    if (inFlight.has(fromCountryId)) return;
    if (!force && this.isFresh(fromCountryId)) return;

    inFlight.add(fromCountryId);
    const nextErrors = { ...state.errors };
    delete nextErrors[fromCountryId];
    set({ errors: nextErrors, pending: [...state.pending, fromCountryId] });
    try {
      const methods = await fetchShippingMatrix(fromCountryId, to);
      set({
        matrices: { ...state.matrices, [fromCountryId]: methods },
        pending: state.pending.filter(id => id !== fromCountryId),
        stamps: { ...state.stamps, [fromCountryId]: Date.now() },
      });
      await persist();
    } catch (err) {
      set({
        errors: {
          ...state.errors,
          [fromCountryId]: err instanceof Error ? err.message : String(err),
        },
        pending: state.pending.filter(id => id !== fromCountryId),
      });
    } finally {
      inFlight.delete(fromCountryId);
    }
  },

  /** Shipping methods from a source country to the user's home country. */
  getMatrix(fromCountryId?: number | null): ShipMethod[] | undefined {
    if (fromCountryId == null) return undefined;
    return state.matrices[fromCountryId];
  },

  getSnapshot(): ShippingState {
    return state;
  },

  /** Whether a cached route is still fresh enough to reuse. */
  isFresh(fromCountryId?: number | null): boolean {
    if (fromCountryId == null) return false;
    const ts = state.stamps[fromCountryId];
    return ts != null && Date.now() - ts < MAX_AGE_MS && !!state.matrices[fromCountryId];
  },

  /**
   * Set the home (destination) country. Changing it invalidates every cached
   * matrix (they were computed to the previous destination).
   */
  async setToCountry(id: number | null) {
    if (id === state.toCountry) return;
    set({ errors: {}, matrices: {}, stamps: {}, toCountry: id });
    await persist();
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
