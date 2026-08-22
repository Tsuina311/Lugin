// Find cards by deck-building tags (mechanics / themes) via Scryfall.

import { useEffect, useMemo, useState } from 'react';

import { Button } from './Button';
import { CardResultThumb } from './CardResultThumb';
import { SelectionBar } from './Selection';

import { cardKey } from '@/lib/cardName';
import { buildTagsQuery, deckTagById, deckTagsByCategory, filterDeckTags } from '@/lib/deckTags';
import type { DeckFormat } from '@/lib/deck';
import { sortWubrg } from '@/lib/mtg';
import { searchScryfallQuery, type CardSearchResult } from '@/lib/search';
import { useRowSelection, type RowSelection } from '@/ui/useRowSelection';
import { COLOR_PIPS } from '@/ui/components/colorPips';

const PAGE_SIZE = 40;
const RESULT_LIMIT = 80;

const IDENTITY_PIPS = COLOR_PIPS.filter(p => p.code !== 'C');

const toggleIn = (set: Set<string>, value: string, apply: (s: Set<string>) => void): void => {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  apply(next);
};

export const TagsPanel = ({
  collectionByKey,
  commanderIdentity,
  deckFormat,
  inDeck,
  onAdd,
}: {
  /** cardKey -> owned copies. */
  collectionByKey: Record<string, { total: number }>;
  /** Commander color identity — restricts results when set. */
  commanderIdentity?: string[];
  /** Deck format — restricts results to format-legal cards. */
  deckFormat?: DeckFormat;
  /** cardKey -> copies already in this deck. */
  inDeck: Record<string, number>;
  onAdd: (names: string[]) => void;
}) => {
  const [tagSearch, setTagSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [useIdentity, setUseIdentity] = useState(false);
  const [identity, setIdentity] = useState<Set<string>>(() => new Set());
  const [hideInDeck, setHideInDeck] = useState(true);
  const [ownedOnly, setOwnedOnly] = useState(false);

  const [results, setResults] = useState<CardSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [queryText, setQueryText] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const identityKey =
    commanderIdentity === undefined
      ? 'pending'
      : commanderIdentity.length === 0
        ? 'colorless'
        : sortWubrg([...commanderIdentity]).join('');
  useEffect(() => {
    if (commanderIdentity === undefined) return;
    setIdentity(new Set(commanderIdentity));
    setUseIdentity(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey]);

  const identityFilter = useMemo(
    () => (useIdentity ? sortWubrg([...identity]) : undefined),
    [identity, useIdentity],
  );

  const filteredTags = useMemo(() => filterDeckTags(tagSearch), [tagSearch]);
  const grouped = useMemo(() => deckTagsByCategory(filteredTags), [filteredTags]);

  const toggleTag = (id: string): void =>
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectedIds = useMemo(() => [...selected], [selected]);
  // Stable key so identity array identity changes don't retrigger the effect.
  const selectedKey = selectedIds.slice().sort().join('|');
  const identityFilterKey =
    identityFilter === undefined ? 'off' : identityFilter.length === 0 ? 'c' : identityFilter.join('');

  useEffect(() => {
    if (selectedIds.length === 0) {
      setResults([]);
      setTotal(0);
      setQueryText('');
      setStatus('idle');
      setError(null);
      return;
    }
    let cancelled = false;
    setStatus('loading');
    setError(null);
    const query = buildTagsQuery(selectedIds, identityFilter);
    setQueryText(query);
    // Short debounce: picking a tag and the commander-identity effect settling
    // often land in the same tick burst; one search is enough.
    const timer = window.setTimeout(() => {
      void searchScryfallQuery(query, RESULT_LIMIT, deckFormat)
        .then(resp => {
          if (cancelled) return;
          setResults(resp.cards);
          setTotal(resp.total);
          setQueryText(resp.query);
          setStatus('idle');
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setResults([]);
          setTotal(0);
          setStatus('error');
          setError(e instanceof Error ? e.message : 'Search failed');
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // selectedKey / identityFilterKey stand in for the arrays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckFormat, identityFilterKey, selectedKey]);

  const ownedOf = (name: string): number => collectionByKey[cardKey(name)]?.total ?? 0;
  const deckQtyOf = (name: string): number => inDeck[cardKey(name)] ?? 0;

  const visible = useMemo(() => {
    return results.filter(card => {
      if (ownedOnly && ownedOf(card.name) === 0) return false;
      if (hideInDeck && deckQtyOf(card.name) > 0) return false;
      return true;
    });
  }, [hideInDeck, inDeck, ownedOnly, results, collectionByKey]);

  const shown = showAll ? visible : visible.slice(0, PAGE_SIZE);
  const selection = useRowSelection(shown.map(c => c.id));

  const addSelected = (): void => {
    const byId = new Map(shown.map(c => [c.id, c.name] as const));
    onAdd(selection.ids.map(id => byId.get(id) ?? '').filter(Boolean));
    selection.clear();
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex-none space-y-2 border-b border-line px-2 py-2 text-2xs">
        <input
          aria-label="Search tags"
          className="w-full rounded border border-line-strong bg-raised px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint"
          onChange={e => setTagSearch(e.target.value)}
          placeholder="Search tags — draw, tokens, elf…"
          type="search"
          value={tagSearch}
        />
        {selectedIds.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {selectedIds.map(id => {
              const tag = deckTagById(id);
              return (
                <button
                  key={id}
                  className="rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-2xs font-medium text-accent"
                  onClick={() => toggleTag(id)}
                  type="button"
                >
                  {tag?.label ?? id} ×
                </button>
              );
            })}
            <button
              className="rounded px-1.5 py-0.5 text-ink-faint hover:text-ink"
              onClick={() => setSelected(new Set())}
              type="button"
            >
              clear
            </button>
          </div>
        ) : (
          <p className="text-ink-faint">Pick one or more tags, then add matching cards below.</p>
        )}
        <div className="flex flex-wrap items-center gap-2 text-ink-muted">
          <label className="flex items-center gap-1">
            <input
              checked={hideInDeck}
              className="h-3 w-3 accent-[color:var(--lugin-accent)]"
              onChange={e => setHideInDeck(e.target.checked)}
              type="checkbox"
            />
            hide in deck
          </label>
          <label className="flex items-center gap-1">
            <input
              checked={ownedOnly}
              className="h-3 w-3 accent-[color:var(--lugin-accent)]"
              onChange={e => setOwnedOnly(e.target.checked)}
              type="checkbox"
            />
            owned only
          </label>
        </div>
        {queryText ? (
          <div className="truncate font-mono text-2xs text-ink-faint" title={queryText}>
            {queryText}
          </div>
        ) : null}
      </div>

      <div className="flex-none max-h-40 overflow-auto border-b border-line px-2 py-1">
        {grouped.map(group => (
          <div key={group.category} className="mb-1.5">
            <div className="text-[9px] font-semibold uppercase tracking-wide text-ink-faint">
              {group.category}
            </div>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {group.tags.map(tag => (
                <button
                  key={tag.id}
                  aria-pressed={selected.has(tag.id)}
                  className={`rounded-full border px-2 py-0.5 text-2xs ${
                    selected.has(tag.id)
                      ? 'border-accent/50 bg-accent-soft text-accent'
                      : 'border-line-strong text-ink-muted hover:bg-raised'
                  }`}
                  onClick={() => toggleTag(tag.id)}
                  type="button"
                >
                  {tag.label}
                </button>
              ))}
            </div>
          </div>
        ))}
        {filteredTags.length === 0 ? (
          <p className="py-2 text-center text-2xs text-ink-faint">No tags match that search.</p>
        ) : null}
      </div>

      <div className="flex-none border-b border-line px-2 py-1.5 text-2xs">
        <div className="flex flex-wrap items-center gap-1">
          <label
            className="flex items-center gap-1 text-ink-muted"
            title="Only cards legal in these colors (Commander colour-identity rule)"
          >
            <input
              checked={useIdentity}
              className="h-3 w-3 accent-[color:var(--lugin-accent)]"
              onChange={e => setUseIdentity(e.target.checked)}
              type="checkbox"
            />
            colors
          </label>
          {IDENTITY_PIPS.map(p => (
            <button
              key={p.code}
              aria-pressed={useIdentity && identity.has(p.code)}
              className={`h-5 w-5 rounded-full text-[10px] font-bold ${p.cls} ${
                useIdentity && identity.has(p.code) ? 'ring-2 ring-accent' : 'opacity-50'
              }`}
              onClick={() => {
                setUseIdentity(true);
                toggleIn(identity, p.code, setIdentity);
              }}
              title={`Include ${p.code} in the identity filter`}
              type="button"
            >
              {p.label}
            </button>
          ))}
          {useIdentity && identity.size === 0 ? (
            <span className="text-ink-faint">colorless only</span>
          ) : null}
          {commanderIdentity?.length ? (
            <span className="text-ink-faint" title="Preselected from your commander">
              from commander
            </span>
          ) : null}
        </div>
      </div>

      {selectedIds.length > 0 && visible.length > 0 ? (
        <SelectionBar selection={selection}>
          <Button onClick={addSelected} size="xs" title="Add selected cards to the deck" variant="primary">
            Add {selection.count}
          </Button>
        </SelectionBar>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto outline-none" {...selection.listProps}>
        {selectedIds.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-ink-faint">
            Select tags above to search Scryfall for matching cards.
          </p>
        ) : status === 'loading' ? (
          <p className="px-4 py-6 text-center text-xs text-ink-faint">Searching Scryfall…</p>
        ) : status === 'error' ? (
          <p className="px-4 py-6 text-center text-xs text-neg">{error}</p>
        ) : visible.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-ink-faint">
            No cards match with the current filters.
          </p>
        ) : (
          <>
            <p className="border-b border-line px-2 py-1 text-2xs text-ink-faint">
              {total.toLocaleString()} matches
              {total > results.length ? ` · showing first ${results.length}` : ''}
              {visible.length !== results.length ? ` · ${visible.length} after filters` : ''}
            </p>
            <ul className="list-none divide-y divide-line">
              {shown.map(card => (
                <TagRow
                  key={card.id}
                  card={card}
                  deckQty={deckQtyOf(card.name)}
                  onAdd={() => onAdd([card.name])}
                  owned={ownedOf(card.name)}
                  rowId={card.id}
                  selection={selection}
                />
              ))}
            </ul>
            {!showAll && visible.length > PAGE_SIZE ? (
              <div className="px-2 py-2">
                <Button onClick={() => setShowAll(true)} size="xs" variant="subtle">
                  Show all {visible.length}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
};

const TagRow = ({
  card,
  deckQty,
  onAdd,
  owned,
  rowId,
  selection,
}: {
  card: CardSearchResult;
  deckQty: number;
  onAdd: () => void;
  owned: number;
  rowId: string;
  selection: RowSelection;
}) => {
  const urls = card.faceImages ?? (card.imageUrl ? [card.imageUrl] : []);
  return (
    <li
      {...selection.rowProps(
        rowId,
        `flex items-center gap-2 py-1.5 pr-2 text-[11px] ${
          owned > 0 ? 'border-l-2 border-emerald-500/70 pl-1.5' : 'pl-2'
        }`,
      )}
    >
      <CardResultThumb candidates={urls} name={card.name} previewKey={`tags|${card.id}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-ink" title={card.name}>
          {card.name}
        </div>
        <div className="flex gap-1.5 text-[9px] text-ink-faint">
          {card.typeLine ? <span className="truncate">{card.typeLine}</span> : null}
          {deckQty > 0 ? <span className="shrink-0 text-accent">×{deckQty} in deck</span> : null}
        </div>
      </div>
      {owned > 0 ? (
        <span className="shrink-0 text-[9px] text-emerald-500/90" title={`You own ${owned}`}>
          owned{owned > 1 ? ` ×${owned}` : ''}
        </span>
      ) : null}
      <Button onClick={onAdd} size="xs" title={`Add ${card.name}`}>
        add
      </Button>
    </li>
  );
};
