// Building a deck on a phone.
//
// Not a port of the desktop editor, which is a workbench: Scryfall search, mana
// curve, land balancing, EDHREC suggestions. Those want a big screen and a
// sitting-down kind of attention. This is the subset that has to exist wherever
// you are — start a deck, put cards in it, take cards out — so that "new deck"
// isn't a door into a room you can't furnish.
//
// Cards go in as text, which sounds primitive and isn't: the same box takes a
// typed name, a "2 Lightning Bolt" line, and a whole list pasted from Moxfield,
// because it hands the string to `parseDeckList` — the parser the desktop uses
// for the same job. Names already in your collection are offered as you type,
// since a phone keyboard is the worst possible place to spell Lim-Dûl's Vault.

import { useMemo, useState } from 'react';

import { ExportBar } from './ExportBar';
import { syncStore } from './syncStore';

import { cardKey } from '@/lib/cardName';
import type { Collection } from '@/lib/collection';
import {
  DECK_FORMATS,
  deckShortfall,
  formatInfo,
  mergeDeckCards,
  parseDeckList,
  withFormat,
  type Deck,
  type DeckCard,
  type DeckFormat,
  type DeckSection,
} from '@/lib/deck';
import { deckFile } from '@/lib/export';

const SECTIONS: readonly { id: DeckSection; label: string }[] = [
  { id: 'commander', label: 'Commander' },
  { id: 'main', label: 'Main deck' },
  { id: 'sideboard', label: 'Sideboard' },
];

const copies = (deck: Deck, section: DeckSection): number =>
  deck.cards.filter(card => card.section === section).reduce((sum, card) => sum + card.quantity, 0);

const same = (a: DeckCard, b: DeckCard): boolean =>
  a.section === b.section && cardKey(a.name) === cardKey(b.name);

/** How many collection names to offer. A phone dropdown past this is a wall. */
const SUGGESTIONS = 8;

const Stepper = ({
  onChange,
  quantity,
}: {
  onChange: (quantity: number) => void;
  quantity: number;
}) => (
  <span className="flex shrink-0 items-center gap-0.5">
    <button
      aria-label="One fewer"
      className="flex h-9 w-9 items-center justify-center rounded-lg text-lg leading-none text-ink-faint active:bg-raised"
      onClick={() => onChange(quantity - 1)}
      type="button"
    >
      −
    </button>
    <span className="w-6 text-center text-sm font-semibold tabular-nums text-ink">{quantity}</span>
    <button
      aria-label="One more"
      className="flex h-9 w-9 items-center justify-center rounded-lg text-lg leading-none text-ink-faint active:bg-raised"
      onClick={() => onChange(quantity + 1)}
      type="button"
    >
      +
    </button>
  </span>
);

