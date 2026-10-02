import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { Badge } from './Badge';
import { Button } from './Button';
import { useCardPreview } from './cardPreview';
import { SearchInput, Select } from './Field';
import { ChevronDown, ChevronRight, Loader2, Plus } from './icons';

import { purchaseStore } from '@/content/purchaseStore';
import { askForLogin, cmToken } from '@/content/session';
import { cardKey, frontFaceName, stripVersion } from '@/lib/cardName';
import { searchCatalogue, type ProductSuggestion } from '@/sites/cardmarket/search';
import { MIN_SEARCH_LENGTH } from '@/sites/cardmarket/searchArgs';
import { readWantDefaults } from '@/sites/cardmarket/wantDefaults';
import {
  addWant,
  fetchProductIds,
  pace,
  type PurchaseRecord,
  type WantsIndexList,
} from '@/sites/cardmarket/wants';

const DEBOUNCE_MS = 400;

export interface WantListOption {
  id: string;
  name: string;
}

type AddStatus = { msg?: string; status: 'adding' | 'added' | 'error' };

/**
 * Search Cardmarket for a card and add it to a want list — any edition, or one
 * specific printing. Shared by the Wants tab and the Search tab.
 */
export const AddCardToWant = ({
  defaultListId,
  lists,
  onAdded,
}: {
  /** Pre-select this list (open want list). Still changeable in the picker. */
  defaultListId?: string;
  lists: readonly WantListOption[];
  /** Called after a successful add so the caller can refresh its index. */
  onAdded?: (list: WantListOption, cardName: string) => void;
}) => {
  const preview = useCardPreview();
  const purchases = useSyncExternalStore(purchaseStore.subscribe, purchaseStore.getSnapshot);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ProductSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [listId, setListId] = useState(defaultListId ?? lists[0]?.id ?? '');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, AddStatus>>({});
  const latest = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (defaultListId) setListId(defaultListId);
  }, [defaultListId]);

  useEffect(() => {
    if (!listId && lists[0]) setListId(lists[0].id);
  }, [lists, listId]);

  // Same collapse as Wants/Collection: any printing counts as bought.
  const purchaseLookup = useMemo(() => {
    const map = new Map<string, { count: number; purchases: PurchaseRecord[] }>();
    for (const [key, entry] of Object.entries(purchases.index?.cards ?? {})) {
      const norm = stripVersion(key);
      const cur = map.get(norm);
      if (cur) {
        cur.count += entry.count;
        cur.purchases = [...cur.purchases, ...(entry.purchases ?? [])];
      } else {
        map.set(norm, { count: entry.count, purchases: [...(entry.purchases ?? [])] });
      }
    }
    return map;
  }, [purchases]);

  const fmtEuro = (n?: number): string | undefined =>
    n == null ? undefined : `${n.toFixed(2).replace('.', ',')} €`;

  const purchasedTag = (name: string) => {
    const entry = purchaseLookup.get(stripVersion(cardKey(name)));
    if (!entry) return null;
    const recs = entry.purchases ?? [];
    const latestBuy = recs.reduce<PurchaseRecord | undefined>(
      (best, r) => ((r.ts ?? 0) >= (best?.ts ?? 0) ? r : best),
      undefined,
    );
    const price = fmtEuro(latestBuy?.price);
    const label = latestBuy?.date
      ? `bought ${latestBuy.date}${price ? ` · ${price}` : ''}`
      : 'purchased';
    const tip = recs.length
      ? recs
          .slice()
          .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
          .map(
            r =>
              `${r.date ?? '?'}${r.price != null ? ` — ${fmtEuro(r.price)}` : ''}` +
              `${r.edition ? ` · ${r.edition}` : ''} (#${r.orderId})`,
          )
          .join('\n')
      : 'You bought this card before';
    return (
      <Badge title={tip} tone="neutral">
        {label}
        {entry.count > 1 && <span className="ml-1 opacity-70">×{entry.count}</span>}
      </Badge>
    );
  };

  const groups = useMemo(() => {
    const order: string[] = [];
    const byKey = new Map<string, { key: string; name: string; printings: ProductSuggestion[] }>();
    for (const item of hits) {
      const key = cardKey(item.name);
      let g = byKey.get(key);
      if (!g) {
        g = { key, name: stripVersion(frontFaceName(item.name)) || item.name, printings: [] };
        byKey.set(key, g);
        order.push(key);
      }
      g.printings.push(item);
    }
    return order.map(k => byKey.get(k)!);
  }, [hits]);

  const runSearch = (term: string) => {
    const q = term.trim();
    if (q.length < MIN_SEARCH_LENGTH) {
      setHits([]);
      setSearchError(null);
      setSearching(false);
      return;
    }
    const seq = ++latest.current;
    setSearching(true);
    setSearchError(null);
    void (async () => {
      try {
        const rows = await searchCatalogue(q);
        if (seq !== latest.current) return;
        setHits(rows);
        setExpanded(null);
      } catch (err) {
        if (seq !== latest.current) return;
        setHits([]);
        setSearchError(err instanceof Error ? err.message : String(err));
      } finally {
        if (seq === latest.current) setSearching(false);
      }
    })();
  };

  const onChange = (value: string) => {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    const term = value.trim();
    if (term.length < MIN_SEARCH_LENGTH) {
      latest.current++;
      setHits([]);
      setSearching(false);
      return;
    }
    timer.current = setTimeout(() => runSearch(term), DEBOUNCE_MS);
  };

  const chosen = lists.find(l => l.id === listId) ?? null;

  const add = async (
    statusKey: string,
    cardName: string,
    opts: { href?: string; productId?: string },
  ) => {
    if (!chosen) return;
    setStatus(s => ({ ...s, [statusKey]: { status: 'adding' } }));
    try {
      const token = await cmToken();
      if (!token) {
        askForLogin();
        throw new Error('Sign in to Cardmarket to add wants.');
      }
      let idMetacard: string | undefined;
      let idProduct = opts.productId?.trim();
      if (opts.href) {
        const url = opts.href.startsWith('http')
          ? opts.href
          : `${location.origin}${opts.href.startsWith('/') ? '' : '/'}${opts.href}`;
        const ids = await fetchProductIds(url);
        idMetacard = ids?.idMetacard;
        if (!idProduct) idProduct = ids?.idProduct;
      }
      if (!idMetacard) throw new Error('Couldn’t find this card’s id on Cardmarket.');
      await pace();
      const r = await addWant(
        {
          idMetacard,
          idWantsList: chosen.id,
          ...(idProduct && statusKey.includes('|edition|') ? { idProduct } : {}),
          ...readWantDefaults(),
        },
        token,
      );
      if (!r.ok) throw new Error(r.message);
      setStatus(s => ({ ...s, [statusKey]: { status: 'added' } }));
      onAdded?.(chosen, cardName);
    } catch (err) {
      setStatus(s => ({
        ...s,
        [statusKey]: {
          msg: err instanceof Error ? err.message : String(err),
          status: 'error',
        },
      }));
    }
  };

  const addLabel = (key: string, idle: string) => {
    const st = status[key];
    if (st?.status === 'adding') return 'Adding…';
    if (st?.status === 'added') return 'Added';
    return idle;
  };

  const thumb = (previewKey: string, name: string, src: string | undefined, size: string) => {
    if (!src) return <span className={`${size} flex-none rounded-sm bg-panel`} />;
    const { handlers } = preview(previewKey, name, [src]);
    return (
      <img
        alt=""
        className={`${size} flex-none cursor-zoom-in rounded-sm object-cover`}
        decoding="async"
        src={src}
        title="Hover to preview"
        {...handlers}
      />
    );
  };

  return (
    <div className="flex-none border-b border-line px-2 py-1.5 text-2xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="min-w-[10rem] flex-1">
          <SearchInput
            onChange={e => onChange(e.target.value)}
            onClear={() => {
              setQuery('');
              setHits([]);
              setSearchError(null);
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (timer.current) clearTimeout(timer.current);
                runSearch(query);
              }
            }}
            placeholder="Add a card to a want list…"
            trailing={
              searching ? (
                <Loader2 aria-hidden className="animate-spin text-ink-faint" size={12} />
              ) : undefined
            }
            value={query}
          />
        </div>
        {lists.length > 0 ? (
          <Select
            className="max-w-[12rem]"
            onChange={e => setListId(e.target.value)}
            title="Want list to add to"
            value={listId}
          >
            {lists.map(l => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        ) : (
          <span className="text-warn">Sync want lists first</span>
        )}
      </div>

      {searchError && <p className="mt-1 text-neg">{searchError}</p>}

      {groups.length > 0 && (
        <ul className="mt-1.5 max-h-56 space-y-0.5 overflow-y-auto overscroll-contain">
          {groups.map(g => {
            const open = expanded === g.key;
            const anyKey = `${g.key}|any`;
            const anySt = status[anyKey];
            const lead = g.printings.find(p => p.imageUrl) ?? g.printings[0];
            return (
              <li key={g.key} className="rounded border border-line bg-raised/40">
                <div className="flex flex-wrap items-center gap-1.5 px-1.5 py-1">
                  {thumb(`addWant|${g.key}|lead`, g.name, lead?.imageUrl, 'h-8 w-6')}
                  <button
                    className="flex min-w-0 flex-1 items-center gap-1 text-left"
                    onClick={() => setExpanded(open ? null : g.key)}
                    title={
                      open
                        ? 'Hide printings'
                        : `Show ${g.printings.length} printing${g.printings.length === 1 ? '' : 's'}`
                    }
                    type="button"
                  >
                    {open ? (
                      <ChevronDown aria-hidden className="flex-none text-ink-faint" size={12} />
                    ) : (
                      <ChevronRight aria-hidden className="flex-none text-ink-faint" size={12} />
                    )}
                    <span className="min-w-0 truncate text-xs font-medium text-ink">{g.name}</span>
                    <span className="flex-none text-ink-faint">
                      {g.printings.length} edition{g.printings.length === 1 ? '' : 's'}
                    </span>
                  </button>
                  {purchasedTag(g.name)}
                  <Button
                    disabled={!chosen || anySt?.status === 'adding' || anySt?.status === 'added'}
                    icon={anySt?.status === 'adding' ? Loader2 : Plus}
                    onClick={() =>
                      void add(anyKey, g.name, {
                        // Product page still needed for idMetacard; omit product id
                        // so Cardmarket treats the want as any printing.
                        href: lead?.href,
                      })
                    }
                    size="xs"
                    title={`Add any edition of ${g.name} to ${chosen?.name ?? 'a want list'}`}
                    variant="primary"
                  >
                    {addLabel(anyKey, 'Any edition')}
                  </Button>
                </div>
                {anySt?.status === 'error' && (
                  <p className="px-1.5 pb-1 text-neg">{anySt.msg}</p>
                )}
                {open && (
                  <ul className="border-t border-line/60">
                    {g.printings.map(p => {
                      const edKey = `${g.key}|edition|${p.productId ?? p.href}`;
                      const st = status[edKey];
                      return (
                        <li
                          key={edKey}
                          className="flex flex-wrap items-center gap-1.5 border-b border-line/40 px-1.5 py-1 last:border-b-0"
                        >
                          {thumb(`addWant|${edKey}`, g.name, p.imageUrl, 'h-7 w-5')}
                          <span className="min-w-0 flex-1 truncate text-ink-muted">
                            {p.expansion ?? p.setCode ?? 'Unknown set'}
                            {p.fromPrice ? ` · from ${p.fromPrice}` : ''}
                          </span>
                          <Button
                            disabled={!chosen || st?.status === 'adding' || st?.status === 'added'}
                            icon={st?.status === 'adding' ? Loader2 : Plus}
                            onClick={() =>
                              void add(edKey, g.name, {
                                href: p.href,
                                productId: p.productId,
                              })
                            }
                            size="xs"
                            title={`Add only this ${p.expansion ?? 'printing'} to ${chosen?.name ?? 'a want list'}`}
                            variant="neutral"
                          >
                            {addLabel(edKey, 'This edition')}
                          </Button>
                          {st?.status === 'error' && (
                            <span className="w-full text-neg">{st.msg}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!searching &&
        query.trim().length >= MIN_SEARCH_LENGTH &&
        groups.length === 0 &&
        !searchError && (
          <p className="mt-1 text-ink-faint">No catalogue hits for “{query.trim()}”.</p>
        )}
    </div>
  );
};

/** Narrow index lists down to the picker shape. */
export const wantListOptionsFrom = (
  lists: readonly Pick<WantsIndexList, 'id' | 'name'>[] | null | undefined,
): WantListOption[] => (lists ?? []).map(l => ({ id: l.id, name: l.name }));
