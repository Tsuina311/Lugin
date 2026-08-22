import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { Badge } from './Badge';
import { EmptyState } from './EmptyState';
import { IconButton } from './IconButton';
import { Tabs, type TabItem } from './Tabs';
import {
  CircleAlert,
  LayoutGrid,
  Loader2,
  RefreshCw,
  ShoppingCart,
  Trash2,
} from './icons';
import { useWideLayout } from '../useWideLayout';

import { cartStore, type CartItem } from '@/content/cartStore';
import { shippingStore } from '@/content/shippingStore';
import {
  askForLogin,
  clearCachedTokens,
  cmToken,
  rememberWriteToken,
} from '@/content/session';
import { cardKey } from '@/lib/cardName';
import { removeArticleFromCart } from '@/sites/cardmarket/cart';
import {
  COUNTRIES,
  countryId,
  countryName,
  shippingTiers,
  type ShipTier,
} from '@/sites/cardmarket/shipping';

const formatEuro = (n: number): string => `${n.toFixed(2).replace('.', ',')} €`;

/** Wide: seller | country | shipping | cards | total. */
const SELLER_COLS_WIDE =
  'grid-cols-[minmax(0,1.2fr)_5.75rem_4.75rem_5.25rem_5.25rem_1.5rem]';
/** Narrow: seller (+ country) | shipping | cards | total. */
const SELLER_COLS_NARROW = 'grid-cols-[minmax(0,1fr)_4.25rem_4.75rem_4.75rem_1.5rem]';

const OVERVIEW = 'overview';
type CartTab = typeof OVERVIEW | (string & {});

interface CardGroup {
  key: string;
  lines: CartItem[];
  name: string;
  /** Display names of sellers that have this card. */
  sellers: string[];
}

interface SellerBucket {
  count: number;
  lines: CartItem[];
  seller: string;
  /** Seller country for shipping (from cart page flag / item location). */
  sellerCountry?: string;
  total: number;
}

/** Prev / current / next weight tiers for a cart line count. */
const adjacentTiers = (
  tiers: ShipTier[],
  cardCount: number,
): { current: ShipTier | null; next: ShipTier | null; prev: ShipTier | null } => {
  if (!tiers.length) return { current: null, next: null, prev: null };
  const found = tiers.findIndex(t => cardCount <= t.maxCards);
  const i = found === -1 ? tiers.length - 1 : found;
  return {
    current: tiers[i] ?? null,
    next: tiers[i + 1] ?? null,
    prev: i > 0 ? (tiers[i - 1] ?? null) : null,
  };
};

