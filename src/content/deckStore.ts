// Observable, persisted store for the user's decks.
//
// Decks live in chrome.storage.local (so they survive across sessions and are
// shared between tabs) and are exposed through the useSyncExternalStore contract
// used by the other stores. All mutations go through this store so persistence
// and change-notification stay in one place.

import { cardKey } from '@/lib/cardName';
import {
  countCards,
  newDeckId,
  parseDeckList,
  type Deck,
  type DeckCard,
  type DeckFormat,
  type DeckSection,
} from '@/lib/deck';
import { isBasicLand, type BasicPlan } from '@/lib/lands';

const STORAGE_KEY = 'lugin:decks';

interface DeckState {
  decks: Deck[];
  error: string | null;
  loading: boolean;
}

let state: DeckState = { decks: [], error: null, loading: true };
const listeners = new Set<() => void>();

const emit = () => {
  for (const l of listeners) l();
};

const set = (patch: Partial<DeckState>) => {
  state = { ...state, ...patch };
  emit();
};

const persist = async (decks: Deck[]) => {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: decks });
  } catch {
    // ignore storage failures — in-memory state still works this session
  }
};

// Sort newest-updated first for the deck list.
const byRecent = (a: Deck, b: Deck) => b.updatedAt - a.updatedAt;

void chrome.storage.local.get(STORAGE_KEY).then(stored => {
  const raw = stored[STORAGE_KEY] as Deck[] | undefined;
  // Coerce decks saved before `format` existed so the UI stays controlled.
  const decks = Array.isArray(raw)
    ? raw.map(d => ({ ...d, format: d.format ?? 'freeform' })).sort(byRecent)
    : [];
  state = { decks, error: null, loading: false };
  emit();
});

/** A card in a deck, as the bulk operations address it. */
export interface DeckCardRef {
  name: string;
  section: DeckSection;
}

/** Normalize refs to comparable card keys, dropping blanks. */
const cardRefs = (cards: DeckCardRef[]): { key: string; section: DeckSection }[] =>
  cards.map(c => ({ key: cardKey(c.name), section: c.section })).filter(r => r.key);

const matches = (card: DeckCard, ref: { key: string; section: DeckSection }): boolean =>
  card.section === ref.section && cardKey(card.name) === ref.key;

/** Replace one deck (by id) via an updater and persist; bumps updatedAt. */
const mutateDeck = async (id: string, update: (d: Deck) => Deck): Promise<void> => {
  let changed = false;
  const decks = state.decks.map(d => {
    if (d.id !== id) return d;
    changed = true;
    return { ...update(d), updatedAt: Date.now() };
  });
  if (!changed) return;
  decks.sort(byRecent);
  set({ decks });
  await persist(decks);
};

