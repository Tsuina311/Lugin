import { useEffect, useMemo, useState } from 'react';

import { Button } from './Button';
import { SelectionBar } from './Selection';
import { useCardPreview } from './cardPreview';

import { cardKey } from '@/lib/cardName';
import { EdhrecNotFound, fetchEdhrec, type EdhrecCard, type EdhrecData } from '@/lib/edhrec';
import { useRowSelection, type RowSelection } from '@/ui/useRowSelection';

// Rows shown per category before the "show all" button.
const PAGE_SIZE = 15;
// Categories expanded on first load — the ones people actually build from.
const DEFAULT_OPEN = new Set(['highsynergycards', 'topcards', 'newcards']);

const pct = (n?: number): string => (n == null ? '—' : `${Math.round(n * 100)}%`);

const signedPct = (n?: number): string => {
  if (n == null) return '';
  const v = Math.round(n * 100);
  return `${v > 0 ? '+' : ''}${v}%`;
};

export const EdhrecPanel = ({
  commanderNames,
  collectionByKey,
  inDeck,
  onAdd,
}: {
  /** cardKey -> owned copies. */
  collectionByKey: Record<string, { total: number }>;
  commanderNames: string[];
  /** cardKey -> copies already in this deck. */
  inDeck: Record<string, number>;
  /** Add one card, or every card the user selected. */
  onAdd: (names: string[]) => void;
}) => {
  const [data, setData] = useState<EdhrecData | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState('');
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [hideInDeck, setHideInDeck] = useState(true);
  const [open, setOpen] = useState<Set<string>>(() => new Set(DEFAULT_OPEN));
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const namesKey = commanderNames.map(n => cardKey(n)).join('|');

  // (Re)load whenever the commander(s) or the selected theme change.
  const load = (force = false): void => {
    if (commanderNames.length === 0) return;
    setStatus('loading');
    setError(null);
    void fetchEdhrec(commanderNames, theme || undefined, force)
      .then(d => {
        setData(d);
        setStatus('idle');
      })
      .catch((e: unknown) => {
        setData(null);
        setStatus('error');
        setError(
          e instanceof EdhrecNotFound
            ? e.message
            : e instanceof Error
              ? e.message
              : 'Failed to load EDHREC data',
        );
      });
  };

  useEffect(() => {
    load();
    // `load` closes over the values in this dep list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey, theme]);

  // Reset the theme when switching commanders — themes are commander-specific.
  useEffect(() => setTheme(''), [namesKey]);

  const ownedOf = (name: string): number => collectionByKey[cardKey(name)]?.total ?? 0;
  const deckQtyOf = (name: string): number => inDeck[cardKey(name)] ?? 0;

  const visibleLists = useMemo(() => {
    if (!data) return [];
    return data.lists
      .map(l => ({
        ...l,
        cards: l.cards.filter(c => {
          if (ownedOnly && ownedOf(c.name) === 0) return false;
          if (hideInDeck && deckQtyOf(c.name) > 0) return false;
          return true;
        }),
      }))
      .filter(l => l.cards.length > 0);
    // ownedOf/deckQtyOf read the two index props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, ownedOnly, hideInDeck, collectionByKey, inDeck]);

  // How many of the recommendations you already own (across everything shown).
  const ownedStats = useMemo(() => {
    if (!data) return { owned: 0, total: 0 };
    const seen = new Set<string>();
    let owned = 0;
    for (const l of data.lists) {
      for (const c of l.cards) {
        const k = cardKey(c.name);
        if (seen.has(k)) continue;
        seen.add(k);
        if (ownedOf(c.name) > 0) owned++;
      }
    }
    return { owned, total: seen.size };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, collectionByKey]);

  const toggle = (set: Set<string>, key: string): Set<string> => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  // The rows on screen, in order: open categories only, cut off at the page size
  // until "show all". Selection follows that same order.
  const rows = useMemo(() => {
    const ids: string[] = [];
    const names = new Map<string, string>();
    for (const list of visibleLists) {
      if (!open.has(list.tag)) continue;
      const shown = expanded.has(list.tag) ? list.cards : list.cards.slice(0, PAGE_SIZE);
      for (const c of shown) {
        const id = `${list.tag}|${cardKey(c.name)}`;
        ids.push(id);
        names.set(id, c.name);
      }
    }
    return { ids, names };
  }, [expanded, open, visibleLists]);

  const selection = useRowSelection(rows.ids);

  // A card can be recommended in several categories, so add it only once.
  const selectedNames = (): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of selection.ids) {
      const name = rows.names.get(id);
      if (!name || seen.has(cardKey(name))) continue;
      seen.add(cardKey(name));
      out.push(name);
    }
    return out;
  };

  if (commanderNames.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-xs text-slate-500">
        Pick a commander to see EDHREC recommendations.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Controls */}
      <div className="flex flex-none flex-wrap items-center gap-1.5 border-b border-slate-800 px-2 py-1.5 text-[10px]">
        <span className="font-semibold uppercase tracking-wide text-slate-400">EDHREC</span>
        {data?.deckCount != null && <span className="text-slate-500">{data.deckCount} decks</span>}
        {data && ownedStats.total > 0 && (
          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-semibold text-emerald-300">
            you own {ownedStats.owned}/{ownedStats.total}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {data && (
            <a
              className="text-sky-400 hover:text-sky-300"
              href={data.pageUrl}
              rel="noreferrer"
              target="_blank"
              title="Open this page on EDHREC"
            >
              open ↗
            </a>
          )}
          <Button
            onClick={() => load(true)}
            size="xs"
            title="Re-fetch (bypasses the one-week cache)"
            variant="subtle"
          >
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex flex-none flex-wrap items-center gap-2 border-b border-slate-800 px-2 py-1.5 text-[10px]">
        <select
          className="min-w-0 max-w-[160px] rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[10px] text-slate-200 outline-none focus:border-sky-500"
          onChange={e => setTheme(e.target.value)}
          title="Narrow the recommendations to a deck theme"
          value={theme}
        >
          <option value="">All decks</option>
          {(data?.themes ?? []).map(t => (
            <option key={t.slug} value={t.slug}>
              {t.value} ({t.count})
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-slate-400" title="Only cards you own">
          <input
            checked={ownedOnly}
            className="accent-sky-500"
            onChange={e => setOwnedOnly(e.target.checked)}
            type="checkbox"
          />
          owned only
        </label>
        <label
          className="flex items-center gap-1 text-slate-400"
          title="Hide cards already in this deck"
        >
          <input
            checked={hideInDeck}
            className="accent-sky-500"
            onChange={e => setHideInDeck(e.target.checked)}
            type="checkbox"
          />
          hide in-deck
        </label>
      </div>

      {rows.ids.length > 0 && (
        <SelectionBar selection={selection}>
          <Button
            onClick={() => {
              onAdd(selectedNames());
              selection.clear();
            }}
            size="xs"
            title="Add the selected cards to the deck"
            variant="primary"
          >
            + Add {selection.count}
          </Button>
        </SelectionBar>
      )}

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-auto outline-none" {...selection.listProps}>
        {status === 'loading' && !data && (
          <div className="px-4 py-6 text-center text-xs text-slate-500">
            Loading EDHREC recommendations…
          </div>
        )}
        {status === 'error' && (
          <div className="px-4 py-6 text-center text-xs text-red-400">{error}</div>
        )}
        {data &&
          visibleLists.map(list => {
            const isOpen = open.has(list.tag);
            const showAll = expanded.has(list.tag);
            const cards = showAll ? list.cards : list.cards.slice(0, PAGE_SIZE);
            return (
              <div key={list.tag}>
                <button
                  className="sticky top-0 z-10 flex w-full items-center gap-2 bg-slate-900 px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-200"
                  onClick={() => setOpen(s => toggle(s, list.tag))}
                  type="button"
                >
                  <span className="inline-block w-2 text-slate-500">{isOpen ? '▾' : '▸'}</span>
                  {list.header}
                  <span className="text-slate-600">{list.cards.length}</span>
                </button>
                {isOpen && (
                  <ul className="list-none divide-y divide-slate-800/60">
                    {cards.map(c => (
                      <EdhrecRow
                        key={`${list.tag}|${cardKey(c.name)}`}
                        card={c}
                        deckQty={deckQtyOf(c.name)}
                        onAdd={() => onAdd([c.name])}
                        owned={ownedOf(c.name)}
                        rowId={`${list.tag}|${cardKey(c.name)}`}
                        selection={selection}
                      />
                    ))}
                    {!showAll && list.cards.length > PAGE_SIZE && (
                      <li className="px-2 py-1">
                        <Button
                          onClick={() => setExpanded(s => toggle(s, list.tag))}
                          size="xs"
                          variant="subtle"
                        >
                          show all {list.cards.length}
                        </Button>
                      </li>
                    )}
                  </ul>
                )}
              </div>
            );
          })}
        {data && visibleLists.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-slate-500">
            Nothing left to show with these filters.
          </div>
        )}
      </div>
    </div>
  );
};

const EdhrecRow = ({
  card,
  deckQty,
  onAdd,
  owned,
  rowId,
  selection,
}: {
  card: EdhrecCard;
  deckQty: number;
  onAdd: () => void;
  owned: number;
  rowId: string;
  selection: RowSelection;
}) => {
  const preview = useCardPreview();
  const { flippable, handlers } = preview(
    `edhrec|${cardKey(card.name)}`,
    card.name,
    card.imageUrl ? [card.imageUrl] : [],
  );
  return (
    <li
      {...selection.rowProps(
        rowId,
        `flex items-center gap-2 py-1.5 pr-2 text-[11px] ${
          owned > 0 ? 'border-l-2 border-emerald-500/70 pl-1.5' : 'pl-2'
        }`,
      )}
    >
      <div className="h-8 w-8 flex-none overflow-hidden rounded bg-slate-800" {...handlers}>
        {card.imageUrl && (
          <img
            alt={card.name}
            className="h-full w-full cursor-zoom-in object-cover"
            decoding="async"
            loading="lazy"
            src={card.imageUrl}
            style={{ objectPosition: '50% 18%' }}
            title={flippable ? 'Click to enlarge; click again to flip' : 'Click to enlarge'}
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-slate-100" title={card.name}>
          {card.name}
        </div>
        <div className="flex items-center gap-1.5 text-[9px] text-slate-500">
          <span title={`In ${card.numDecks ?? '?'} of ${card.potentialDecks ?? '?'} decks`}>
            {pct(card.inclusion)}
          </span>
          {card.synergy != null && (
            <span
              className={card.synergy > 0 ? 'text-sky-400/80' : 'text-slate-600'}
              title="EDHREC synergy — how much more this commander plays it than average"
            >
              {signedPct(card.synergy)} syn
            </span>
          )}
        </div>
      </div>

      {owned > 0 ? (
        <span
          className="flex-none rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-300"
          title={`You own ${owned}`}
        >
          owned{owned > 1 ? ` ×${owned}` : ''}
        </span>
      ) : (
        <span
          className="flex-none rounded bg-slate-700/40 px-1.5 py-0.5 text-[9px] font-medium text-slate-400"
          title="Not in your collection"
        >
          not owned
        </span>
      )}

      {deckQty > 0 ? (
        <span
          className="flex-none rounded bg-sky-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-sky-300"
          title={`Already in this deck (×${deckQty})`}
        >
          in deck
        </span>
      ) : (
        <button
          className="flex h-5 w-5 flex-none items-center justify-center rounded bg-slate-800 text-slate-300 hover:bg-sky-600 hover:text-white"
          onClick={onAdd}
          title={`Add ${card.name} to the deck`}
          type="button"
        >
          +
        </button>
      )}
    </li>
  );
};
