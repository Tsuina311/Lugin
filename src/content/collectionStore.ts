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

import { arrivedOnly } from '@/lib/arrivedPurchases';
import { cardKey, stripVersion } from '@/lib/cardName';
import {
  buildCollection,
  type Collection,
  type CollectionCard,
  type StoredCollection,
} from '@/lib/collection';
import { applyImport } from '@/lib/duplicates';
import { addPaid, everyPaid, withCost, type Paid } from '@/lib/purchaseCost';
import {
  pruneVerdicts,
  splitPurchases,
  type HeldPurchase,
  type PurchaseVerdict,
  type PurchaseVerdicts,
} from '@/lib/purchaseDuplicates';
import { isCardPurchase, type PurchaseIndex } from '@/sites/cardmarket/wants';

const STORAGE_KEY = 'lugin:collection';

/**
 * The purchase-vs-collection questions and their answers.
 *
 * Kept out of STORAGE_KEY because it isn't part of the collection: the rows are
 * replaced wholesale by every fold-in, and this has to outlive that. `held` is
 * derived, but persisting it is what lets the question survive a browser
 * restart — a background auto-add that asked only until the tab closed would
 * withhold cards and never say why.
 */
const DUPES_KEY = 'lugin:purchaseDupes';

interface StoredDupes {
  decided: Record<string, PurchaseVerdict>;
  held: HeldPurchase[];
}

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
  /**
   * What the last `clear()` threw away, so it can be put back.
   *
   * A collection is the one thing here nobody can reconstruct: it represents an
   * afternoon of scanning cards, and the local copy is the only copy until a sync
   * has run. Held in memory only — an undo that survived a page reload would be a
   * promise this store cannot keep, and offering it would be worse than not.
   */
  cleared: StoredCollection | null;
  collection: Collection | null;
  error: string | null;
  /**
   * Purchases that look like cards already in the collection, withheld until the
   * owner says which they are. Empty in the ordinary case.
   */
  heldPurchases: HeldPurchase[];
  /** True until the initial async load from storage resolves. */
  loading: boolean;
}

let state: CollectionState = {
  cleared: null,
  collection: null,
  error: null,
  heldPurchases: [],
  loading: true,
};

/** Answers only; the held list lives in `state` so the UI re-renders with it. */
let verdicts: PurchaseVerdicts = {};
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
  // Any deliberate write makes a pending undo stale: offering to restore what was
  // cleared *before* an import would silently discard the import.
  set({ cleared: null, collection, error: null });
  return collection;
};

const persistDupes = async (held: HeldPurchase[]): Promise<void> => {
  const toStore: StoredDupes = { decided: { ...verdicts }, held };
  await chrome.storage.local.set({ [DUPES_KEY]: toStore });
  set({ heldPurchases: held });
};

// Load any previously-imported collection on startup.
void chrome.storage.local.get([STORAGE_KEY, DUPES_KEY]).then(stored => {
  const dupes = stored[DUPES_KEY] as StoredDupes | undefined;
  verdicts = dupes?.decided ?? {};
  const raw = stored[STORAGE_KEY] as StoredCollection | undefined;
  if (raw?.cards) {
    set({
      collection: buildCollection(raw.cards, raw.source, raw.format, raw.importedAt),
      heldPurchases: dupes?.held ?? [],
      loading: false,
    });
  } else {
    set({ heldPurchases: dupes?.held ?? [], loading: false });
  }
});

