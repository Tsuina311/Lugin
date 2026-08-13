import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from './Button';
import { SelectionBar } from './Selection';
import { useCardPreview } from './cardPreview';

import { cardKey } from '@/lib/cardName';
import {
  GoldfishNotFound,
  fetchGoldfishArchetype,
  fetchGoldfishDecks,
  type GoldfishArchetype,
  type GoldfishCard,
  type GoldfishDecks,
} from '@/lib/mtggoldfish';
import { useRowSelection, type RowSelection } from '@/ui/useRowSelection';

// Rows shown per category before "show all".
const PAGE_SIZE = 15;
// Categories open on first load — the rest collapse to keep the panel scannable.
const DEFAULT_OPEN = new Set(['Creatures']);

const pct = (n?: number): string => (n == null ? '—' : `${Math.round(n * 100)}%`);

const errText = (e: unknown): string =>
  e instanceof GoldfishNotFound || e instanceof Error ? e.message : 'Failed to load MTGGoldfish';

export const GoldfishPanel = ({
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
  const [mode, setMode] = useState<'cards' | 'decks'>('cards');
  const [arch, setArch] = useState<GoldfishArchetype | null>(null);
  const [decks, setDecks] = useState<GoldfishDecks | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [hideInDeck, setHideInDeck] = useState(true);
  const [open, setOpen] = useState<Set<string>>(() => new Set(DEFAULT_OPEN));
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const namesKey = commanderNames.map(n => cardKey(n)).join('|');
  // Which commander each sub-view currently holds data for, so switching tabs
  // back and forth doesn't re-fetch.
  const loaded = useRef({ cards: '', decks: '' });
  // Guards against a slow response landing after the commander changed.
  const reqId = useRef(0);

  // Each sub-view fetches its own Goldfish page, and only when first opened.
  const load = (force = false): void => {
    if (commanderNames.length === 0) return;
    const id = ++reqId.current;
    const current = (): boolean => reqId.current === id;
    const view = mode;
    setLoading(true);
    setError(null);

    const settle = (): void => {
      if (!current()) return;
      loaded.current[view] = namesKey;
      setLoading(false);
    };
    const fail = (e: unknown): void => {
      if (!current()) return;
      setError(errText(e));
      setLoading(false);
    };

    if (view === 'cards') {
      void fetchGoldfishArchetype(commanderNames, force).then(d => {
        if (current()) setArch(d);
        settle();
      }, fail);
    } else {
      void fetchGoldfishDecks(commanderNames, force).then(d => {
        if (current()) setDecks(d);
        settle();
      }, fail);
    }
  };

  // Declared before the loader so a commander change clears stale data first.
  useEffect(() => {
    setArch(null);
    setDecks(null);
    setError(null);
    loaded.current = { cards: '', decks: '' };
  }, [namesKey]);

  useEffect(() => {
    if (loaded.current[mode] !== namesKey) load();
    // `load` closes over these; re-run when the commander or sub-view changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey, mode]);

  const ownedOf = (name: string): number => collectionByKey[cardKey(name)]?.total ?? 0;
  const deckQtyOf = (name: string): number => inDeck[cardKey(name)] ?? 0;

  const visibleCategories = useMemo(() => {
    if (!arch) return [];
    return arch.categories
      .map(c => ({
        ...c,
        cards: c.cards.filter(card => {
          if (ownedOnly && ownedOf(card.name) === 0) return false;
          if (hideInDeck && deckQtyOf(card.name) > 0) return false;
          return true;
        }),
      }))
      .filter(c => c.cards.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arch, ownedOnly, hideInDeck, collectionByKey, inDeck]);

  const ownedStats = useMemo(() => {
    if (!arch) return { owned: 0, total: 0 };
    const seen = new Set<string>();
    let owned = 0;
    for (const c of arch.categories) {
      for (const card of c.cards) {
        const k = cardKey(card.name);
        if (seen.has(k)) continue;
        seen.add(k);
        if (ownedOf(card.name) > 0) owned++;
      }
    }
    return { owned, total: seen.size };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arch, collectionByKey]);

  const toggle = (set: Set<string>, key: string): Set<string> => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  };

  // The card rows on screen, in order: open categories, cut off at the page size
  // until "show all".
  const rows = useMemo(() => {
    const ids: string[] = [];
    const names = new Map<string, string>();
    for (const cat of visibleCategories) {
      if (!open.has(cat.header)) continue;
      const shown = expanded.has(cat.header) ? cat.cards : cat.cards.slice(0, PAGE_SIZE);
      for (const c of shown) {
        const id = `${cat.header}|${cardKey(c.name)}`;
        ids.push(id);
        names.set(id, c.name);
      }
    }
    return { ids, names };
  }, [expanded, open, visibleCategories]);

  const selection = useRowSelection(rows.ids);

  if (commanderNames.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-xs text-slate-500">
        Pick a commander to see MTGGoldfish data.
      </div>
    );
  }

  const pageUrl = mode === 'cards' ? arch?.pageUrl : decks?.pageUrl;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none flex-wrap items-center gap-1.5 border-b border-slate-800 px-2 py-1.5 text-[10px]">
        <span className="font-semibold uppercase tracking-wide text-slate-400">Goldfish</span>
        <div className="flex overflow-hidden rounded border border-slate-700" role="group">
          {(['cards', 'decks'] as const).map(m => (
            <button
              key={m}
              aria-pressed={mode === m}
              className={`px-1.5 py-0.5 capitalize ${
                mode === m
                  ? 'bg-slate-700 text-slate-100'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
              onClick={() => setMode(m)}
              type="button"
            >
              {m}
            </button>
          ))}
        </div>
        {mode === 'cards' && arch && ownedStats.total > 0 && (
          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-semibold text-emerald-300">
            you own {ownedStats.owned}/{ownedStats.total}
          </span>
        )}
        {mode === 'decks' && decks && (
          <span className="text-slate-500">{decks.decks.length} decks</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {pageUrl && (
            <a
              className="text-sky-400 hover:text-sky-300"
              href={pageUrl}
              rel="noreferrer"
              target="_blank"
              title="Open on MTGGoldfish"
            >
              open ↗
            </a>
          )}
          <Button
            onClick={() => load(true)}
            size="xs"
            title="Re-fetch (bypasses the one-day cache)"
            variant="subtle"
          >
            Refresh
          </Button>
        </div>
      </div>

      {mode === 'cards' && (
        <div className="flex flex-none flex-wrap items-center gap-2 border-b border-slate-800 px-2 py-1.5 text-[10px]">
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
      )}

      {mode === 'cards' && rows.ids.length > 0 && (
        <SelectionBar selection={selection}>
          <Button
            onClick={() => {
              onAdd(selection.ids.map(id => rows.names.get(id) ?? '').filter(Boolean));
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

      <div className="min-h-0 flex-1 overflow-auto outline-none" {...selection.listProps}>
        {loading && <div className="px-4 py-6 text-center text-xs text-slate-500">Loading…</div>}
        {error && !loading && (
          <div className="px-4 py-6 text-center text-xs text-red-400">{error}</div>
        )}

        {mode === 'cards' &&
          !loading &&
          visibleCategories.map(cat => {
            const isOpen = open.has(cat.header);
            const showAll = expanded.has(cat.header);
            const cards = showAll ? cat.cards : cat.cards.slice(0, PAGE_SIZE);
            return (
              <div key={cat.header}>
                <button
                  className="sticky top-0 z-10 flex w-full items-center gap-2 bg-slate-900 px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-200"
                  onClick={() => setOpen(s => toggle(s, cat.header))}
                  type="button"
                >
                  <span className="inline-block w-2 text-slate-500">{isOpen ? '▾' : '▸'}</span>
                  {cat.header}
                  <span className="text-slate-600">{cat.cards.length}</span>
                </button>
                {isOpen && (
                  <ul className="list-none divide-y divide-slate-800/60">
                    {cards.map(c => (
                      <GoldfishRow
                        key={cardKey(c.name)}
                        card={c}
                        deckQty={deckQtyOf(c.name)}
                        onAdd={() => onAdd([c.name])}
                        owned={ownedOf(c.name)}
                        rowId={`${cat.header}|${cardKey(c.name)}`}
                        selection={selection}
                      />
                    ))}
                    {!showAll && cat.cards.length > PAGE_SIZE && (
                      <li className="px-2 py-1">
                        <Button
                          onClick={() => setExpanded(s => toggle(s, cat.header))}
                          size="xs"
                          variant="subtle"
                        >
                          show all {cat.cards.length}
                        </Button>
                      </li>
                    )}
                  </ul>
                )}
              </div>
            );
          })}
        {mode === 'cards' && arch && !loading && visibleCategories.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-slate-500">
            Nothing left to show with these filters.
          </div>
        )}

        {mode === 'decks' && decks && !loading && (
          <>
            <ul className="list-none divide-y divide-slate-800/60">
              {decks.decks.map(d => (
                <li key={d.id} className="flex items-center gap-2 px-2 py-1.5 text-[11px]">
                  <div className="min-w-0 flex-1">
                    <a
                      className="block truncate font-medium text-slate-100 hover:text-sky-300"
                      href={d.url}
                      rel="noreferrer"
                      target="_blank"
                      title={`Open "${d.name}" on MTGGoldfish`}
                    >
                      {d.name}
                    </a>
                    <div className="truncate text-[9px] text-slate-500">
                      {[d.author, d.date].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  {d.price && (
                    <span className="flex-none tabular-nums text-[10px] text-slate-400">
                      {d.price}
                    </span>
                  )}
                  <a
                    className="flex-none text-[10px] text-sky-400 hover:text-sky-300"
                    href={d.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    open ↗
                  </a>
                </li>
              ))}
            </ul>
            <p className="px-2 py-2 text-[9px] leading-relaxed text-slate-600">
              Goldfish protects individual deck pages with a bot check, so decklists can’t be
              imported directly. Open one and paste its list into the deck’s Import.
            </p>
          </>
        )}
      </div>
    </div>
  );
};

const GoldfishRow = ({
  card,
  deckQty,
  onAdd,
  owned,
  rowId,
  selection,
}: {
  card: GoldfishCard;
  deckQty: number;
  onAdd: () => void;
  owned: number;
  rowId: string;
  selection: RowSelection;
}) => {
  const preview = useCardPreview();
  const { flippable, handlers } = preview(
    `goldfish|${cardKey(card.name)}`,
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
            className={`h-full w-full object-cover ${flippable ? 'cursor-pointer' : 'cursor-zoom-in'}`}
            decoding="async"
            loading="lazy"
            src={card.imageUrl}
            style={{ objectPosition: '50% 18%' }}
            title={flippable ? 'Click to flip to the other side' : undefined}
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-slate-100" title={card.name}>
          {card.name}
        </div>
        <div className="flex items-center gap-1.5 text-[9px] text-slate-500">
          <span title="Share of this archetype's decks that play it">
            {pct(card.inclusion)} of decks
          </span>
          {card.avgCopies != null && card.avgCopies !== 1 && (
            <span className="text-sky-400/80" title="Average copies played">
              ×{card.avgCopies} avg
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
