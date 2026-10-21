// The collection, as a searchable list of what you own — editable on the phone.
//
// Rows are capped rather than virtualised. A real collection is tens of thousands
// of rows and a phone will not enjoy them all in the DOM, but the way anyone
// actually uses this screen is "do I own X" — so search narrows it, and the cap
// keeps scrolling smooth without a windowing dependency.
//
// One list row per card name. When you own several printings, the row unfolds to
// show each edition with its own picture and quantity stepper.
//
// List rows show small thumbnails like the Tags search — tap to enlarge. Box view
// is a grid of larger pictures for browsing; it shows fewer rows at once.

import { useEffect, useMemo, useState } from 'react';

import { CollectionAddDialog } from './CollectionAddDialog';
import { ExportBar } from './ExportBar';
import { loadPrices } from './priceStore';
import { syncStore } from './syncStore';

import { cardImageCandidates } from '@/lib/cardImage';
import { cardKey } from '@/lib/cardName';
import type { Collection } from '@/lib/collection';
import { collectionViewRows, type CollectionViewRow } from '@/lib/collectionView';
import { collectionFile } from '@/lib/export';
import { collectionValue, money, signedMoney, type CollectionValue } from '@/lib/prices';
import type { CardImageOverride } from '@/lib/printing';
import { searchCards } from '@/lib/search';
import { CollectionThumb } from '@/ui/components/CollectionThumb';
import { ViewToggle, type ViewShape } from '@/ui/components/ViewToggle';
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

