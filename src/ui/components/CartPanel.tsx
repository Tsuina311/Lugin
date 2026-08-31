import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { compareFavouriteFirst, useFavouriteSellers, type FavouriteMap } from '../useFavouriteSellers';
import { useWideLayout } from '../useWideLayout';

import { Badge } from './Badge';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { FavouriteSellerBadge, FavouriteSellerControl } from './FavouriteSellerControl';
import { IconButton } from './IconButton';
import { SellerNameButton } from './SellerNameButton';
import { Tabs, type TabItem } from './Tabs';
import {
  CircleAlert,
  LayoutGrid,
  Loader2,
  RefreshCw,
  ShoppingCart,
  Trash2,
} from './icons';

import { cartStore, type CartItem } from '@/content/cartStore';
import {
  askForLogin,
  clearCachedTokens,
  cmToken,
  rememberWriteToken,
} from '@/content/session';
import { shippingStore } from '@/content/shippingStore';
import { cardKey } from '@/lib/cardName';
import { removeArticleFromCart } from '@/sites/cardmarket/cart';
import {
  COUNTRIES,
  countryId,
  countryName,
  estimateShipping,
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

type ShippingSnap = ReturnType<typeof shippingStore.getSnapshot>;

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

interface RemoveShipImpact {
  removesSeller: boolean;
  saves: number;
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

const goodsFromLines = (lines: CartItem[]): number =>
  lines.reduce((s, l) => s + (l.priceValue ?? 0) * l.amount, 0);

const cardCountFromLines = (lines: CartItem[]): number =>
  lines.reduce((n, l) => n + l.amount, 0);

/** Estimated shipping € for a seller bucket at a given card count and goods value. */
const shippingEstimate = (
  bucket: SellerBucket,
  cardCount: number,
  goodsValue: number,
  shipping: ShippingSnap,
): number | null => {
  const fromId = countryId(bucket.sellerCountry) ?? null;
  if (fromId == null || shipping.toCountry == null) return null;
  const matrix = shipping.matrices[fromId];
  if (!matrix?.length) return null;
  return estimateShipping(matrix, cardCount, goodsValue)?.method.price ?? null;
};

/** How much shipping drops if this line is removed (null if unknown or unchanged). */
const removeShippingImpact = (
  bucket: SellerBucket,
  item: CartItem,
  shipping: ShippingSnap,
): RemoveShipImpact | null => {
  const afterCount = bucket.count - item.amount;
  const current = shippingEstimate(bucket, bucket.count, bucket.total, shipping);
  if (current == null) return null;

  if (afterCount <= 0) {
    return { removesSeller: true, saves: current };
  }

  const remaining = bucket.lines.filter(l => l.articleId !== item.articleId);
  const afterGoods = goodsFromLines(remaining);
  const after = shippingEstimate(bucket, afterCount, afterGoods, shipping);
  if (after == null || after >= current) return null;
  return { removesSeller: false, saves: Math.round((current - after) * 100) / 100 };
};

/** Best single-line shipping saving for this seller (for the overview row hint). */
const bestRemoveSaving = (
  bucket: SellerBucket,
  shipping: ShippingSnap,
): RemoveShipImpact | null => {
  let best: RemoveShipImpact | null = null;
  for (const line of bucket.lines) {
    const impact = removeShippingImpact(bucket, line, shipping);
    if (!impact) continue;
    if (!best || impact.saves > best.saves) best = impact;
  }
  return best;
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
        count: cardCountFromLines(sorted),
        lines: sorted,
        seller,
        sellerCountry,
        total: goodsFromLines(sorted),
      };
    })
    .sort((a, b) => a.seller.localeCompare(b.seller));
};

const bucketForItem = (bySeller: SellerBucket[], item: CartItem): SellerBucket | undefined =>
  bySeller.find(b => b.lines.some(l => l.articleId === item.articleId));

/** Current estimated shipping € for a seller bucket, or null if unknown. */
const useSellerShipPrice = (bucket: SellerBucket): number | null => {
  const shipping = useSyncExternalStore(shippingStore.subscribe, shippingStore.getSnapshot);
  return shippingEstimate(bucket, bucket.count, bucket.total, shipping);
};

const ShippingSaveHint = ({
  className = '',
  impact,
}: {
  className?: string;
  impact: RemoveShipImpact;
}) => (
  <span
    className={`flex-none text-[10px] font-medium tabular-nums text-pos ${className}`}
    title={
      impact.removesSeller
        ? `Removes this seller — saves ${formatEuro(impact.saves)} shipping`
        : `Drops a shipping tier — saves ${formatEuro(impact.saves)}`
    }
  >
    −{formatEuro(impact.saves)} ship
  </span>
);

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
    `Tier up to ${current.maxCards} cards`,
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

