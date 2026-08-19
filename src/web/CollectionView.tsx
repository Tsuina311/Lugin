// The collection, as a searchable list of what you own — editable on the phone.
//
// Rows are capped rather than virtualised. A real collection is tens of thousands
// of rows and a phone will not enjoy them all in the DOM, but the way anyone
// actually uses this screen is "do I own X" — so search narrows it, and the cap
// keeps scrolling smooth without a windowing dependency.
//
// You can add cards by name and step quantities up or down per row. Printings
// roll up to one line per card name; changing the count keeps the best-known
// printing and writes through to sync like a deck edit.
//
// Pictures are opt-in per row, which is the one place this deliberately differs
// from the desktop panel. Card images are ~100KB each and this screen is used in
// a shop, on mobile data — so the list stays text, and tapping a row's picture
// icon fetches that one card. Box view is the other half of the same choice:
// it's a grid of images, but you have to ask for it, and it shows fewer rows.

import { useEffect, useMemo, useState } from 'react';

import { ExportBar } from './ExportBar';
import { loadPrices } from './priceStore';
import { syncStore } from './syncStore';

import { cardImageUrl, printingRank } from '@/lib/cardImage';
import { cardKey, stripVersion } from '@/lib/cardName';
import type { Collection, CollectionCard } from '@/lib/collection';
import { parseDeckList } from '@/lib/deck';
import { collectionFile } from '@/lib/export';
import { collectionValue, money, signedMoney, type CollectionValue } from '@/lib/prices';
import { Picture } from '@/ui/components/Picture';
import { ViewToggle, type ViewShape } from '@/ui/components/ViewToggle';
import { Image as ImageIcon } from '@/ui/components/icons';
import { useSequentialImages } from '@/ui/components/useSequentialImages';
import { usePrices } from '@/ui/usePrices';

const VISIBLE_LIMIT = 150;

/** Fewer, because each one is a picture rather than a line of text. */
const BOX_LIMIT = 48;

const VIEW_KEY = 'lugin:webCollectionView';

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

/** A card name, and the best picture of the printing you own of it. */
interface Row {
  foil: number;
  key: string;
  name: string;
  src?: string;
  total: number;
}

/**
 * Roll the raw rows up per card, keeping one printing to show a picture of.
 *
 * Keyed exactly as `buildCollection` keys `byKey`, so the list length and the
 * "unique" count in the header can't drift apart and quietly disagree.
 *
 * The representative printing prefers whichever source pins the printing down
 * hardest — a Scryfall id, then a Cardmarket product id, then a set code — since
 * that decides whether the picture is your card or merely a card of that name.
 */