export const CollectionView = ({
  collection,
  printings = {},
}: {
  collection: Collection | null;
  printings?: Record<string, CardImageOverride>;
}) => {
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [remoteSuggestions, setRemoteSuggestions] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
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

  const all = useMemo(() => (collection ? collectionViewRows(collection) : []), [collection]);
  const rows = useMemo(() => {
    const needle = cardKey(query.trim());
    return needle ? all.filter(row => cardKey(row.name).includes(needle)) : all;
  }, [all, query]);
  const canSuggest = query.trim().length >= 2;
  useEffect(() => {
    if (!canSuggest) {
      setRemoteSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchCards({ text: query.trim() }, 10).then(
        response => {
          if (!cancelled) setRemoteSuggestions(response.cards.map(card => card.name));
        },
        () => {
          if (!cancelled) setRemoteSuggestions([]);
        },
      );
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [canSuggest, query]);
  const suggestions = useMemo(() => {
    if (!canSuggest) return [];
    const seen = new Set<string>();
    const names: string[] = [];
    for (const name of [...rows.map(row => row.name), ...remoteSuggestions]) {
      const key = cardKey(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }
    return names
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .slice(0, 10);
  }, [canSuggest, remoteSuggestions, rows]);
  const addSuggestion =
    suggestions.find(name => cardKey(name) === cardKey(query.trim())) ??
    (suggestions.length === 1 ? suggestions[0] : null);

  const shown = rows.slice(0, view === 'box' ? BOX_LIMIT : VISIBLE_LIMIT);

  const setQuantity = (row: CollectionViewRow, quantity: number) =>
    void syncStore.setCollectionQuantity(row.key, quantity, row.name);

  const setPrintingQty = (identity: string, quantity: number) =>
    void syncStore.setPrintingQuantity(identity, quantity);

  const toggleExpanded = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const empty = !collection || collection.cards.length === 0;
  const imageCandidates = (name: string, candidates: readonly string[]): string[] => {
    const override = cardImageCandidates(printings[cardKey(name)] ?? {});
    return [...new Set([...override, ...candidates])];
  };

  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-line bg-canvas/95 px-4 py-3 backdrop-blur">
        <div className="flex gap-2">
          <input
            aria-label="Search collection or add a card"
            autoCapitalize="none"
            autoCorrect="off"
            className="min-w-0 flex-1 rounded-lg border border-line-strong bg-raised px-3 py-2.5 text-base text-ink placeholder:text-ink-faint"
            onChange={event => setQuery(event.target.value)}
            placeholder="Search your collection"
            type="search"
            value={query}
          />
          <button
            aria-label="Add this card"
            className="h-11 w-11 shrink-0 rounded-lg bg-accent text-xl font-semibold text-accent-ink disabled:opacity-40"
            disabled={!addSuggestion}
            onClick={() => {
              if (addSuggestion) setAdding(addSuggestion);
            }}
            type="button"
          >
            +
          </button>
          {!empty ? <ViewToggle onChange={setView} size="md" value={view} /> : null}
        </div>
        {suggestions.length > 0 ? (
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {suggestions.map(name => {
              const owned = collection?.byKey[cardKey(name)]?.total ?? 0;
              return (
                <button
                  key={name}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${
                    owned > 0
                      ? 'border-accent/50 bg-accent-soft text-accent'
                      : 'border-line bg-raised text-ink-muted'
                  }`}
                  onClick={() => {
                    setQuery(name);
                    setAdding(name);
                  }}
                  type="button"
                >
                  {name}
                  {owned > 0 ? ` · ${owned}` : ''}
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="mt-2 flex items-center gap-3">
          <p className="min-w-0 flex-1 text-[11px] text-ink-faint">
            {empty
              ? 'No cards yet'
              : `${collection.totalCards.toLocaleString()} cards, ${collection.uniqueCards.toLocaleString()} unique`}
            {query ? ` · ${rows.length.toLocaleString()} matching` : ''}
          </p>
          {!empty ? (
            <ExportBar actions={['save', 'share']} file={() => collectionFile(collection)} />
          ) : null}
        </div>
        {!empty ? <Worth stale={stale} value={value} /> : null}
      </div>

      {empty ? (
        <p className="px-6 py-10 text-center text-sm text-ink-muted">
          Search for a card above, then tap + to choose its art, edition, and finish.
        </p>
      ) : null}

      {!empty && view === 'box' ? (
        <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3">
          {shown.map(row => (
            <div key={row.key} className="flex flex-col gap-1">
              <CollectionThumb
                candidates={imageCandidates(row.name, row.candidates)}
                className="card-frame aspect-[488/680] w-full overflow-hidden bg-raised"
                imgStyle={{ objectPosition: '50% 17%' }}
                name={row.name}
                previewKey={`collection|box|${row.key}`}
              />
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
            const canExpand = row.printings.length > 1;
            const open = canExpand && expanded.has(row.key);
            return (
              <li key={row.key}>
                <div className="flex items-center gap-2 px-2 py-1">
                  {canExpand ? (
                    <button
                      aria-expanded={open}
                      aria-label={open ? `Collapse ${row.name}` : `Show printings of ${row.name}`}
                      className="flex h-9 w-7 shrink-0 items-center justify-center text-ink-faint"
                      onClick={() => toggleExpanded(row.key)}
                      type="button"
                    >
                      <span
                        aria-hidden
                        className={`inline-block text-xs transition-transform ${open ? 'rotate-90' : ''}`}
                      >
                        ›
                      </span>
                    </button>
                  ) : (
                    <span className="w-7 shrink-0" />
                  )}
                  <CollectionThumb
                    candidates={imageCandidates(row.name, row.candidates)}
                    name={row.name}
                    previewKey={`collection|list|${row.key}`}
                  />
                  <button
                    className="min-w-0 flex-1 truncate text-left text-sm text-ink"
                    onClick={() => {
                      if (canExpand) toggleExpanded(row.key);
                    }}
                    type="button"
                  >
                    <span className="block truncate">{row.name}</span>
                    {canExpand ? (
                      <span className="block text-[10px] text-ink-faint">
                        {row.printings.length} editions
                      </span>
                    ) : row.printings[0] && row.printings[0].edition !== 'Unknown edition' ? (
                      <span className="block truncate text-[10px] text-ink-faint">
                        {row.printings[0].edition}
                        {row.printings[0].foil ? ' · foil' : ''}
                      </span>
                    ) : null}
                  </button>
                  {row.foil > 0 ? (
                    <span className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
                      {row.foil} foil
                    </span>
                  ) : null}
                  {!open ? (
                    <Stepper
                      onChange={quantity => setQuantity(row, quantity)}
                      quantity={row.total}
                    />
                  ) : (
                    <span className="w-[5.5rem] shrink-0 text-right text-xs tabular-nums text-ink-faint">
                      {row.total}
                    </span>
                  )}
                </div>
                {open ? (
                  <ul className="border-l border-line ml-4 divide-y divide-line/50 bg-raised/40">
                    {row.printings.map(printing => (
                      <li key={printing.identity} className="flex items-center gap-2 px-2 py-1.5">
                        <CollectionThumb
                          candidates={imageCandidates(row.name, printing.candidates)}
                          name={row.name}
                          previewKey={`collection|printing|${printing.identity}`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs text-ink">
                            {printing.edition}
                          </span>
                          {printing.foil ? (
                            <span className="text-[10px] text-accent">foil</span>
                          ) : null}
                        </span>
                        <Stepper
                          onChange={quantity => setPrintingQty(printing.identity, quantity)}
                          quantity={printing.quantity}
                        />
                      </li>
                    ))}
                  </ul>
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
      {adding ? (
        <CollectionAddDialog
          cards={collection?.cards ?? []}
          name={adding}
          onClose={added => {
            setAdding(null);
            if (added) setQuery('');
          }}
        />
      ) : null}
    </div>
  );
};
