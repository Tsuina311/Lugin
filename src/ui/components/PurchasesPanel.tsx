// Your Cardmarket order history, grouped by seller — so you can see who you
// actually buy from, when, and pin favourites from evidence rather than memory.

import { useMemo, useState, useSyncExternalStore } from 'react';

import { Badge } from './Badge';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { FavouriteSellerBadge, FavouriteSellerControl } from './FavouriteSellerControl';
import { SellerNameButton } from './SellerNameButton';
import { SearchInput } from './Field';
import { Loader2, ReceiptEuro, RefreshCw } from './icons';

import { purchaseStore } from '@/content/purchaseStore';
import { sellerBrowseStore } from '@/content/sellerBrowseStore';
import { askForLogin } from '@/content/session';
import { sessionStore } from '@/content/sessionStore';
import { taskQueue } from '@/content/taskQueue';
import {
  cardNameMatchesQuery,
  groupPurchasesBySeller,
  sellerMatchesQuery,
  type SellerCardRow,
  type SellerPurchaseGroup,
} from '@/lib/purchasesBySeller';
import { ordersWithoutSeller, shippingPerCopy } from '@/lib/sellerStats';
import { compareFavouriteFirst, useFavouriteSellers } from '@/ui/useFavouriteSellers';
import { formatShortDate, timeAgo } from '@/ui/format';

type QuickFilter = 'all' | 'favourites' | 'repeat' | 'quick';

const fmtEuro = (n: number): string => `${n.toFixed(2).replace('.', ',')} €`;

const orderHref = (orderId: string): string => {
  const first = location.pathname.split('/').filter(Boolean)[0] ?? '';
  const lang = /^[a-z]{2}$/.test(first) ? first : 'en';
  return `${location.origin}/${lang}/Magic/Orders/${orderId}`;
};

const handlingLabel = (group: SellerPurchaseGroup): string | null => {
  if (group.handlingDays == null || group.handlingSamples === 0) return null;
  const days =
    group.handlingDays === 1 ? '1 day' : `${Math.round(group.handlingDays * 10) / 10} days`;
  return `ships in ~${days} (${group.handlingSamples} order${group.handlingSamples === 1 ? '' : 's'})`;
};

const orderStateLabel = (state?: string): string | undefined => {
  if (!state) return undefined;
  switch (state) {
    case 'Paid':
      return 'paid';
    case 'Sent':
      return 'sent';
    case 'Arrived':
      return 'arrived';
    case 'NotArrived':
      return 'not arrived';
    default:
      return state.toLowerCase();
  }
};