export const deckStore = {
  /** Add a card (or bump its quantity) in a deck's section. */
  async addCard(id: string, name: string, section: DeckSection = 'main', qty = 1): Promise<void> {
    const key = cardKey(name);
    if (!key) return;
    await mutateDeck(id, d => {
      const cards = [...d.cards];
      const i = cards.findIndex(c => c.section === section && cardKey(c.name) === key);
      if (i >= 0) cards[i] = { ...cards[i], quantity: cards[i].quantity + qty };
      else cards.push({ name, quantity: qty, section });
      return { ...d, cards };
    });
  },

  /**
   * Add several cards to one section in a single write — bulk adds from the
   * suggestion panels would otherwise race each other through storage.
   */
  async addCards(id: string, names: string[], section: DeckSection = 'main'): Promise<void> {
    await mutateDeck(id, d => {
      const cards = [...d.cards];
      for (const name of names) {
        const key = cardKey(name);
        if (!key) continue;
        const i = cards.findIndex(c => c.section === section && cardKey(c.name) === key);
        if (i >= 0) cards[i] = { ...cards[i], quantity: cards[i].quantity + 1 };
        else cards.push({ name, quantity: 1, section });
      }
      return { ...d, cards };
    });
  },

  /**
   * Remove every basic land from the main deck, and stop auto-balancing so they
   * don't come straight back.
   */
  async clearBasicLands(id: string): Promise<void> {
    await mutateDeck(id, d => ({
      ...d,
      autoLands: false,
      cards: d.cards.filter(c => !(c.section === 'main' && isBasicLand(c.name))),
    }));
  },

  /** Create a new empty deck and return its id. */
  async create(name = 'New deck', format: DeckFormat = 'commander'): Promise<string> {
    const now = Date.now();
    const deck: Deck = {
      cards: [],
      createdAt: now,
      format,
      id: newDeckId(),
      name: name.trim() || 'New deck',
      source: 'manual',
      updatedAt: now,
    };
    const decks = [deck, ...state.decks].sort(byRecent);
    set({ decks });
    await persist(decks);
    return deck.id;
  },

  getSnapshot(): DeckState {
    return state;
  },

  /**
   * Import a decklist as a NEW deck. Returns the new deck's id, or null when the
   * text held no recognizable cards.
   */
  async importText(text: string, source: string): Promise<string | null> {
    const { cards, name } = parseDeckList(text);
    if (cards.length === 0) {
      set({ error: 'No cards found in that list.' });
      return null;
    }
    // Guess Commander when the list carried a Commander section; otherwise leave
    // it freeform (the user can switch formats in the editor).
    const format: DeckFormat = cards.some(c => c.section === 'commander')
      ? 'commander'
      : 'freeform';
    const now = Date.now();
    const deck: Deck = {
      cards,
      createdAt: now,
      format,
      id: newDeckId(),
      name: (name ?? source.replace(/\.[^.]+$/, '')).trim() || 'Imported deck',
      source,
      updatedAt: now,
    };
    const decks = [deck, ...state.decks].sort(byRecent);
    set({ decks, error: null });
    await persist(decks);
    return deck.id;
  },

  /** Merge an imported decklist into an existing deck. */
  async mergeText(id: string, text: string): Promise<void> {
    const { cards } = parseDeckList(text);
    if (cards.length === 0) return;
    await mutateDeck(id, d => {
      const next = [...d.cards];
      for (const c of cards) {
        const i = next.findIndex(
          x => x.section === c.section && cardKey(x.name) === cardKey(c.name),
        );
        if (i >= 0) next[i] = { ...next[i], quantity: next[i].quantity + c.quantity };
        else next.push(c);
      }
      return { ...d, cards: next };
    });
  },

  /**
   * Move cards to another section, keeping their quantities and merging with
   * anything already there. Cards already in `to` are left where they are.
   */
  async moveCards(id: string, cards: DeckCardRef[], to: DeckSection): Promise<void> {
    const refs = cardRefs(cards).filter(r => r.section !== to);
    if (refs.length === 0) return;
    await mutateDeck(id, d => {
      const moving = d.cards.filter(c => refs.some(r => matches(c, r)));
      const next = d.cards.filter(c => !refs.some(r => matches(c, r)));
      for (const card of moving) {
        const key = cardKey(card.name);
        const i = next.findIndex(c => c.section === to && cardKey(c.name) === key);
        if (i >= 0) next[i] = { ...next[i], quantity: next[i].quantity + card.quantity };
        else next.push({ ...card, section: to });
      }
      return { ...d, cards: next };
    });
  },

  /** Delete a deck. */
  async remove(id: string): Promise<void> {
    await deckStore.removeDecks([id]);
  },

  /** Remove a card from a deck. */
  async removeCard(id: string, name: string, section: DeckSection): Promise<void> {
    await deckStore.removeCards(id, [{ name, section }]);
  },

  /** Remove several cards from a deck in a single write. */
  async removeCards(id: string, cards: DeckCardRef[]): Promise<void> {
    const refs = cardRefs(cards);
    if (refs.length === 0) return;
    await mutateDeck(id, d => ({
      ...d,
      cards: d.cards.filter(c => !refs.some(r => matches(c, r))),
    }));
  },

  /** Delete several decks in a single write. */
  async removeDecks(ids: string[]): Promise<void> {
    const doomed = new Set(ids);
    const decks = state.decks.filter(d => !doomed.has(d.id));
    if (decks.length === state.decks.length) return;
    set({ decks });
    await persist(decks);
  },

  
  /** Rename a deck. */
async rename(id: string, name: string): Promise<void> {
    await mutateDeck(id, d => ({ ...d, name: name.trim() || d.name }));
  },

  
  /**
   * Replace every deck with a set that came from somewhere else — today, the
   * user's other device. Not a merge: whoever calls this has already decided
   * which version wins, and a store that second-guessed that would make the
   * decision impossible to reason about.
   */
async replaceAll(decks: Deck[]): Promise<void> {
    const next = [...decks].sort(byRecent);
    set({ decks: next, error: null });
    await persist(next);
  },

  /** Turn auto-balancing of basic lands on or off (existing lands are kept). */
  async setAutoLands(id: string, on: boolean): Promise<void> {
    await mutateDeck(id, d => ({ ...d, autoLands: on }));
  },

  /**
   * Replace the main deck's basic lands with `plan` (card name -> copies).
   * Basics elsewhere (sideboard, command zone) are left alone.
   */
  async setBasicLands(id: string, plan: BasicPlan): Promise<void> {
    await mutateDeck(id, d => {
      const cards = d.cards.filter(c => !(c.section === 'main' && isBasicLand(c.name)));
      for (const [name, quantity] of Object.entries(plan)) {
        if (quantity > 0) cards.push({ name, quantity, section: 'main' });
      }
      return { ...d, cards };
    });
  },

  /**
   * Change a deck's format. Leaving Commander moves any command-zone cards back
   * into the main deck so they aren't stranded in a now-hidden zone.
   */
  async setFormat(id: string, format: DeckFormat): Promise<void> {
    await mutateDeck(id, d => {
      const cards =
        format === 'commander'
          ? d.cards
          : d.cards.map(c => (c.section === 'commander' ? { ...c, section: 'main' as const } : c));
      return { ...d, cards, format };
    });
  },

  /** Set how many lands this deck should run (null returns to the format's). */
  async setLandTarget(id: string, lands: number | null): Promise<void> {
    await mutateDeck(id, d => ({
      ...d,
      landTarget: lands == null ? undefined : Math.max(0, Math.round(lands)),
    }));
  },

  /** Set a card's quantity (removes it when the quantity drops to 0). */
  async setQuantity(id: string, name: string, section: DeckSection, qty: number): Promise<void> {
    const key = cardKey(name);
    await mutateDeck(id, d => {
      if (qty <= 0) {
        return {
          ...d,
          cards: d.cards.filter(c => !(c.section === section && cardKey(c.name) === key)),
        };
      }
      return {
        ...d,
        cards: d.cards.map(c =>
          c.section === section && cardKey(c.name) === key ? { ...c, quantity: qty } : c,
        ),
      };
    });
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export { countCards };