export const collectionStore = {
  async clear() {
    const existing = state.collection;
    await chrome.storage.local.remove(STORAGE_KEY);
    set({
      cleared: existing
        ? {
            cards: existing.cards,
            format: existing.format,
            importedAt: existing.importedAt,
            source: existing.source,
          }
        : null,
      collection: null,
      error: null,
    });
    // Nothing is left for a purchase to be a duplicate of. The answers stay:
    // `undoClear` can put the rows back, and they'd be about those rows again.
    await persistDupes([]);
  },

  /**
   * Record what the owner decided about withheld purchases and fold the history
   * in again, which is what actually adds the ones they called separate.
   */
  async decidePurchaseDuplicates(
    answers: Record<string, PurchaseVerdict>,
    index: PurchaseIndex,
  ): Promise<Collection> {
    verdicts = { ...verdicts, ...answers };
    return collectionStore.syncFromPurchases(index);
  },

  getSnapshot(): CollectionState {
    return state;
  },

  /**
   * Fold a reviewed import into the collection, keeping what is already there.
   *
   * Adding rather than replacing is the whole point: two ManaBox binders, or a
   * scan and a year of Cardmarket purchases, are meant to accumulate. What stops
   * that from double-counting is the caller having already been through the rows
   * one by one — `duplicates` are the ones the user said they already own, and
   * those are dropped rather than merged.
   */
  async mergeImport(options: {
    cards: CollectionCard[];
    duplicates?: Iterable<number>;
    format: Collection['format'];
    source: string;
  }): Promise<Collection> {
    const { cards, duplicates = [], format, source } = options;
    if (cards.length === 0) {
      const err = 'Nothing to import from that file.';
      set({ error: err });
      throw new Error(err);
    }
    const existing = state.collection;
    const merged = applyImport(existing?.cards ?? [], cards, duplicates);
    // Keep the established format once there is one: after a merge the label
    // describes the collection, not the last file to land in it.
    return persistCards(merged, source, existing?.format ?? format);
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
   *
   * Only what has arrived: a card still in the post is not in the binder, and a
   * collection that lists it is one you can't trust when you go looking. The
   * filter runs first so everything below — counts, printings, cost basis — is
   * computed from the copies actually in hand.
   */
  async syncFromPurchases(full: PurchaseIndex): Promise<Collection> {
    const index = arrivedOnly(full);
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
      // What each printing cost, accumulated alongside the rows. Kept separate
      // because the unit basis is only knowable once every order line for that
      // printing has been seen.
      //
      // Cardmarket has known these figures all along — `PurchaseRecord.price` is
      // parsed off every order line — but the sync never carried them onto the
      // collection row, so gain-since-purchase silently only worked for people who
      // had also imported a ManaBox CSV.
      const paidByPrinting = new Map<string, Paid>();
      let attributed = 0;
      for (const r of card.purchases ?? []) {
        const base = r.productId ?? r.edition ?? '';
        if (!base) continue; // no printing identity — folded into the remainder
        // Foil and non-foil of the same printing are distinct rows.
        const pkey = `${base}|${r.foil ? 'f' : 'n'}`;
        const qty = r.qty ?? 1;
        attributed += qty;
        addPaid(paidByPrinting, pkey, r, qty);
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
          ...withCost(everyPaid(card.purchases)),
          quantity: card.count,
          source: 'purchases',
        });
        continue;
      }
      for (const [pkey, row] of byPrinting) {
        Object.assign(row, withCost(paidByPrinting.get(pkey)));
      }
      purchaseRows.push(...byPrinting.values());
      // Any quantity we couldn't attribute to a specific printing.
      const remainder = card.count - attributed;
      if (remainder > 0) {
        purchaseRows.push({
          foil: false,
          name: card.name,
          // Priced from every order line for this card: the copies that landed here
          // are the ones we know least about, so the card's own average is the best
          // basis available for them.
          ...withCost(everyPaid(card.purchases)),
          quantity: remainder,
          source: 'purchases',
        });
      }
    }

    const existing = state.collection;
    const keptOther = (existing?.cards ?? []).filter(c => c.source !== 'purchases');
    // Only against rows this sync isn't replacing: purchase rows are re-derived
    // wholesale, so matching against them would pair every card with its own
    // previous self and withhold the entire history.
    verdicts = pruneVerdicts(verdicts, purchaseRows);
    const { add, held } = splitPurchases(purchaseRows, keptOther, verdicts);
    const source = existing?.source ?? 'Cardmarket purchases';
    const format = existing?.format ?? 'list';
    const collection = await persistCards([...keptOther, ...add], source, format);
    await persistDupes(held);
    return collection;
  },

  /** Put back what the last `clear()` removed. No-op once anything else is written. */
  async undoClear(): Promise<void> {
    const held = state.cleared;
    if (!held) return;
    await collectionStore.replaceAll(held);
    set({ cleared: null });
  },
};