const SellerBlock = ({
  cardQuery,
  group,
  isFavourite,
  onToggleFavourite,
}: {
  cardQuery: string;
  group: SellerPurchaseGroup;
  isFavourite: boolean;
  onToggleFavourite: () => void;
}) => {
  const shipPerCopy = shippingPerCopy(group);
  const handling = handlingLabel(group);
  const q = cardQuery.trim();
  const matchingCards = q
    ? group.cardRows.filter(c => cardNameMatchesQuery(c.name, q))
    : [];

  return (
    <section
      className={`rounded-md border p-2 ${
        isFavourite ? 'border-amber-500/40 bg-amber-500/5' : 'border-line bg-panel'
      }`}
    >
      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
        <FavouriteSellerControl
          active={isFavourite}
          name={group.name}
          onToggle={onToggleFavourite}
        />
        <SellerNameButton
          className="min-w-0 truncate text-sm font-semibold text-accent hover:underline"
          name={group.name}
          url={group.url}
        />
        {isFavourite ? <FavouriteSellerBadge /> : null}
        <span className="ml-auto text-[10px] tabular-nums text-ink-faint">
          {group.orders} order{group.orders === 1 ? '' : 's'} · {group.cards} card
          {group.cards === 1 ? '' : 's'} · {fmtEuro(group.spent)}
          {group.shipping > 0 ? ` · ship ${fmtEuro(group.shipping)}` : ''}
        </span>
      </div>
      {(handling || shipPerCopy != null) && (
        <p className="mt-0.5 text-[10px] text-ink-faint">
          {[handling, shipPerCopy != null ? `${fmtEuro(shipPerCopy)} / card ship` : null]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      {matchingCards.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1">
          {matchingCards.map((c: SellerCardRow) => (
            <li key={c.key}>
              <button
                className="rounded-full border border-line bg-raised px-2 py-0.5 text-[10px] text-ink hover:border-accent hover:text-accent"
                onClick={() => sellerBrowseStore.request(group.name, group.url, c.name)}
                title={`Browse ${group.name}'s stock for ${c.name}`}
                type="button"
              >
                {c.name}
                {c.copies > 1 ? ` ×${c.copies}` : ''}
              </button>
            </li>
          ))}
        </ul>
      )}
      <ul className="mt-2 divide-y divide-line/60 rounded border border-line/60 bg-canvas/40">
        {group.orderRows.map(order => (
          <li key={order.orderId} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-2 py-1.5 text-[11px]">
            <a
              className="font-medium tabular-nums text-accent hover:underline"
              href={orderHref(order.orderId)}
              rel="noreferrer"
              target="_blank"
              title={`Open order ${order.orderId} on Cardmarket`}
            >
              {order.paidTs != null ? formatShortDate(order.paidTs) : `Order ${order.orderId}`}
            </a>
            {order.state ? (
              <Badge tone={order.state === 'Arrived' ? 'pos' : 'neutral'}>
                {orderStateLabel(order.state)}
              </Badge>
            ) : null}
            <span className="text-ink-muted">
              {order.lines > 0
                ? `${order.lines} card${order.lines === 1 ? '' : 's'}`
                : 'order'}
              {order.copies > 0 && order.copies !== order.lines
                ? ` · ×${order.copies}`
                : order.copies > 0
                  ? order.copies > 1
                    ? ` · ×${order.copies}`
                    : ''
                  : ''}
              {order.spent > 0 ? ` · ${fmtEuro(order.spent)}` : ''}
              {order.shipping != null && order.shipping > 0
                ? ` · ship ${fmtEuro(order.shipping)}`
                : ''}
            </span>
            {order.paidTs != null ? (
              <span className="text-ink-faint">{timeAgo(order.paidTs)}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
};

export const PurchasesPanel = () => {
  const purchases = useSyncExternalStore(purchaseStore.subscribe, purchaseStore.getSnapshot);
  const session = useSyncExternalStore(sessionStore.subscribe, sessionStore.getSnapshot);
  const { favourites, isFavourite, toggle: toggleFavourite } = useFavouriteSellers();

  const [query, setQuery] = useState('');
  const [quick, setQuick] = useState<QuickFilter>('all');

  const syncing = purchases.status === 'queued' || purchases.status === 'syncing';
  const needLogin = session.signedIn !== true;
  const loginHint = 'Sign in on Cardmarket to read your order history.';

  const syncNow = () => {
    if (needLogin) return;
    purchaseStore.markQueued();
    taskQueue.enqueue('syncPurchases', 'Sync purchases');
  };

  const groups = useMemo(
    () => (purchases.index ? groupPurchasesBySeller(purchases.index) : []),
    [purchases.index],
  );

  const missingSellers = useMemo(
    () => (purchases.index ? ordersWithoutSeller(purchases.index) : 0),
    [purchases.index],
  );

  const filtered = useMemo(() => {
    const q = query.trim();
    let rows = q ? groups.filter(g => sellerMatchesQuery(g, q)) : groups;
    if (quick === 'favourites') {
      rows = rows.filter(g => isFavourite(g.url, g.name));
    } else if (quick === 'repeat') {
      rows = rows.filter(g => g.orders >= 2);
    } else if (quick === 'quick') {
      rows = rows.filter(
        g => g.handlingDays != null && g.handlingDays <= 2 && g.handlingSamples >= 1,
      );
    }
    return [...rows].sort((a, b) =>
      compareFavouriteFirst(
        favourites,
        a,
        b,
        g => ({ name: g.name, url: g.url }),
        (x, y) => y.orders - x.orders || y.spent - x.spent || x.name.localeCompare(y.name),
      ),
    );
  }, [groups, query, quick, favourites, isFavourite]);

  const quickFilters: { id: QuickFilter; label: string }[] = [
    { id: 'all', label: 'All sellers' },
    { id: 'favourites', label: 'Favourites' },
    { id: 'repeat', label: 'Bought 2+' },
    { id: 'quick', label: 'Quick ship' },
  ];

  if (purchases.loading) {
    return (
      <EmptyState hint="Loading saved purchase history…" icon={Loader2} title="Purchases" />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-none border-b border-line px-2 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-ink">
            <ReceiptEuro aria-hidden size={14} />
            Purchases by seller
          </span>
          {purchases.index ? (
            <span className="text-[10px] text-ink-faint">
              {groups.length} seller{groups.length === 1 ? '' : 's'} ·{' '}
              {purchases.index.orderIds.length} order
              {purchases.index.orderIds.length === 1 ? '' : 's'} · read {timeAgo(purchases.index.syncedAt)}
            </span>
          ) : null}
          <Button
            className="ml-auto"
            disabled={syncing || needLogin}
            icon={syncing ? Loader2 : RefreshCw}
            onClick={syncNow}
            size="xs"
            title={needLogin ? loginHint : undefined}
            variant="primary"
          >
            {syncing ? 'Syncing…' : purchases.index ? 'Re-read orders' : 'Read my purchases'}
          </Button>
        </div>

        {needLogin && (
          <p className="mt-1 text-[10px] text-ink-faint">
            {loginHint}{' '}
            <button
              className="text-accent hover:underline"
              onClick={() => askForLogin()}
              type="button"
            >
              Sign in
            </button>
          </p>
        )}

        {missingSellers > 0 && (
          <p className="mt-1 text-[10px] text-warn">
            {missingSellers} order{missingSellers === 1 ? '' : 's'} still missing a seller — re-read
            orders to fill them in for this view.
          </p>
        )}

        {syncing && purchases.progress?.phase === 'orders' && (
          <div className="mt-2">
            <div className="text-[10px] text-ink-faint">
              Reading order {purchases.progress.current} of {purchases.progress.total}…
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded bg-raised">
              <div
                className="h-full bg-accent transition-all"
                style={{
                  width: `${(purchases.progress.current / Math.max(1, purchases.progress.total)) * 100}%`,
                }}
              />
            </div>
          </div>
        )}

        {purchases.error && <p className="mt-1 text-[10px] text-neg">{purchases.error}</p>}

        {groups.length > 0 && (
          <>
            <div className="mt-2">
              <SearchInput
                onChange={e => setQuery(e.target.value)}
                onClear={() => setQuery('')}
                placeholder="Filter sellers or card name…"
                value={query}
              />
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {quickFilters.map(f => (
                <button
                  key={f.id}
                  aria-pressed={quick === f.id}
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium ${
                    quick === f.id ? 'bg-accent text-accent-ink' : 'bg-raised text-ink-faint'
                  }`}
                  onClick={() => setQuick(f.id)}
                  type="button"
                >
                  {f.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!purchases.index ? (
          <EmptyState
            action={
              needLogin ? (
                <Button onClick={() => askForLogin()} size="sm" variant="primary">
                  Sign in on Cardmarket
                </Button>
              ) : (
                <Button disabled={syncing} onClick={syncNow} size="sm" variant="primary">
                  Read my purchases
                </Button>
              )
            }
            hint={
              needLogin
                ? loginHint
                : 'Lugin reads your Cardmarket order history on this device, then groups it by seller with each order date — useful when choosing who to trust.'
            }
            icon={ReceiptEuro}
            title="No purchase history yet"
          />
        ) : groups.length === 0 ? (
          <EmptyState
            hint={
              missingSellers > 0
                ? 'Orders were read but sellers were not captured yet. Re-read orders after signing in.'
                : 'Your synced orders have no seller information to group.'
            }
            icon={ReceiptEuro}
            title="No sellers in history"
          />
        ) : filtered.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-ink-muted">
            No sellers match this filter — try a card name you bought.
          </p>
        ) : (
          <div className="space-y-2">
            {filtered.map(group => (
              <SellerBlock
                key={group.slug}
                cardQuery={query}
                group={group}
                isFavourite={isFavourite(group.url, group.name)}
                onToggleFavourite={() => void toggleFavourite(group.url, group.name)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
