// Observable, persisted store for the user's imported card collection.
//
// We persist only the raw rows (StoredCollection) to chrome.storage.local and
// rebuild the derived `byKey` index in memory on load — keeping storage lean and
// the index always consistent with the rows. Mirrors the useSyncExternalStore
// contract used by the other stores.
//
// Rows carry a `source` ('import' | 'purchases') so we can re-sync one source
// (e.g. re-import a file, or fold in freshly-synced purchases) without touching
// or double-counting the other.

import { cardKey, stripVersion } from '@/lib/cardName';
import {
  buildCollection,
  parseCollection,
  type Collection,
  type CollectionCard,
  type StoredCollection,
} from '@/lib/collection';
import { isCardPurchase, type PurchaseIndex } from '@/sites/cardmarket/wants';

const STORAGE_KEY = 'lugin:collection';

// User preference: automatically fold purchases into the collection after a
// purchase sync. Off by default (some users don't keep what they buy). Stored
// in localStorage so the task-queue handler can read it synchronously.
export const PURCHASES_TO_COLLECTION_KEY = 'lugin:purchasesToCollection';
export const shouldAddPurchasesToCollection = (): boolean => {
  try {
    return localStorage.getItem(PURCHASES_TO_COLLECTION_KEY) === '1';
  } catch {
    return false;
  }
};
export const setAddPurchasesToCollection = (on: boolean): void => {
  try {
    localStorage.setItem(PURCHASES_TO_COLLECTION_KEY, on ? '1' : '0');
  } catch {
    // ignore storage failures
  }
};

interface CollectionState {
  collection: Collection | null;
  error: string | null;
  /** True until the initial async load from storage resolves. */
  loading: boolean;
}

let state: CollectionState = { collection: null, error: null, loading: true };
const listeners = new Set<() => void>();

const set = (partial: Partial<CollectionState>) => {
  state = { ...state, ...partial };
  for (const l of listeners) l();
};

/** Rebuild the index from rows, persist the raw rows, and publish. */
const persistCards = async (
  cards: CollectionCard[],
  source: string,
  format: Collection['format'],
): Promise<Collection> => {
  const collection = buildCollection(cards, source, format);
  const toStore: StoredCollection = {
    cards: collection.cards,
    format: collection.format,
    importedAt: collection.importedAt,
    source: collection.source,
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: toStore });
  set({ collection, error: null });
  return collection;
};

// Load any previously-imported collection on startup.
void chrome.storage.local.get(STORAGE_KEY).then(stored => {
  const raw = stored[STORAGE_KEY] as StoredCollection | undefined;
  if (raw?.cards) {
    set({
      collection: buildCollection(raw.cards, raw.source, raw.format, raw.importedAt),
      loading: false,
    });
  } else {
    set({ loading: false });
  }
});