const rollUp = (collection: Collection): Row[] => {
  const map = new Map<string, Row & { rank: number }>();

  for (const card of collection.cards) {
    const key = cardKey(card.name);
    if (!key) continue;
    let row = map.get(key);
    if (!row) {
      row = { foil: 0, key, name: stripVersion(card.name), rank: 0, total: 0 };
      map.set(key, row);
    }
    const qty = card.quantity || 0;
    row.total += qty;
    if (card.foil) row.foil += qty;

    const rank = printingRank(card);
    if (rank > row.rank || !row.src) {
      const src = cardImageUrl(card);
      if (src) {
        row.src = src;
        row.rank = rank;
      }
    }
  }

  return [...map.values()]
    .map(({ rank: _rank, ...row }) => row)
    .sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * What it's worth, and what it has done since you bought it.
 *
 * Both numbers come with the size of the population they cover, because a total
 * over a collection that is partly unpriced is otherwise a confident lie. The gain
 * only ever speaks for the copies whose cost is recorded — ManaBox writes one on
 * every scanned row, so for a scanned collection that is most of them, and for a
 * hand-typed list it is none.
 */
const Worth = ({ value, stale }: { stale: boolean; value: CollectionValue }) => {
  if (value.copies === 0) return null;

  const caveats = [
    value.approxCopies > 0 ? `${value.approxCopies.toLocaleString()} estimated` : null,
    value.unpricedCopies > 0 ? `${value.unpricedCopies.toLocaleString()} without a price` : null,
    stale ? 'prices from an older download' : null,
  ].filter(Boolean);

  return (
    <div className="mt-2 flex items-baseline gap-2">
      <span className="text-base font-semibold tabular-nums text-ink">{money(value.cents)}</span>
      {value.gain === null ? null : (
        <span
          className={`text-[11px] font-medium tabular-nums ${
            value.gain >= 0 ? 'text-pos' : 'text-neg'
          }`}
          title={`Against ${money(value.cost)} paid for ${value.costCopies.toLocaleString()} cards`}
        >
          {signedMoney(value.gain)}
        </span>
      )}
      {caveats.length > 0 ? (
        <span className="min-w-0 flex-1 truncate text-right text-[10px] text-ink-faint">
          {caveats.join(' · ')}
        </span>
      ) : null}
    </div>
  );
};

export const CollectionView = ({ collection }: { collection: Collection | null }) => {
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState('');
  const { snapshot, stale } = usePrices(loadPrices);
  const value = useMemo(
    () => collectionValue(collection?.cards ?? [], snapshot),
    [collection, snapshot],
  );

  const [view, setView] = useState<ViewShape>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'box' ? 'box' : 'list';
    } catch {
      return 'list';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // a browser refusing storage still gets a working screen, just a forgetful one
    }
  }, [view]);

  /** Rows whose picture has been asked for, in list view. */
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setOpened(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const all = useMemo(() => (collection ? rollUp(collection) : []), [collection]);
  const rows = useMemo(() => {
    const needle = cardKey(query.trim());
    return needle ? all.filter(row => cardKey(row.name).includes(needle)) : all;
  }, [all, query]);

  const shown = rows.slice(0, view === 'box' ? BOX_LIMIT : VISIBLE_LIMIT);

  // One at a time, so a grid on a slow connection fills in from the top instead
  // of stalling on forty simultaneous requests.
  const wanted = useMemo(
    () =>
      shown
        .filter(row => view === 'box' || opened.has(row.key))
        .map(row => row.src)
        .filter((src): src is string => !!src),
    [opened, shown, view],
  );
  const loaded = useSequentialImages(wanted);

  const add = (text: string) => {
    const { cards } = parseDeckList(text);
    if (cards.length === 0) return;
    const incoming: CollectionCard[] = cards.map(card => ({
      foil: false,
      name: card.name,
      quantity: card.quantity,
      source: 'import',
    }));
    void syncStore.addCards(incoming, 'manual');
    setAdding('');
  };

  const setQuantity = (row: Row, quantity: number) =>
    void syncStore.setCollectionQuantity(row.key, quantity, row.name);

  const empty = !collection || collection.cards.length === 0;

  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-line bg-canvas/95 px-4 py-3 backdrop-blur">
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
        <input
          autoCapitalize="none"
          autoCorrect="off"
          className="mt-2 w-full rounded-lg border border-line-strong bg-raised px-3 py-2.5 text-base text-ink placeholder:text-ink-faint"
          onChange={event => setQuery(event.target.value)}
          placeholder="Search your collection"
          type="search"
          value={query}
        />
        <div className="mt-2 flex items-center gap-3">
          <p className="min-w-0 flex-1 text-[11px] text-ink-faint">
            {empty
              ? 'No cards yet'
              : `${collection.totalCards.toLocaleString()} cards, ${collection.uniqueCards.toLocaleString()} unique`}
            {query ? ` · ${rows.length.toLocaleString()} matching` : ''}
          </p>
          {!empty ? <ViewToggle onChange={setView} size="md" value={view} /> : null}
          {!empty ? (
            <ExportBar actions={['save', 'share']} file={() => collectionFile(collection)} />
          ) : null}
        </div>
        {!empty ? <Worth stale={stale} value={value} /> : null}
      </div>

      {empty ? (
        <p className="px-6 py-10 text-center text-sm text-ink-muted">
          Type a card name above, or paste a list — the same format as adding to a deck.
        </p>
      ) : null}

      {!empty && view === 'box' ? (
        <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3">
          {shown.map(row => (
            <div key={row.key} className="flex flex-col gap-1">
              <Picture alt={row.name} ready={!!row.src && loaded.has(row.src)} src={row.src} />
              <span className="truncate text-xs text-ink" title={row.name}>
                {row.name}
              </span>
              {row.foil > 0 ? (
                <span className="text-[11px] text-accent">{row.foil} foil</span>
              ) : null}
              <Stepper onChange={quantity => setQuantity(row, quantity)} quantity={row.total} />
            </div>
          ))}
        </div>
      ) : !empty ? (
        <ul className="divide-y divide-line">
          {shown.map(row => {
            const open = opened.has(row.key);
            return (
              <li key={row.key} className="px-2 py-1">
                <div className="flex items-center gap-2">
                  <Stepper onChange={quantity => setQuantity(row, quantity)} quantity={row.total} />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{row.name}</span>
                  {row.foil > 0 ? (
                    <span className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
                      {row.foil} foil
                    </span>
                  ) : null}
                  <button
                    aria-expanded={open}
                    aria-label={open ? `Hide the picture of ${row.name}` : `Show ${row.name}`}
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg active:bg-raised ${
                      open ? 'text-accent' : 'text-ink-faint'
                    }`}
                    onClick={() => toggle(row.key)}
                    type="button"
                  >
                    <ImageIcon aria-hidden size={18} />
                  </button>
                </div>
                {open ? (
                  <div className="mb-2 ml-2 w-44">
                    <Picture
                      alt={row.name}
                      ready={!!row.src && loaded.has(row.src)}
                      src={row.src}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {!empty && rows.length > shown.length ? (
        <p className="px-4 py-4 text-center text-xs text-ink-faint">
          Showing {shown.length} of {rows.length.toLocaleString()} — search to narrow it down.
        </p>
      ) : null}

      {!empty && rows.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-ink-muted">
          Nothing in your collection matches “{query}”.
        </p>
      ) : null}
    </div>
  );
};