const groupByCard = (items: CartItem[]): CardGroup[] => {
  const map = new Map<string, CartItem[]>();
  for (const item of items) {
    const key = cardKey(item.name);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return [...map.entries()]
    .map(([key, lines]) => {
      const sorted = [...lines].sort(
        (a, b) => (a.priceValue ?? Infinity) - (b.priceValue ?? Infinity),
      );
      const sellers: string[] = [];
      const seen = new Set<string>();
      for (const line of sorted) {
        const name = line.seller ?? 'Unknown seller';
        const id = name.toLowerCase();
        if (seen.has(id)) continue;
        seen.add(id);
        sellers.push(name);
      }
      return {
        key,
        lines: sorted,
        name: sorted[0]?.name ?? key,
        sellers,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
};

const groupBySeller = (items: CartItem[]): SellerBucket[] => {
  const map = new Map<string, CartItem[]>();
  for (const item of items) {
    const seller = item.seller ?? 'Unknown seller';
    const list = map.get(seller);
    if (list) list.push(item);
    else map.set(seller, [item]);
  }
  return [...map.entries()]
    .map(([seller, lines]) => {
      const sorted = [...lines].sort((a, b) => a.name.localeCompare(b.name));
      const sellerCountry = sorted.find(l => l.sellerCountry)?.sellerCountry;
      return {
        count: sorted.reduce((n, l) => n + l.amount, 0),
        lines: sorted,
        seller,
        sellerCountry,
        total: sorted.reduce((s, l) => s + (l.priceValue ?? 0) * l.amount, 0),
      };
    })
    .sort((a, b) => a.seller.localeCompare(b.seller));
};

/** Current estimated shipping € for a seller bucket, or null if unknown. */
const useSellerShipPrice = (bucket: SellerBucket): number | null => {
  const shipping = useSyncExternalStore(shippingStore.subscribe, shippingStore.getSnapshot);
  const fromId = countryId(bucket.sellerCountry) ?? null;
  const matrix = fromId != null ? shipping.matrices[fromId] : undefined;
  const tiers = useMemo(() => (matrix ? shippingTiers(matrix) : []), [matrix]);
  const { current } = adjacentTiers(tiers, bucket.count);
  if (shipping.toCountry == null || fromId == null || !current) return null;
  return current.price;
};

/** Current shipping as a single amount — next tier only in the hover title. */
const SellerShipStrip = ({ bucket }: { bucket: SellerBucket }) => {
  const shipping = useSyncExternalStore(shippingStore.subscribe, shippingStore.getSnapshot);
  const fromId = countryId(bucket.sellerCountry) ?? null;
  const matrix = fromId != null ? shipping.matrices[fromId] : undefined;
  const tiers = useMemo(() => (matrix ? shippingTiers(matrix) : []), [matrix]);
  const { current, next } = adjacentTiers(tiers, bucket.count);
  const pending = fromId != null && shipping.pending.includes(fromId);
  const error = fromId != null ? shipping.errors[fromId] : undefined;

  const route =
    fromId != null && shipping.toCountry != null
      ? `${countryName(fromId)} → ${countryName(shipping.toCountry)}`
      : undefined;

  if (shipping.toCountry == null) {
    return <span className="text-[10px] text-ink-faint">Pick ship-to</span>;
  }
  if (fromId == null) {
    return <span className="text-[10px] text-ink-faint">—</span>;
  }
  if (!current) {
    return (
      <span className="text-[10px] text-ink-faint" title={route}>
        {error ? <span className="text-neg">{error}</span> : pending ? (
          <span className="animate-pulse">…</span>
        ) : (
          '—'
        )}
      </span>
    );
  }

  const title = [
    route,
    next
      ? `Next: ${formatEuro(next.price)} up to ${next.maxCards} cards` +
        (next.isTracked ? ' (tracked)' : '')
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <span className="tabular-nums text-ink" title={title}>
      {formatEuro(current.price)}
    </span>
  );
};


/** Goods+shipping for the overview total column. */
const SellerTotalCell = ({ bucket }: { bucket: SellerBucket }) => {
  const ship = useSellerShipPrice(bucket);
  const combined = ship != null ? bucket.total + ship : bucket.total;
  const title =
    ship != null
      ? `${formatEuro(bucket.total)} cards + ${formatEuro(ship)} shipping`
      : `${formatEuro(bucket.total)} cards (shipping unknown)`;
  return (
    <span className="text-right tabular-nums font-medium text-ink" title={title}>
      {formatEuro(combined)}
    </span>
  );
};


const LineRow = ({
  item,
  onRemove,
}: {
  item: CartItem;
  onRemove: (item: CartItem) => void;
}) => (
  <div className="flex items-start gap-2 border-b border-line px-2 py-1.5 text-xs">
    {item.imageUrl ? (
      <img
        alt=""
        className="mt-0.5 h-8 w-8 flex-none rounded bg-raised object-cover"
        src={item.imageUrl}
      />
    ) : (
      <div className="mt-0.5 h-8 w-8 flex-none rounded bg-raised" />
    )}
    <div className="min-w-0 flex-1">
      <div className="truncate font-medium text-ink">{item.name}</div>
      <div className="truncate text-2xs text-ink-faint">{item.expansion ?? ''}</div>
    </div>
    <span className="flex-none tabular-nums text-ink">
      {item.amount > 1 ? `${item.amount} × ` : ''}
      {item.price ?? '—'}
    </span>
    <IconButton
      icon={Trash2}
      label={`Remove ${item.name} from cart`}
      onClick={() => onRemove(item)}
      size="xs"
      tone="danger"
    />
  </div>
);

/** One shared card: sellers as columns, price + remove in each cell. */
const DuplicateTable = ({
  group,
  onRemove,
}: {
  group: CardGroup;
  onRemove: (item: CartItem) => void;
}) => {
  const minPrice = Math.min(
    ...group.lines.map(l => l.priceValue ?? Number.POSITIVE_INFINITY),
  );
  const hasCostlier = group.lines.some(
    l => (l.priceValue ?? Number.POSITIVE_INFINITY) > minPrice,
  );

  return (
    <section className="border-b border-line bg-warn-soft/20">
      <header className="flex items-center gap-1.5 px-2 pt-2 pb-1">
        {group.lines[0]?.imageUrl ? (
          <img
            alt=""
            className="h-8 w-8 flex-none rounded bg-raised object-cover"
            src={group.lines[0].imageUrl}
          />
        ) : (
          <div className="h-8 w-8 flex-none rounded bg-raised" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-ink">{group.name}</div>
          <div className="truncate text-2xs text-ink-faint">
            {group.lines[0]?.expansion ?? 'Same card from multiple sellers'}
          </div>
        </div>
        <Badge tone="warn">
          {group.sellers.length} sellers · {group.lines.length} offers
        </Badge>
      </header>

      <div className="overflow-x-auto px-2 pb-2">
        <table className="w-full min-w-[16rem] border-collapse text-2xs">
          <thead>
            <tr className="text-left text-ink-faint">
              {group.sellers.map(seller => (
                <th
                  key={seller}
                  className="border-b border-line px-1.5 py-1 font-semibold normal-case tracking-normal"
                >
                  <span className="block max-w-[9rem] truncate" title={seller}>
                    {seller}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="align-top">
              {group.sellers.map(seller => {
                const lines = group.lines.filter(
                  l => (l.seller ?? 'Unknown seller').toLowerCase() === seller.toLowerCase(),
                );
                return (
                  <td key={seller} className="border-b border-line px-1.5 py-1.5">
                    {lines.length === 0 ? (
                      <span className="text-ink-faint">—</span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {lines.map(item => {
                          const cheap =
                            hasCostlier &&
                            (item.priceValue ?? Number.POSITIVE_INFINITY) === minPrice;
                          return (
                            <div
                              key={item.articleId}
                              className={`flex items-center gap-1 rounded px-1 py-0.5 ${
                                cheap ? 'bg-pos-soft/50' : 'bg-raised'
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="tabular-nums text-ink">
                                  {item.amount > 1 ? `${item.amount} × ` : ''}
                                  {item.price ?? '—'}
                                </div>
                                {cheap && (
                                  <div className="text-[9px] font-medium text-pos">Cheapest</div>
                                )}
                              </div>
                              <IconButton
                                icon={Trash2}
                                label={`Remove ${item.name} from ${seller}`}
                                onClick={() => onRemove(item)}
                                size="xs"
                                tone="danger"
                              />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
};

export const CartPanel = () => {
  const cart = useSyncExternalStore(cartStore.subscribe, cartStore.getSnapshot);
  const shipping = useSyncExternalStore(shippingStore.subscribe, shippingStore.getSnapshot);
  const { ref: wideRef, wide } = useWideLayout(560);
  const [tab, setTab] = useState<CartTab>(OVERVIEW);
  const [detectingCountry, setDetectingCountry] = useState(false);
  const autoDetectedRef = useRef(false);

  useEffect(() => {
    void cartStore.refresh();
  }, []);

  // Same as Search: auto-detect home country once so shipping estimates work.
  useEffect(() => {
    if (shipping.loading || shipping.toCountry != null || autoDetectedRef.current) return;
    autoDetectedRef.current = true;
    setDetectingCountry(true);
    void shippingStore.detectHomeCountry().finally(() => setDetectingCountry(false));
  }, [shipping.loading, shipping.toCountry]);

  const byCard = useMemo(() => groupByCard(cart.items), [cart.items]);
  const bySeller = useMemo(() => groupBySeller(cart.items), [cart.items]);
  const duplicates = useMemo(() => byCard.filter(g => g.sellers.length > 1), [byCard]);

  // Prefetch each seller's route for the overview shipping strip.
  useEffect(() => {
    if (shipping.toCountry == null) return;
    for (const bucket of bySeller) {
      const id = countryId(bucket.sellerCountry);
      if (id != null) void shippingStore.ensureMatrix(id);
    }
  }, [bySeller, shipping.toCountry]);

  useEffect(() => {
    if (tab === OVERVIEW) return;
    if (!bySeller.some(s => s.seller === tab)) setTab(OVERVIEW);
  }, [bySeller, tab]);

  const tabItems = useMemo<TabItem<CartTab>[]>(
    () => [
      {
        count: duplicates.length || undefined,
        icon: LayoutGrid,
        id: OVERVIEW,
        label: 'Overview',
        title: 'Cart summary and cards shared across sellers',
      },
      ...bySeller.map(s => ({
        count: s.count,
        id: s.seller,
        label: s.seller,
        title: `${s.seller} · ${formatEuro(s.total)}`,
      })),
    ],
    [bySeller, duplicates.length],
  );

  const removeItem = async (item: CartItem) => {
    cartStore.clearNotice();

    // Sunshine path: drop the line immediately. Cardmarket is asked afterwards;
    // a failure restores the row and shows a notice.
    const snapshot = cartStore.removeOptimistic(item.articleId);
    if (!snapshot) return;

    try {
      const attempt = async () => {
        if (!item.sellerId) {
          return {
            message: 'Missing seller id for this line — refresh the cart and try again.',
            ok: false,
          };
        }
        const token = await cmToken();
        if (!token) {
          return { message: 'Not signed in — sign in on Cardmarket, then retry.', ok: false };
        }
        rememberWriteToken(token);
        return removeArticleFromCart(item.articleId, token, {
          amount: item.amount,
          sellerId: item.sellerId,
        });
      };

      let r = await attempt();
      if (!r.ok && /could not be completed|session|token|csrf|sign in/i.test(r.message)) {
        clearCachedTokens();
        r = await attempt();
      }
      if (!r.ok && /not signed in/i.test(r.message)) askForLogin();
      if (r.ok) {
        cartStore.confirmRemove(item.articleId);
        // Reconcile totals with the server when quiet — don't block the UI.
        cartStore.refreshSoon();
      } else {
        cartStore.revertRemove(snapshot, r.message);
      }
    } catch (err) {
      cartStore.revertRemove(
        snapshot,
        err instanceof Error ? err.message : String(err),
      );
    }
  };


  const removeSeller = async (bucket: SellerBucket) => {
    // Snapshot lines first — optimistic removes mutate cart.items immediately.
    const lines = [...bucket.lines];
    if (lines.length === 0) return;

    cartStore.clearNotice();
    if (tab === bucket.seller) setTab(OVERVIEW);

    const snapshots: CartItem[] = [];
    for (const item of lines) {
      const snap = cartStore.removeOptimistic(item.articleId);
      if (snap) snapshots.push(snap);
    }
    if (snapshots.length === 0) return;

    const runOne = async (item: CartItem): Promise<{ item: CartItem; message: string; ok: boolean }> => {
      const attempt = async () => {
        if (!item.sellerId) {
          return {
            message: 'Missing seller id for this line — refresh the cart and try again.',
            ok: false,
          };
        }
        const token = await cmToken();
        if (!token) {
          return { message: 'Not signed in — sign in on Cardmarket, then retry.', ok: false };
        }
        rememberWriteToken(token);
        return removeArticleFromCart(item.articleId, token, {
          amount: item.amount,
          sellerId: item.sellerId,
        });
      };

      try {
        let r = await attempt();
        if (!r.ok && /could not be completed|session|token|csrf|sign in/i.test(r.message)) {
          clearCachedTokens();
          r = await attempt();
        }
        return { item, message: r.message, ok: r.ok };
      } catch (err) {
        return {
          item,
          message: err instanceof Error ? err.message : String(err),
          ok: false,
        };
      }
    };

    const results = await Promise.all(snapshots.map(runOne));
    let failures = 0;
    for (const r of results) {
      if (r.ok) {
        cartStore.confirmRemove(r.item.articleId);
      } else {
        failures += 1;
        const snap = snapshots.find(s => s.articleId === r.item.articleId);
        if (snap) cartStore.revertRemove(snap, r.message);
      }
    }
    if (failures > 0 && results.some(r => /not signed in/i.test(r.message))) askForLogin();
    if (failures === 0) {
      cartStore.refreshSoon();
    } else if (failures < results.length) {
      cartStore.showNotice(
        `${failures} of ${results.length} lines could not be removed — refresh and retry.`,
      );
      cartStore.refreshSoon();
    }
  };

  const activeSeller = bySeller.find(s => s.seller === tab);

  return (
    <div ref={wideRef} className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-ink">
            {cart.total ?? (cart.status === 'loading' ? '…' : '0,00 €')}
            {cart.count > 0 && (
              <span className="ml-1.5 text-ink-faint">
                · {cart.count} item{cart.count === 1 ? '' : 's'}
                {bySeller.length > 0 &&
                  ` · ${bySeller.length} seller${bySeller.length === 1 ? '' : 's'}`}
              </span>
            )}
          </div>
          {(cart.notice || cart.error) && (
            <div className="text-2xs text-neg">{cart.notice ?? cart.error}</div>
          )}
        </div>
        <IconButton
          className={cart.status === 'loading' ? 'animate-spin' : ''}
          icon={RefreshCw}
          label="Refresh cart"
          onClick={() => void cartStore.refresh()}
          size="sm"
        />
      </div>

      {cart.items.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-auto">
          {cart.status === 'loading' ? (
            <EmptyState hint="Reading Cardmarket’s cart…" icon={Loader2} title="Loading cart" />
          ) : (
            <EmptyState
              hint="Add offers from Search, or open the site cart if you already have items."
              icon={ShoppingCart}
              title="Cart is empty"
            />
          )}
        </div>
      ) : (
        <>
          <Tabs items={tabItems} onChange={setTab} value={tab} />

          <div className="min-h-0 flex-1 overflow-auto">
            {tab === OVERVIEW ? (
              <>
                <div className="border-b border-line px-2 py-2">
                  <div className="text-xs text-ink">
                    <span className="font-medium">{cart.count}</span>
                    <span className="text-ink-faint">
                      {' '}
                      card{cart.count === 1 ? '' : 's'} from{' '}
                    </span>
                    <span className="font-medium">{bySeller.length}</span>
                    <span className="text-ink-faint">
                      {' '}
                      seller{bySeller.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-faint">
                    <span>Ship to</span>
                    <select
                      className="rounded border border-line bg-raised px-1 py-0.5 text-ink"
                      onChange={e =>
                        void shippingStore.setToCountry(
                          e.target.value ? Number(e.target.value) : null,
                        )
                      }
                      title="Your country — shipping is calculated to here"
                      value={shipping.toCountry ?? ''}
                    >
                      <option value="">{detectingCountry ? 'Detecting…' : 'Pick…'}</option>
                      {COUNTRIES.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="border-b border-line px-2 py-1 text-2xs font-semibold uppercase tracking-wide text-ink-faint">
                  Per seller
                </div>
                {wide && (
                  <div
                    className={`grid ${SELLER_COLS_WIDE} gap-x-2 border-b border-line px-2 py-0.5 text-[9px] uppercase tracking-wide text-ink-faint`}
                  >
                    <span>Seller</span>
                    <span>Country</span>
                    <span className="text-right">Shipping</span>
                    <span className="text-right">Cards</span>
                    <span className="text-right">Total</span>
                    <span />
                  </div>
                )}
                {bySeller.map(bucket => (
                  <div
                    key={bucket.seller}
                    className={`grid w-full items-center gap-x-2 border-b border-line px-2 py-1 text-xs ${
                      wide ? SELLER_COLS_WIDE : SELLER_COLS_NARROW
                    }`}
                  >
                    <button
                      className="min-w-0 truncate text-left font-medium text-ink hover:underline"
                      onClick={() => setTab(bucket.seller)}
                      title={bucket.seller}
                      type="button"
                    >
                      {bucket.seller}
                      {!wide && bucket.sellerCountry && (
                        <span className="ml-1 font-normal text-ink-faint">
                          · {bucket.sellerCountry}
                        </span>
                      )}
                    </button>
                    {wide && (
                      <span
                        className="min-w-0 truncate text-ink-faint"
                        title={bucket.sellerCountry ?? undefined}
                      >
                        {bucket.sellerCountry ?? '—'}
                      </span>
                    )}
                    <span className="text-right tabular-nums">
                      <SellerShipStrip bucket={bucket} />
                    </span>
                    <span className="text-right tabular-nums text-ink-faint">
                      {bucket.count} · {formatEuro(bucket.total)}
                    </span>
                    <SellerTotalCell bucket={bucket} />
                    <IconButton
                      icon={Trash2}
                      label={`Remove all cards from ${bucket.seller}`}
                      onClick={() => void removeSeller(bucket)}
                      size="xs"
                      tone="danger"
                    />
                  </div>
                ))}

                <div className="sticky top-0 z-10 border-b border-t border-line bg-panel px-2 py-1 text-2xs font-semibold uppercase tracking-wide text-ink-faint">
                  In common
                  {duplicates.length > 0 ? (
                    <span className="ml-1 font-normal normal-case text-warn">
                      · {duplicates.length} card{duplicates.length === 1 ? '' : 's'} from more than
                      one seller
                    </span>
                  ) : (
                    <span className="ml-1 font-normal normal-case">· none</span>
                  )}
                </div>

                {duplicates.length > 0 ? (
                  <>
                    <div className="flex items-start gap-2 border-b border-line bg-warn-soft px-2 py-1.5 text-2xs text-warn">
                      <CircleAlert aria-hidden className="mt-0.5 flex-none" size={14} />
                      <div>
                        Same card in the cart from different sellers — compare prices and remove the
                        extras you don’t want.
                      </div>
                    </div>
                    {duplicates.map(group => (
                      <DuplicateTable
                        key={group.key}
                        group={group}
                        onRemove={item => void removeItem(item)}
                      />
                    ))}
                  </>
                ) : (
                  <p className="px-2 py-3 text-2xs text-ink-faint">
                    No card appears under more than one seller.
                  </p>
                )}
              </>
            ) : activeSeller ? (
              <>
                <header className="flex items-center gap-2 border-b border-line px-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
                    {activeSeller.seller}
                  </span>
                  <span className="flex-none text-2xs tabular-nums text-ink-faint">
                    {activeSeller.count} · {formatEuro(activeSeller.total)}
                  </span>
                  <IconButton
                    icon={Trash2}
                    label={`Remove all cards from ${activeSeller.seller}`}
                    onClick={() => void removeSeller(activeSeller)}
                    size="xs"
                    tone="danger"
                  />
                </header>
                {activeSeller.lines.map(item => (
                  <LineRow
                    key={item.articleId}
                    item={item}
                    onRemove={row => void removeItem(row)}
                  />
                ))}
              </>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
};