export const collectionStore = {
  async clear() {
    await chrome.storage.local.remove(STORAGE_KEY);
    set({ collection: null, error: null });
  },

  getSnapshot(): CollectionState {
    return state;
  },

  /**
   * Import an uploaded file's text. Replaces the 'import'-sourced rows but keeps
   * any 'purchases'-sourced rows already folded in.
   */
  async importText(text: string, source: string): Promise<Collection> {
    const { cards, format } = parseCollection(text);
    if (cards.length === 0) {
      const err = 'No cards found in that file. Expected a ManaBox CSV or a deck list.';
      set({ error: err });
      throw new Error(err);
    }
    const imported: CollectionCard[] = cards.map(c => ({ ...c, source: 'import' }));
    const keptPurchases = (state.collection?.cards ?? []).filter(c => c.source === 'purchases');
    return persistCards([...imported, ...keptPurchases], source, format);
  },

  /**
   * Drop cards from the collection, addressed by the key the collection list
   * groups rows under (`stripVersion(cardKey(name))`) — so removing a row takes
   * every printing of that card with it, which is what the row stood for.
   *
   * Rows that came from purchase history will reappear on the next purchase
   * sync: the collection mirrors what you bought, and only the sync decides what
   * that is. Remove those from the purchase side, or turn the folding-in off.
   */
  async removeCards(keys: string[]): Promise<void> {
    const existing = state.collection;
    if (!existing) return;
    const doomed = new Set(keys.filter(Boolean));
    if (doomed.size === 0) return;
    const kept = existing.cards.filter(c => !doomed.has(stripVersion(cardKey(c.name))));
    if (kept.length === existing.cards.length) return;
    // Emptying it out goes back to the pristine "import a file" state rather than
    // leaving an empty collection that reads as a search with no matches.
    if (kept.length === 0) {
      await collectionStore.clear();
      return;
    }
    await persistCards(kept, existing.source, existing.format);
  },

  /**
   * Replace the whole collection with one that came from elsewhere (the user's
   * other device). The derived index is rebuilt here rather than carried over,
   * so what's stored stays the rows and nothing else.
   */
  async replaceAll(stored: StoredCollection | null): Promise<void> {
    if (!stored || stored.cards.length === 0) {
      await collectionStore.clear();
      return;
    }
    const collection = buildCollection(stored.cards, stored.source, stored.format, stored.importedAt);
    await chrome.storage.local.set({ [STORAGE_KEY]: stored });
    set({ collection, error: null, loading: false });
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /**
   * Fold the user's purchase history into the collection as 'purchases'-sourced
   * rows. Idempotent: replaces any previous purchases rows with the current set,
   * so re-syncing never double-counts. Keeps uploaded ('import') rows intact.
   */
  async syncFromPurchases(index: PurchaseIndex): Promise<Collection> {
    const purchaseRows: CollectionCard[] = [];
    for (const card of Object.values(index.cards)) {
      if (card.count <= 0) continue;
      // Skip non-cards (sleeves, deck boxes, sealed, bulk lots…) — the
      // collection is a card inventory, so accessories shouldn't appear.
      if (!isCardPurchase(card)) continue;
      // Group this card's purchases by exact printing — Cardmarket product id
      // when we have it, else the edition name — so each distinct printing owned
      // becomes its own row carrying the data needed to show *its* image.
      const byPrinting = new Map<string, CollectionCard>();
      let attributed = 0;
      for (const r of card.purchases ?? []) {
        const base = r.productId ?? r.edition ?? '';
        if (!base) continue; // no printing identity — folded into the remainder
        // Foil and non-foil of the same printing are distinct rows.
        const pkey = `${base}|${r.foil ? 'f' : 'n'}`;
        const qty = r.qty ?? 1;
        attributed += qty;
        const existingPrinting = byPrinting.get(pkey);
        if (existingPrinting) {
          existingPrinting.quantity += qty;
          if (!existingPrinting.productId && r.productId) existingPrinting.productId = r.productId;
          if (!existingPrinting.imageUrl && r.image) existingPrinting.imageUrl = r.image;
          if (!existingPrinting.setName && r.edition) existingPrinting.setName = r.edition;
        } else {
          byPrinting.set(pkey, {
            foil: !!r.foil,
            imageUrl: r.image,
            name: card.name,
            productId: r.productId,
            quantity: qty,
            setName: r.edition,
            source: 'purchases',
          });
        }
      }
      if (byPrinting.size === 0) {
        // Older records with no edition/product id — keep a plain name row so the
        // count still matches (its image falls back to a name lookup).
        purchaseRows.push({
          foil: false,
          name: card.name,
          quantity: card.count,
          source: 'purchases',
        });
        continue;
      }
      purchaseRows.push(...byPrinting.values());
      // Any quantity we couldn't attribute to a specific printing.
      const remainder = card.count - attributed;
      if (remainder > 0) {
        purchaseRows.push({
          foil: false,
          name: card.name,
          quantity: remainder,
          source: 'purchases',
        });
      }
    }

    const existing = state.collection;
    const keptOther = (existing?.cards ?? []).filter(c => c.source !== 'purchases');
    const source = existing?.source ?? 'Cardmarket purchases';
    const format = existing?.format ?? 'list';
    return persistCards([...keptOther, ...purchaseRows], source, format);
  },
};
