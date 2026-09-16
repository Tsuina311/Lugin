import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { compareFavouriteFirst, useFavouriteSellers } from '../useFavouriteSellers';

import { Button } from './Button';
import { FavouriteSellerBadge, FavouriteSellerControl } from './FavouriteSellerControl';
import { ShoppingCart } from './icons';
import { SellerNameButton } from './SellerNameButton';

import { cartStore } from '@/content/cartStore';
import { askForLogin, clearCachedTokens, cmToken, rememberWriteToken } from '@/content/session';
import { shippingStore } from '@/content/shippingStore';
import { cardKey, stripVersion } from '@/lib/cardName';
import { addArticleToCart } from '@/sites/cardmarket/cart';
import { countryId, estimateShipping } from '@/sites/cardmarket/shipping';
import {
  fetchSellerListOffers,
  fetchSellersWithMostWants,
  type SellerWants,
} from '@/sites/cardmarket/wants';

interface SellerPrice {
  /** Cheapest article id per matched card — for “Add all to cart”. */
  articleIds?: string[];
  cartError?: string;
  cartStatus?: 'idle' | 'adding' | 'done' | 'error';
  error?: string;
  matched?: number;
  missing?: string[];
  status: 'loading' | 'done' | 'error';
  total?: number;
}

const fmtEuro = (n: number): string => `${n.toFixed(2).replace('.', ',')} €`;

/**
 * Rank sellers by coverage of one want list, then optionally price each one.
 * Same Cardmarket Ajax as the site's "sellers with the most wants" control —
 * usable from the Wants tab without being on `/Wants/<id>`.
 */
