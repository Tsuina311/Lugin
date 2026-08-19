// The collection, as a searchable list of what you own.
//
// Rows are capped rather than virtualised. A real collection is tens of thousands
// of rows and a phone will not enjoy them all in the DOM, but the way anyone
// actually uses this screen is "do I own X" — so search narrows it, and the cap
// keeps scrolling smooth without a windowing dependency.
//
// Pictures are opt-in per row, which is the one place this deliberately differs
// from the desktop panel. Card images are ~100KB each and this screen is used in
// a shop, on mobile data — so the list stays text, and tapping a row's picture
// icon fetches that one card. Box view is the other half of the same choice:
// it's a grid of images, but you have to ask for it, and it shows fewer rows.

import { useEffect, useMemo, useState } from 'react';

import { ExportBar } from './ExportBar';
import { loadPrices } from './priceStore';

import { cardImageUrl, printingRank } from '@/lib/cardImage';
import { cardKey, stripVersion } from '@/lib/cardName';
import type { Collection } from '@/lib/collection';
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

  if (!collection || collection.cards.length === 0) {
    return (
      <p className="px-6 py-10 text-center text-sm text-ink-muted">
        No collection has been synced yet.
      </p>
    );
  }

  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-line bg-canvas/95 px-4 py-3 backdrop-blur">
        <input
          autoCapitalize="none"
          autoCorrect="off"
          className="w-full rounded-lg border border-line-strong bg-raised px-3 py-2.5 text-base text-ink placeholder:text-ink-faint"
          onChange={event => setQuery(event.target.value)}
          placeholder="Search your collection"
          type="search"
          value={query}
        />
        <div className="mt-2 flex items-center gap-3">
          <p className="min-w-0 flex-1 text-[11px] text-ink-faint">
            {collection.totalCards.toLocaleString()} cards, {collection.uniqueCards.toLocaleString()}{' '}
            unique
            {query ? ` · ${rows.length.toLocaleString()} matching` : ''}
          </p>
          <ViewToggle onChange={setView} size="md" value={view} />
          {/* The whole collection, not the search results: a filtered export would
              quietly hand another app a fraction of what you own.

              No Copy here, unlike a deck. A collection is tens of thousands of
              rows, which is past what a phone's clipboard will carry, and the apps
              that read a collection — ManaBox included — want a file for it
              anyway. */}
          <ExportBar actions={['save', 'share']} file={() => collectionFile(collection)} />
        </div>
        <Worth stale={stale} value={value} />
      </div>

      {view === 'box' ? (
        <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3">
          {shown.map(row => (
            <div key={row.key} className="flex flex-col gap-1">
              <Picture alt={row.name} ready={!!row.src && loaded.has(row.src)} src={row.src} />
              <span className="truncate text-xs text-ink" title={row.name}>
                {row.name}
              </span>
              <span className="flex items-center gap-1.5 text-[11px] text-ink-faint">
                <span className="font-semibold tabular-nums text-ink-muted">×{row.total}</span>
                {row.foil > 0 ? <span className="text-accent">{row.foil} foil</span> : null}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map(row => {
            const open = opened.has(row.key);
            return (
              <li key={row.key} className="px-4 py-3">
                <div className="flex items-baseline gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{row.name}</span>
                  {row.foil > 0 ? (
                    <span className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
                      {row.foil} foil
                    </span>
                  ) : null}
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-muted">
                    ×{row.total}
                  </span>
                  {/* Self-anchored rather than in a toolbar: it's about this card,
                      and on a phone the thumb is already at the row. */}
                  <button
                    aria-expanded={open}
                    aria-label={open ? `Hide the picture of ${row.name}` : `Show ${row.name}`}
                    className={`-my-2 -mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                      open ? 'text-accent' : 'text-ink-faint'
                    }`}
                    onClick={() => toggle(row.key)}
                    type="button"
                  >
                    <ImageIcon aria-hidden size={18} />
                  </button>
                </div>
                {open ? (
                  <div className="mt-2 w-44">
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
      )}

      {rows.length > shown.length ? (
        <p className="px-4 py-4 text-center text-xs text-ink-faint">
          Showing {shown.length} of {rows.length.toLocaleString()} — search to narrow it down.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-ink-muted">
          Nothing in your collection matches “{query}”.
        </p>
      ) : null}
    </div>
  );
};