export const DeckEditor = ({
  collection,
  deck,
  onBack,
}: {
  collection: Collection | null;
  deck: Deck;
  onBack: () => void;
}) => {
  const [name, setName] = useState(deck.name);
  const [adding, setAdding] = useState('');
  const [into, setInto] = useState<DeckSection>('main');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const missing = useMemo(
    () => (collection ? deckShortfall(deck.cards, collection.byKey) : []),
    [collection, deck],
  );

  const zones = useMemo(
    () => SECTIONS.filter(s => s.id !== 'commander' || formatInfo(deck.format).commanderZone),
    [deck.format],
  );

  // Straight from what you own, so it costs no network and is exactly the set of
  // cards you can actually build with today.
  const suggestions = useMemo(() => {
    const needle = cardKey(adding.trim());
    if (!collection || needle.length < 2 || adding.includes('\n')) return [];
    return Object.values(collection.byKey)
      .filter(row => cardKey(row.name).includes(needle))
      .slice(0, SUGGESTIONS)
      .map(row => row.name);
  }, [adding, collection]);

  const add = (text: string) => {
    const { cards } = parseDeckList(text);
    if (cards.length === 0) return;
    // A pasted list can name its own sections; a typed line can't, so anything
    // the parser defaulted to "main" goes wherever the button says instead.
    const placed = cards.map(card => (card.section === 'main' ? { ...card, section: into } : card));
    void syncStore.updateDeck(deck.id, d => ({ ...d, cards: mergeDeckCards(d.cards, placed) }));
    setAdding('');
  };

  const setQuantity = (card: DeckCard, quantity: number) =>
    void syncStore.updateDeck(deck.id, d => ({
      ...d,
      cards:
        quantity <= 0
          ? d.cards.filter(c => !same(c, card))
          : d.cards.map(c => (same(c, card) ? { ...c, quantity } : c)),
    }));

  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-line bg-canvas/95 px-2 py-2 backdrop-blur">
        <div className="flex items-center gap-1">
          <button
            className="shrink-0 rounded-md px-2 py-2 text-sm font-medium text-accent"
            onClick={onBack}
            type="button"
          >
            ‹ Decks
          </button>
          <input
            aria-label="Deck name"
            className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-2 text-sm font-semibold text-ink focus:border-line-strong"
            onBlur={() => void syncStore.updateDeck(deck.id, d => ({ ...d, name: name.trim() || d.name }))}
            onChange={event => setName(event.target.value)}
            value={name}
          />
        </div>
        <div className="mt-1 flex items-center gap-2 px-2">
          <select
            aria-label="Deck format"
            className="rounded-md border border-line-strong bg-raised px-2 py-1.5 text-xs text-ink"
            onChange={event =>
              void syncStore.updateDeck(deck.id, d =>
                withFormat(d, event.target.value as DeckFormat),
              )
            }
            value={deck.format}
          >
            {DECK_FORMATS.map(format => (
              <option key={format.id} value={format.id}>
                {format.label}
              </option>
            ))}
          </select>
          <span className="flex-1 text-[11px] tabular-nums text-ink-faint">
            {copies(deck, 'main') + copies(deck, 'commander')}
            {formatInfo(deck.format).targetSize ? `/${formatInfo(deck.format).targetSize}` : ''}{' '}
            cards
          </span>
          {/* Two taps, like the desktop's Clear: a deck is somebody's evening,
              and there is no undo for it on this device. */}
          <button
            className={`rounded-md px-2 py-1.5 text-xs font-medium ${
              confirmDelete ? 'bg-neg-soft text-neg' : 'text-ink-faint'
            }`}
            onBlur={() => setConfirmDelete(false)}
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                return;
              }
              void syncStore.removeDeck(deck.id);
              onBack();
            }}
            type="button"
          >
            {confirmDelete ? 'Delete for good?' : 'Delete'}
          </button>
        </div>
      </div>

      {/* Adding sits above the cards: it's what this screen is for, and hunting
          for it under a hundred rows would be absurd on a phone. */}
      <section className="border-b border-line px-4 py-3">
        {zones.length > 1 ? (
          <div className="mb-2 flex gap-1">
            {zones.map(zone => (
              <button
                key={zone.id}
                aria-pressed={into === zone.id}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
                  into === zone.id ? 'bg-accent text-accent-ink' : 'bg-raised text-ink-faint'
                }`}
                onClick={() => setInto(zone.id)}
                type="button"
              >
                {zone.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex gap-2">
          <input
            aria-label="Card to add"
            autoCapitalize="words"
            autoCorrect="off"
            className="min-w-0 flex-1 rounded-lg border border-line-strong bg-raised px-3 py-2.5 text-base text-ink placeholder:text-ink-faint"
            onChange={event => setAdding(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') add(adding);
            }}
            placeholder="Add a card, or paste a list"
            value={adding}
          />
          <button
            className="shrink-0 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-40"
            disabled={!adding.trim()}
            onClick={() => add(adding)}
            type="button"
          >
            Add
          </button>
        </div>
        {suggestions.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {suggestions.map(suggestion => (
              <li key={suggestion}>
                <button
                  className="rounded-full border border-line-strong px-2.5 py-1 text-xs text-ink-muted active:bg-raised"
                  onClick={() => add(suggestion)}
                  type="button"
                >
                  {suggestion}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="flex items-center gap-3 border-b border-line px-4 py-3">
        <p className="min-w-0 flex-1 text-[11px] leading-snug text-ink-faint">
          Copy the list to paste into ManaBox, Moxfield or Archidekt — all three import a deck as
          text.
        </p>
        <ExportBar actions={['copy', 'save', 'share']} file={() => deckFile(deck)} />
      </section>

      {collection && deck.cards.length > 0 ? (
        <section className="border-b border-line px-4 py-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {missing.length === 0 ? 'Nothing missing' : `Missing ${missing.length}`}
          </h2>
          {missing.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">You own every non-basic card in this deck.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {missing.map(card => (
                <li key={card.name} className="flex items-baseline gap-3 text-sm">
                  <span className="min-w-0 flex-1 truncate text-ink">{card.name}</span>
                  {card.owned > 0 ? (
                    <span className="shrink-0 text-[11px] text-ink-faint">have {card.owned}</span>
                  ) : null}
                  <span className="shrink-0 font-semibold tabular-nums text-neg">×{card.need}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {deck.cards.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-ink-muted">
          Nothing in this deck yet. Add cards above, or paste a list you already have.
        </p>
      ) : null}

      {SECTIONS.map(section => {
        const cards = deck.cards.filter(card => card.section === section.id);
        if (cards.length === 0) return null;
        return (
          <section key={section.id}>
            <h2 className="bg-panel px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              {section.label}
              <span className="ml-2 tabular-nums opacity-70">{copies(deck, section.id)}</span>
            </h2>
            <ul className="divide-y divide-line">
              {cards.map(card => (
                <li key={`${section.id}:${card.name}`} className="flex items-center gap-2 px-2 py-1">
                  <Stepper
                    onChange={quantity => setQuantity(card, quantity)}
                    quantity={card.quantity}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{card.name}</span>
                  <button
                    aria-label={`Remove ${card.name}`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-faint active:bg-raised"
                    onClick={() => setQuantity(card, 0)}
                    type="button"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
};
