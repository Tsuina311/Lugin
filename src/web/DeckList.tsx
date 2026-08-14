// Decks, and the one question worth asking about them away from the desk:
// what's still missing?
//
// `deckShortfall` is the extension's own comparison, reused unchanged — so the
// shopping list on the phone can't drift from the one on the desktop.

import { useMemo, useState } from 'react';

import { ShareButton } from './ShareButton';

import type { Collection } from '@/lib/collection';
import { deckShortfall, type Deck, type DeckSection } from '@/lib/deck';
import { deckFile } from '@/lib/export';

const SECTIONS: readonly { id: DeckSection; label: string }[] = [
  { id: 'commander', label: 'Commander' },
  { id: 'main', label: 'Main deck' },
  { id: 'sideboard', label: 'Sideboard' },
];

const copies = (deck: Deck, section: DeckSection): number =>
  deck.cards.filter(card => card.section === section).reduce((sum, card) => sum + card.quantity, 0);

const DeckDetail = ({
  collection,
  deck,
  onBack,
}: {
  collection: Collection | null;
  deck: Deck;
  onBack: () => void;
}) => {
  const missing = useMemo(
    () => (collection ? deckShortfall(deck.cards, collection.byKey) : []),
    [collection, deck],
  );

  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-canvas/95 px-2 py-2 backdrop-blur">
        <button
          className="rounded-md px-2 py-2 text-sm font-medium text-accent"
          onClick={onBack}
          type="button"
        >
          ‹ Decks
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">{deck.name}</span>
        <ShareButton className="mr-1" file={() => deckFile(deck)} label="Send to ManaBox" />
      </div>

      {collection ? (
        <section className="border-b border-line px-4 py-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {missing.length === 0 ? 'Nothing missing' : `Missing ${missing.length}`}
          </h2>
          {missing.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">
              You own every non-basic card in this deck.
            </p>
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
                <li
                  key={`${section.id}:${card.name}`}
                  className="flex items-baseline gap-3 px-4 py-2.5"
                >
                  <span className="shrink-0 text-sm tabular-nums text-ink-faint">
                    {card.quantity}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{card.name}</span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
};

export const DeckList = ({
  collection,
  decks,
}: {
  collection: Collection | null;
  decks: readonly Deck[];
}) => {
  const [openId, setOpenId] = useState<string | null>(null);

  const open = decks.find(deck => deck.id === openId);
  if (open) return <DeckDetail collection={collection} deck={open} onBack={() => setOpenId(null)} />;

  if (decks.length === 0) {
    return (
      <p className="px-6 py-10 text-center text-sm text-ink-muted">No decks have been synced yet.</p>
    );
  }

  const sorted = [...decks].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <ul className="divide-y divide-line">
      {sorted.map(deck => {
        const missing = collection ? deckShortfall(deck.cards, collection.byKey).length : 0;
        return (
          <li key={deck.id}>
            <button
              className="flex w-full items-center gap-3 px-4 py-4 text-left active:bg-raised"
              onClick={() => setOpenId(deck.id)}
              type="button"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{deck.name}</span>
                <span className="mt-0.5 block text-[11px] capitalize text-ink-faint">
                  {deck.format} · {copies(deck, 'main') + copies(deck, 'commander')} cards
                </span>
              </span>
              {missing > 0 ? (
                <span className="shrink-0 rounded bg-neg-soft px-1.5 py-0.5 text-[10px] font-medium text-neg">
                  {missing} missing
                </span>
              ) : null}
              <span className="shrink-0 text-ink-faint">›</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
};
