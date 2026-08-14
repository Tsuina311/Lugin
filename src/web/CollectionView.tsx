// The collection, as a searchable list of what you own.
//
// Rows are capped rather than virtualised. A real collection is tens of thousands
// of rows and a phone will not enjoy them all in the DOM, but the way anyone
// actually uses this screen is "do I own X" — so search narrows it, and the cap
// keeps scrolling smooth without a windowing dependency.

import { useMemo, useState } from 'react';

import { ExportBar } from './ExportBar';
import { loadPrices } from './priceStore';

import { cardKey } from '@/lib/cardName';
import type { Collection } from '@/lib/collection';
import { collectionFile } from '@/lib/export';
import { collectionValue, money, signedMoney, type CollectionValue } from '@/lib/prices';
import { usePrices } from '@/ui/usePrices';

const VISIBLE_LIMIT = 150;

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

  const rows = useMemo(() => {
    if (!collection) return [];
    const all = Object.values(collection.byKey).sort((a, b) => a.name.localeCompare(b.name));
    const needle = cardKey(query.trim());
    return needle ? all.filter(row => cardKey(row.name).includes(needle)) : all;
  }, [collection, query]);

  if (!collection || collection.cards.length === 0) {
    return (
      <p className="px-6 py-10 text-center text-sm text-ink-muted">
        No collection has been synced yet.
      </p>
    );
  }

  const shown = rows.slice(0, VISIBLE_LIMIT);

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

      <ul className="divide-y divide-line">
        {shown.map(row => (
          <li key={row.name} className="flex items-baseline gap-3 px-4 py-3">
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{row.name}</span>
            {row.foil > 0 ? (
              <span className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
                {row.foil} foil
              </span>
            ) : null}
            <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-muted">
              ×{row.total}
            </span>
          </li>
        ))}
      </ul>

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