export const BestSellersForList = ({
  autoLoad = false,
  heading,
  listCards,
  wantListId,
}: {
  /** Kick off the ranking as soon as this list id is shown (e.g. after staging). */
  autoLoad?: boolean;
  /** Optional label when the ranked list isn't the one you're browsing. */
  heading?: string;
  /** Normalized card key → display name (for missing-card diffs after pricing). */
  listCards: Map<string, string>;
  wantListId: string;
}) => {
  const { favourites, isFavourite, toggle: toggleFavourite } = useFavouriteSellers();
  const shipping = useSyncExternalStore(shippingStore.subscribe, shippingStore.getSnapshot);
  const [sellers, setSellers] = useState<{
    error: string | null;
    rows: SellerWants[];
    status: 'idle' | 'loading' | 'done' | 'error';
  }>({ error: null, rows: [], status: 'idle' });
  const [priced, setPriced] = useState<Record<string, SellerPrice>>({});
  const priceAborts = useRef<Map<string, AbortController>>(new Map());

  // Drop results when switching lists so one list's ranking can't stick on another.
  useEffect(() => {
    for (const c of priceAborts.current.values()) c.abort();
    priceAborts.current.clear();
    setSellers({ error: null, rows: [], status: 'idle' });
    setPriced({});
  }, [wantListId]);

  useEffect(() => {
    if (shipping.toCountry == null) return;
    for (const row of sellers.rows) {
      const id = countryId(row.location);
      if (id != null) void shippingStore.ensureMatrix(id);
    }
  }, [sellers.rows, shipping.toCountry]);

  const loadSellers = async () => {
    const token = await cmToken();
    if (!token) {
      askForLogin();
      setSellers({
        error: 'Sign in to Cardmarket to rank sellers for this list.',
        rows: [],
        status: 'error',
      });
      return;
    }
    setSellers({ error: null, rows: [], status: 'loading' });
    setPriced({});
    try {
      const rows = await fetchSellersWithMostWants(wantListId, token);
      setSellers({ error: null, rows, status: 'done' });
    } catch (err) {
      setSellers({
        error: err instanceof Error ? err.message : String(err),
        rows: [],
        status: 'error',
      });
    }
  };

  // After staging a selection into a scratch list, start ranking without a second click.
  useEffect(() => {
    if (!autoLoad) return;
    void loadSellers();
    // Intentionally only when the target list (or autoLoad) changes — not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad, wantListId]);

  const priceSeller = async (row: SellerWants) => {
    priceAborts.current.get(row.idSeller)?.abort();
    const controller = new AbortController();
    priceAborts.current.set(row.idSeller, controller);
    setPriced(p => ({ ...p, [row.idSeller]: { status: 'loading' } }));
    try {
      const { offers } = await fetchSellerListOffers(
        row.url,
        wantListId,
        () => {},
        controller.signal,
      );
      // Cheapest offer per card (any printing), keeping the article id for cart.
      const cheapest = new Map<string, { articleId?: string; price: number }>();
      for (const o of offers) {
        const key = stripVersion(cardKey(o.name));
        const v = o.priceValue ?? Infinity;
        const prev = cheapest.get(key);
        if (!prev || v < prev.price) {
          cheapest.set(key, { articleId: o.articleId, price: v });
        }
      }
      const total = [...cheapest.values()].reduce(
        (s, v) => s + (Number.isFinite(v.price) ? v.price : 0),
        0,
      );
      const articleIds = [...cheapest.values()]
        .map(v => v.articleId)
        .filter((id): id is string => !!id);
      const missing =
        listCards.size > 0
          ? [...listCards.entries()].filter(([k]) => !cheapest.has(k)).map(([, name]) => name)
          : [];
      setPriced(p => ({
        ...p,
        [row.idSeller]: {
          articleIds,
          cartStatus: 'idle',
          matched: cheapest.size,
          missing,
          status: 'done',
          total,
        },
      }));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setPriced(p => ({
        ...p,
        [row.idSeller]: {
          error: err instanceof Error ? err.message : String(err),
          status: 'error',
        },
      }));
    } finally {
      priceAborts.current.delete(row.idSeller);
    }
  };

  const addAllToCart = async (row: SellerWants) => {
    const p = priced[row.idSeller];
    const ids = p?.articleIds ?? [];
    if (ids.length === 0) return;
    setPriced(prev => ({
      ...prev,
      [row.idSeller]: { ...prev[row.idSeller]!, cartStatus: 'adding' },
    }));
    try {
      let added = 0;
      for (const articleId of ids) {
        const attempt = async () => {
          const token = await cmToken();
          if (!token) return { message: 'Not signed in', ok: false as const };
          rememberWriteToken(token);
          return addArticleToCart(articleId, token);
        };
        let r = await attempt();
        if (!r.ok && /could not be completed|session|token|csrf|sign in/i.test(r.message)) {
          clearCachedTokens();
          r = await attempt();
        }
        if (!r.ok && /not signed in/i.test(r.message)) {
          askForLogin();
          throw new Error(r.message);
        }
        if (r.ok) added++;
        await new Promise(done => setTimeout(done, 350 + Math.random() * 350));
      }
      await cartStore.refresh();
      if (added === 0) throw new Error('Cardmarket refused every add.');
      setPriced(prev => ({
        ...prev,
        [row.idSeller]: {
          ...prev[row.idSeller]!,
          cartError:
            added < ids.length
              ? `Added ${added} of ${ids.length} — some offers were refused.`
              : undefined,
          cartStatus: 'done',
        },
      }));
    } catch (err) {
      setPriced(prev => ({
        ...prev,
        [row.idSeller]: {
          ...prev[row.idSeller]!,
          cartError: err instanceof Error ? err.message : String(err),
          cartStatus: 'error',
        },
      }));
    }
  };

  return (
    <div className="flex-none border-b border-line px-2 py-1.5 text-2xs">
      {heading && <div className="mb-1 font-medium text-ink">{heading}</div>}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={sellers.status === 'loading'}
          onClick={() => void loadSellers()}
          size="xs"
          variant="primary"
        >
          {sellers.status === 'loading'
            ? 'Finding sellers…'
            : sellers.status === 'done'
              ? 'Refresh best sellers'
              : 'Find best sellers for this list'}
        </Button>
        {listCards.size > 0 ? (
          <span className="text-ink-faint">
            {listCards.size} card{listCards.size === 1 ? '' : 's'} in this list
          </span>
        ) : (
          <span className="text-warn">
            Sync this want list to price sellers and see missing cards.
          </span>
        )}
      </div>

      {sellers.error && <p className="mt-1 text-neg">{sellers.error}</p>}

      {sellers.rows.length > 0 && (
        <div className="mt-1.5 max-h-48 space-y-1 overflow-y-auto overscroll-contain">
          {[...sellers.rows]
            .sort((a, b) =>
              compareFavouriteFirst(
                favourites,
                a,
                b,
                row => ({ name: row.name, url: row.url }),
                (x, y) => y.count - x.count || x.name.localeCompare(y.name),
              ),
            )
            .map(row => {
              const p = priced[row.idSeller];
              const fav = isFavourite(row.url, row.name);
              const fromId = countryId(row.location);
              const matrix = fromId != null ? shipping.matrices[fromId] : undefined;
              const est =
                matrix && p?.status === 'done' && p.total != null && (p.matched ?? 0) > 0
                  ? estimateShipping(matrix, p.matched ?? 0, p.total)
                  : null;
              const canCart = !!p?.articleIds?.length && p.cartStatus !== 'adding';
              return (
                <div
                  key={row.idSeller}
                  className={`rounded border p-1.5 ${
                    fav ? 'border-accent/40 bg-accent-soft/40' : 'border-line bg-raised/40'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <FavouriteSellerControl
                      active={fav}
                      name={row.name}
                      onToggle={() => void toggleFavourite(row.url, row.name)}
                    />
                    <SellerNameButton
                      className="font-semibold text-accent hover:underline"
                      name={row.name}
                      url={row.url}
                    />
                    {fav ? <FavouriteSellerBadge /> : null}
                    <span className="text-ink-muted">
                      {row.count}
                      {listCards.size > 0 ? `/${listCards.size}` : ''} · {row.pct}%
                    </span>
                    {row.sales && <span className="text-ink-faint">{row.sales} sales</span>}
                    {row.location && <span className="text-ink-faint">{row.location}</span>}
                    {p?.status === 'done' && p.total != null && (
                      <span className="font-semibold text-pos">
                        {fmtEuro(p.total)}
                        <span className="ml-1 font-normal text-ink-faint">
                          ({p.matched} card{p.matched === 1 ? '' : 's'})
                        </span>
                      </span>
                    )}
                    {est && (
                      <span
                        className="text-warn"
                        title={`${est.method.name} from ${row.location} · ≈${est.weight} g`}
                      >
                        + ship ≈{fmtEuro(est.method.price)}
                        <span className="ml-1 font-semibold text-pos">
                          = {fmtEuro((p?.total ?? 0) + est.method.price)}
                        </span>
                      </span>
                    )}
                    <span className="ml-auto flex flex-wrap items-center gap-1">
                      <Button
                        disabled={p?.status === 'loading'}
                        onClick={() => void priceSeller(row)}
                        size="xs"
                        variant="neutral"
                      >
                        {p?.status === 'loading'
                          ? 'Pricing…'
                          : p?.status === 'done'
                            ? 'Re-price'
                            : 'Price it'}
                      </Button>
                      {p?.status === 'done' && (
                        <Button
                          disabled={!canCart}
                          icon={ShoppingCart}
                          onClick={() => void addAllToCart(row)}
                          size="xs"
                          title={
                            p.articleIds?.length
                              ? `Add the cheapest offer of each of ${p.articleIds.length} cards to the cart`
                              : 'Price it first — no article ids to add'
                          }
                          variant="success"
                        >
                          {p.cartStatus === 'adding'
                            ? 'Adding…'
                            : p.cartStatus === 'done'
                              ? 'Added to cart'
                              : 'Add all to cart'}
                        </Button>
                      )}
                    </span>
                  </div>
                  {p?.status === 'error' && <p className="mt-1 text-neg">{p.error}</p>}
                  {p?.cartError && <p className="mt-1 text-warn">{p.cartError}</p>}
                  {p?.status === 'done' && p.missing && p.missing.length > 0 && (
                    <details className="mt-1 text-2xs text-warn">
                      <summary className="cursor-pointer select-none">
                        Missing {p.missing.length} card{p.missing.length === 1 ? '' : 's'}
                      </summary>
                      <div className="mt-0.5 text-ink-muted">{p.missing.join(', ')}</div>
                    </details>
                  )}
                  {p?.status === 'done' &&
                    p.missing &&
                    p.missing.length === 0 &&
                    listCards.size > 0 && (
                      <p className="mt-0.5 text-2xs text-pos">Has every card in the list.</p>
                    )}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
};