const CartLineRow = ({
  bucket,
  item,
  onRemove,
  shipping,
  showSeller = false,
}: {
  bucket: SellerBucket | undefined;
  item: CartItem;
  onRemove: (item: CartItem) => void;
  shipping: ShippingSnap;
  showSeller?: boolean;
}) => {
  const impact = bucket ? removeShippingImpact(bucket, item, shipping) : null;
  const minPrice =
    bucket?.lines.reduce(
      (m, l) => Math.min(m, l.priceValue ?? Number.POSITIVE_INFINITY),
      Number.POSITIVE_INFINITY,
    ) ?? Number.POSITIVE_INFINITY;
  const isCheapest = (item.priceValue ?? Number.POSITIVE_INFINITY) === minPrice;

  return (
    <div className="group grid grid-cols-[1.75rem_minmax(0,1fr)_auto_auto] items-center gap-x-1.5 border-b border-line px-2 py-1 text-xs last:border-b-0 hover:bg-tint/40">
      {item.imageUrl ? (
        <img
          alt=""
          className="h-7 w-7 flex-none rounded bg-raised object-cover"
          src={item.imageUrl}
        />
      ) : (
        <div className="h-7 w-7 flex-none rounded bg-raised" />
      )}
      <div className="min-w-0">
        <div className="flex min-w-0 items-baseline gap-1">
          <span className="truncate font-medium text-ink">{item.name}</span>
          {showSeller && (
            <span className="truncate text-[10px] text-ink-faint" title={item.seller ?? undefined}>
              · {item.seller ?? 'Unknown'}
            </span>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 truncate text-[10px] text-ink-faint">
          {item.expansion ? <span className="truncate">{item.expansion}</span> : null}
          {isCheapest && bucket && bucket.lines.length > 1 ? (
            <span className="flex-none font-medium text-pos">Cheapest</span>
          ) : null}
        </div>
      </div>
      <span className="flex-none tabular-nums text-ink">
        {item.amount > 1 ? `${item.amount} × ` : ''}
        {item.price ?? '—'}
      </span>
      <div className="flex flex-none items-center gap-0.5">
        {impact ? <ShippingSaveHint impact={impact} /> : null}
        <IconButton
          className="opacity-70 group-hover:opacity-100"
          icon={Trash2}
          label={
            impact
              ? `Remove ${item.name}${impact.removesSeller ? ' and drop shipping' : ` — save ${formatEuro(impact.saves)} shipping`}`
              : `Remove ${item.name} from cart`
          }
          onClick={() => onRemove(item)}
          size="xs"
          tone="danger"
        />
      </div>
    </div>
  );
};

/** Compact duplicate block: one card, multiple cart lines — compare and trim. */
const DuplicateGroup = ({
  bySeller,
  favourites,
  group,
  onKeepCheapest,
  onRemove,
  shipping,
}: {
  bySeller: SellerBucket[];
  favourites: FavouriteMap;
  group: CardGroup;
  onKeepCheapest: (group: CardGroup) => void;
  onRemove: (item: CartItem) => void;
  shipping: ShippingSnap;
}) => {
  const crossSeller = group.sellers.length > 1;
  const sortedLines = useMemo(
    () =>
      [...group.lines].sort((a, b) =>
        compareFavouriteFirst(
          favourites,
          a,
          b,
          line => ({ name: line.seller ?? '' }),
          (x, y) => (x.priceValue ?? Infinity) - (y.priceValue ?? Infinity),
        ),
      ),
    [favourites, group.lines],
  );

  return (
    <section className="border-b border-line">
      <header className="flex items-center gap-1.5 bg-warn-soft/30 px-2 py-1">
        {group.lines[0]?.imageUrl ? (
          <img
            alt=""
            className="h-7 w-7 flex-none rounded bg-raised object-cover"
            src={group.lines[0].imageUrl}
          />
        ) : (
          <div className="h-7 w-7 flex-none rounded bg-raised" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-ink">{group.name}</div>
          <div className="truncate text-[10px] text-ink-faint">
            {group.lines[0]?.expansion ?? 'Same card in cart more than once'}
          </div>
        </div>
        <Badge title={`${group.lines.length} separate cart lines`} tone="warn">
          ×{group.lines.length}
        </Badge>
        <Button
          onClick={() => onKeepCheapest(group)}
          size="xs"
          title="Remove every line except the cheapest offer"
          variant="neutral"
        >
          Keep cheapest
        </Button>
      </header>

      {crossSeller && (
        <p className="border-b border-line bg-warn-soft/15 px-2 py-0.5 text-[10px] text-warn">
          From {group.sellers.length} sellers — pick one offer and drop the rest.
        </p>
      )}

      {sortedLines.map(item => (
        <CartLineRow
          key={item.articleId}
          bucket={bucketForItem(bySeller, item)}
          item={item}
          onRemove={onRemove}
          shipping={shipping}
          showSeller
        />
      ))}
    </section>
  );
};

const CartTotalsFooter = ({
  bySeller,
  shipping,
}: {
  bySeller: SellerBucket[];
  shipping: ShippingSnap;
}) => {
  const { goods, grand, ship, shipKnown } = useMemo(() => {
    let goods = 0;
    let ship = 0;
    let shipKnown = 0;
    for (const b of bySeller) {
      goods += b.total;
      const s = shippingEstimate(b, b.count, b.total, shipping);
      if (s != null) {
        ship += s;
        shipKnown += 1;
      }
    }
    return {
      goods,
      grand: goods + ship,
      ship,
      shipKnown,
    };
  }, [bySeller, shipping]);

  const shipLabel =
    shipping.toCountry == null
      ? 'Pick ship-to for estimates'
      : shipKnown === bySeller.length
        ? `${formatEuro(ship)} shipping`
        : shipKnown > 0
          ? `${formatEuro(ship)}+ shipping (loading…)`
          : 'Shipping loading…';

  return (
    <div className="flex flex-none flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-t border-line bg-panel px-2 py-1.5 text-xs">
      <span className="text-ink-faint">
        {formatEuro(goods)} cards · {shipLabel}
      </span>
      <span className="font-semibold tabular-nums text-ink" title="Cards + estimated shipping">
        Est. {formatEuro(grand)}
      </span>
    </div>
  );
};

export const CartPanel = () => {
  const cart = useSyncExternalStore(cartStore.subscribe, cartStore.getSnapshot);
  const shipping = useSyncExternalStore(shippingStore.subscribe, shippingStore.getSnapshot);
  const { favourites, isFavourite, toggle: toggleFavourite } = useFavouriteSellers();
  const { ref: wideRef, wide } = useWideLayout(560);
  const [tab, setTab] = useState<CartTab>(OVERVIEW);
  const [detectingCountry, setDetectingCountry] = useState(false);
  const autoDetectedRef = useRef(false);

  useEffect(() => {
    void cartStore.refresh();
  }, []);

  useEffect(() => {
    if (shipping.loading || shipping.toCountry != null || autoDetectedRef.current) return;
    autoDetectedRef.current = true;
    setDetectingCountry(true);
    void shippingStore.detectHomeCountry().finally(() => setDetectingCountry(false));
  }, [shipping.loading, shipping.toCountry]);

  const byCard = useMemo(() => groupByCard(cart.items), [cart.items]);
  const bySeller = useMemo(
    () =>
      groupBySeller(cart.items).sort((a, b) =>
        compareFavouriteFirst(
          favourites,
          a,
          b,
          bucket => ({ name: bucket.seller }),
          (x, y) => x.seller.localeCompare(y.seller),
        ),
      ),
    [cart.items, favourites],
  );
  /** Same card added more than once — any seller, any duplicate lines. */
  const duplicates = useMemo(() => byCard.filter(g => g.lines.length > 1), [byCard]);

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
        title: 'Cart summary, duplicates, and per-seller totals',
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

  const removeMany = (items: CartItem[]) => {
    for (const item of items) void removeItem(item);
  };

  const keepCheapest = (group: CardGroup) => {
    const sorted = [...group.lines].sort(
      (a, b) => (a.priceValue ?? Infinity) - (b.priceValue ?? Infinity),
    );
    const keep = sorted[0];
    if (!keep) return;
    const extras = group.lines.filter(l => l.articleId !== keep.articleId);
    void removeMany(extras);
  };

  const removeSeller = async (bucket: SellerBucket) => {
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
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-2 py-1">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-ink">
            {cart.total ?? (cart.status === 'loading' ? '…' : '0,00 €')}
            {cart.count > 0 && (
              <span className="ml-1.5 font-normal text-ink-faint">
                · {cart.count} card{cart.count === 1 ? '' : 's'}
                {bySeller.length > 0 &&
                  ` · ${bySeller.length} seller${bySeller.length === 1 ? '' : 's'}`}
              </span>
            )}
          </div>
          {(cart.notice || cart.error) && (
            <div className="text-[10px] text-neg">{cart.notice ?? cart.error}</div>
          )}
        </div>
        <label className="flex items-center gap-1 text-[10px] text-ink-faint">
          <span className="sr-only">Ship to</span>
          <select
            className="max-w-[7.5rem] rounded border border-line bg-raised px-1 py-0.5 text-ink"
            onChange={e =>
              void shippingStore.setToCountry(e.target.value ? Number(e.target.value) : null)
            }
            title="Your country — shipping is calculated to here"
            value={shipping.toCountry ?? ''}
          >
            <option value="">{detectingCountry ? 'Detecting…' : 'Ship to…'}</option>
            {COUNTRIES.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
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
                {duplicates.length > 0 ? (
                  <>
                    <div className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-line bg-panel px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                      <CircleAlert aria-hidden className="text-warn" size={12} />
                      Duplicates
                      <Badge tone="warn">{duplicates.length}</Badge>
                    </div>
                    {duplicates.map(group => (
                      <DuplicateGroup
                        key={group.key}
                        bySeller={bySeller}
                        favourites={favourites}
                        group={group}
                        onKeepCheapest={keepCheapest}
                        onRemove={item => void removeItem(item)}
                        shipping={shipping}
                      />
                    ))}
                  </>
                ) : null}

                <div className="sticky top-0 z-10 border-b border-line bg-panel px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                  Per seller
                </div>
                {wide && (
                  <div
                    className={`grid ${SELLER_COLS_WIDE} gap-x-2 border-b border-line px-2 py-0.5 text-[9px] uppercase tracking-wide text-ink-faint`}
                  >
                    <span>Seller</span>
                    <span>Country</span>
                    <span className="text-right">Ship</span>
                    <span className="text-right">Cards</span>
                    <span className="text-right">Total</span>
                    <span />
                  </div>
                )}
                {bySeller.map(bucket => {
                  const fav = isFavourite(undefined, bucket.seller);
                  const shipSave = bestRemoveSaving(bucket, shipping);
                  return (
                    <div
                      key={bucket.seller}
                      className={`grid w-full items-center gap-x-2 border-b px-2 py-0.5 text-xs ${
                        fav ? 'border-amber-500/30 bg-amber-500/5' : 'border-line'
                      } ${wide ? SELLER_COLS_WIDE : SELLER_COLS_NARROW}`}
                    >
                      <div className="flex min-w-0 items-center gap-0.5">
                        <FavouriteSellerControl
                          active={fav}
                          name={bucket.seller}
                          onToggle={() => void toggleFavourite(undefined, bucket.seller)}
                        />
                        <SellerNameButton
                          className="truncate text-left font-medium text-ink hover:underline"
                          name={bucket.seller}
                        />
                        {!wide && bucket.sellerCountry && (
                          <span className="truncate font-normal text-ink-faint">
                            · {bucket.sellerCountry}
                          </span>
                        )}
                        <IconButton
                          icon={LayoutGrid}
                          label={`View ${bucket.seller}'s lines in cart`}
                          onClick={() => setTab(bucket.seller)}
                          size="xs"
                          tone="default"
                        />
                        {fav ? <FavouriteSellerBadge className="flex-none" /> : null}
                      </div>
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
                        {shipSave ? (
                          <span
                            className="ml-0.5 block text-[9px] font-medium text-pos"
                            title={
                              shipSave.removesSeller
                                ? 'Removing a line can drop this seller entirely'
                                : 'Removing a line can drop a shipping tier'
                            }
                          >
                            ↓ tier
                          </span>
                        ) : null}
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
                  );
                })}

                {duplicates.length === 0 && (
                  <p className="px-2 py-2 text-[10px] text-ink-faint">
                    No duplicate cards in the cart.
                  </p>
                )}
              </>
            ) : activeSeller ? (
              <>
                <header className="flex items-center gap-1.5 border-b border-line px-2 py-1">
                  <FavouriteSellerControl
                    active={isFavourite(undefined, activeSeller.seller)}
                    name={activeSeller.seller}
                    onToggle={() => void toggleFavourite(undefined, activeSeller.seller)}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
                    <SellerNameButton
                      className="truncate text-left font-medium text-ink hover:underline"
                      name={activeSeller.seller}
                    />
                    {isFavourite(undefined, activeSeller.seller) ? (
                      <FavouriteSellerBadge className="ml-1.5 align-middle" />
                    ) : null}
                  </span>
                  <span className="flex-none text-[10px] tabular-nums text-ink-faint">
                    <SellerShipStrip bucket={activeSeller} />
                  </span>
                  <span className="flex-none text-[10px] tabular-nums text-ink-faint">
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
                  <CartLineRow
                    key={item.articleId}
                    bucket={activeSeller}
                    item={item}
                    onRemove={row => void removeItem(row)}
                    shipping={shipping}
                  />
                ))}
              </>
            ) : null}
          </div>

          <CartTotalsFooter bySeller={bySeller} shipping={shipping} />
        </>
      )}
    </div>
  );
};
