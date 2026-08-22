// Live mirror of the Cardmarket shopping cart. We add articles by replaying the
// POST via fetch (not the site's own button), so the site's header cart widget
// doesn't refresh on its own. This store re-reads the authoritative cart from
// the server (`/ShoppingCart`) so the overlay's total always mirrors the site.
// It seeds instantly from the current page's header, then refreshes over the
// network for the full item list.
//
// Removes are optimistic (sunshine path): the line disappears from the UI
// immediately, the request runs in the background, and only a failure puts the
// line back with a short notice. Pending removes are filtered out of any
// in-flight server refresh so a slow `/ShoppingCart` fetch can't resurrect a
// row we already hid.
//
// It also watches captured traffic (via `noteCall`) for any cart-mutating AJAX
// request — the site's own "add to cart" / remove / change-amount buttons, or
// our replayed adds — and re-reads the cart automatically. This runs in the
// content script independent of the overlay, so the total stays correct even
// while the panel is hidden and after each article is added.

import type { CapturedCall } from '@/lib/types';
import { rememberWriteToken } from '@/content/session';
import { shippingStore } from '@/content/shippingStore';
import {
  fetchServerCart,
  parseCartHeader,
  type CartItem,
} from '@/sites/cardmarket/cart';
import { countryId, estimateShipping } from '@/sites/cardmarket/shipping';

export type { CartItem };

// Cardmarket mutates the cart with AJAX actions like
// `…/AjaxAction/ShoppingCart_Add_AddArticlesFromUserOffers` (also Remove_,
// Change_, …). The trailing underscore distinguishes these action endpoints
// from a plain GET of the `/ShoppingCart` page, so reading the cart never
// re-triggers a refresh.
const CART_MUTATION_RE = /ShoppingCart_[A-Za-z]+/i;
// Coalesce bursts (adding several offers in quick succession) into one fetch.
const REFRESH_DEBOUNCE_MS = 500;
/** How long a failure notice stays on screen before clearing itself. */
const NOTICE_MS = 6_000;

export interface CartState {
  count: number;
  error: string | null;
  fetchedAt: number | null;
  items: CartItem[];
  /** Short-lived failure message (e.g. optimistic remove that Cardmarket rejected). */
  notice: string | null;
  status: 'idle' | 'loading' | 'error';
  total: string | null;
  totalValue: number | null;
}

let state: CartState = {
  count: 0,
  error: null,
  fetchedAt: null,
  items: [],
  notice: null,
  status: 'idle',
  total: null,
  totalValue: null,
};

const listeners = new Set<() => void>();
let controller: AbortController | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
/** Article ids removed in the UI while the Cardmarket request is still in flight. */
const pendingRemoves = new Set<string>();

const set = (partial: Partial<CartState>) => {
  state = { ...state, ...partial };
  for (const l of listeners) l();
};

const formatTotal = (n: number): string => `${n.toFixed(2).replace('.', ',')} €`;

const goodsValue = (item: CartItem): number => (item.priceValue ?? 0) * item.amount;

const goodsFrom = (items: CartItem[]): number => items.reduce((s, i) => s + goodsValue(i), 0);

const sellerKey = (item: CartItem): string =>
  item.sellerId ? `id:${item.sellerId}` : `name:${(item.seller ?? '').toLowerCase()}`;

/** Estimated postage for one seller's remaining lines (0 if rates aren't cached yet). */
const estimatedSellerShipping = (sellerItems: CartItem[]): number => {
  if (sellerItems.length === 0) return 0;
  const snap = shippingStore.getSnapshot();
  if (snap.toCountry == null) return 0;
  const fromId = countryId(sellerItems[0]?.sellerCountry);
  if (fromId == null) return 0;
  const matrix = snap.matrices[fromId];
  if (!matrix?.length) return 0;
  const count = sellerItems.reduce((n, i) => n + i.amount, 0);
  return estimateShipping(matrix, count, goodsFrom(sellerItems))?.method.price ?? 0;
};

/**
 * Cardmarket's header total includes shipping. Optimistic updates adjust that
 * figure by goods (± shipping when a seller's last line is removed/restored)
 * instead of collapsing to a goods-only sum.
 */
const adjustDisplayedTotal = (
  items: CartItem[],
  delta: number,
): Pick<CartState, 'count' | 'total' | 'totalValue'> => {
  const count = items.reduce((n, i) => n + i.amount, 0);
  const totalValue =
    state.totalValue != null
      ? Math.max(0, Math.round((state.totalValue + delta) * 100) / 100)
      : goodsFrom(items);
  return { count, total: formatTotal(totalValue), totalValue };
};

/** Shipping for sellers whose every server line is in `pendingRemoves`. */
const pendingSellerShipping = (serverItems: CartItem[]): number => {
  const bySeller = new Map<string, CartItem[]>();
  for (const item of serverItems) {
    const key = sellerKey(item);
    const list = bySeller.get(key);
    if (list) list.push(item);
    else bySeller.set(key, [item]);
  }
  let ship = 0;
  for (const sellerItems of bySeller.values()) {
    if (sellerItems.every(i => pendingRemoves.has(i.articleId))) {
      ship += estimatedSellerShipping(sellerItems);
    }
  }
  return ship;
};

/** Apply a server cart snapshot, still hiding anything we've optimistically removed. */
const applyServerCart = (cart: {
  count: number;
  items: CartItem[];
  total?: string;
  totalValue?: number;
}) => {
  if (pendingRemoves.size === 0) {
    set({
      count: cart.count,
      error: null,
      fetchedAt: Date.now(),
      items: cart.items,
      status: 'idle',
      total: cart.total ?? null,
      totalValue: cart.totalValue ?? null,
    });
    return;
  }

  const pendingOnServer = cart.items.filter(i => pendingRemoves.has(i.articleId));
  const items = cart.items.filter(i => !pendingRemoves.has(i.articleId));
  const removedGoods = goodsFrom(pendingOnServer);
  const removedShip = pendingSellerShipping(cart.items);
  // Keep shipping for remaining sellers: peel off goods (and postage for sellers
  // we've emptied) from the server's shipping-inclusive total.
  const base =
    cart.totalValue ??
    (state.totalValue != null
      ? state.totalValue + removedGoods + removedShip
      : goodsFrom(cart.items));
  const totalValue = Math.max(0, Math.round((base - removedGoods - removedShip) * 100) / 100);
  const count = items.reduce((n, i) => n + i.amount, 0);
  set({
    count,
    error: null,
    fetchedAt: Date.now(),
    items,
    status: 'idle',
    total: formatTotal(totalValue),
    totalValue,
  });
};

export const cartStore = {
  /** Clear the ephemeral notice (or let it time out on its own). */
  clearNotice() {
    if (noticeTimer) {
      clearTimeout(noticeTimer);
      noticeTimer = null;
    }
    if (state.notice != null) set({ notice: null });
  },

  /**
   * Server confirmed the remove — drop the pending marker. A later refresh can
   * now trust the server list for this article id.
   */
  confirmRemove(articleId: string) {
    pendingRemoves.delete(articleId);
  },

  getSnapshot(): CartState {
    return state;
  },

  /**
   * Inspect a captured call and refresh the cart if it mutated it. Wired to the
   * interceptor bridge so the site's own add/remove buttons (and our replayed
   * adds) keep the mirror in sync — even while the overlay is hidden.
   */
  noteCall(call: CapturedCall) {
    if (call.method === 'GET' || call.method === 'HEAD') return;
    if (!CART_MUTATION_RE.test(call.url)) return;
    const fromBody = call.requestBody?.match(/__cmtkn=([0-9a-f]{32,})/i)?.[1];
    if (fromBody) rememberWriteToken(fromBody);
    cartStore.refreshSoon();
  },

  /**
   * Sunshine path: hide the line now, before Cardmarket answers.
   * Returns the removed item so the caller can restore it if the request fails.
   */
  removeOptimistic(articleId: string): CartItem | null {
    const item = state.items.find(i => i.articleId === articleId);
    if (!item) return null;
    pendingRemoves.add(articleId);
    const key = sellerKey(item);
    const sellerBefore = state.items.filter(i => sellerKey(i) === key);
    const items = state.items.filter(i => i.articleId !== articleId);
    const emptiedSeller = !items.some(i => sellerKey(i) === key);
    const shipDelta = emptiedSeller ? -estimatedSellerShipping(sellerBefore) : 0;
    set({
      ...adjustDisplayedTotal(items, -goodsValue(item) + shipDelta),
      error: null,
      items,
      notice: null,
    });
    return item;
  },

  /** Re-read the authoritative cart from the server. */
  async refresh() {
    controller?.abort();
    controller = new AbortController();
    set({ error: null, status: 'loading' });
    try {
      // Always hit the server. AJAX add/remove leaves the live /ShoppingCart DOM
      // stale, so reading it here would miss the change.
      const cart = await fetchServerCart(controller.signal);
      applyServerCart(cart);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      set({ error: err instanceof Error ? err.message : String(err), status: 'error' });
    } finally {
      controller = null;
    }
  },

  /** Debounced refresh — coalesces a burst of cart changes into one fetch. */
  refreshSoon() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void cartStore.refresh();
    }, REFRESH_DEBOUNCE_MS);
  },

  /**
   * Put a line back after Cardmarket rejected the remove, and surface why.
   */
  revertRemove(item: CartItem, notice: string) {
    pendingRemoves.delete(item.articleId);
    if (state.items.some(i => i.articleId === item.articleId)) {
      cartStore.showNotice(notice);
      return;
    }
    const key = sellerKey(item);
    const wasEmptySeller = !state.items.some(i => sellerKey(i) === key);
    const items = [...state.items, item].sort(
      (a, b) =>
        (a.seller ?? '').localeCompare(b.seller ?? '') || a.name.localeCompare(b.name),
    );
    const sellerAfter = items.filter(i => sellerKey(i) === key);
    const shipDelta = wasEmptySeller ? estimatedSellerShipping(sellerAfter) : 0;
    set({ ...adjustDisplayedTotal(items, goodsValue(item) + shipDelta), items });
    cartStore.showNotice(notice);
  },

  /** Instant, network-free seed from the current page's header (`#cart`). */
  seedFromDom() {
    try {
      const { total, totalValue, count } = parseCartHeader(document);
      if (total != null || count > 0) {
        set({ count, total: total ?? state.total, totalValue: totalValue ?? state.totalValue });
      }
    } catch {
      // ignore — refresh() will fetch the authoritative values
    }
  },

  /** Show a short-lived notice (auto-clears). */
  showNotice(message: string) {
    if (noticeTimer) clearTimeout(noticeTimer);
    set({ notice: message });
    noticeTimer = setTimeout(() => {
      noticeTimer = null;
      if (state.notice === message) set({ notice: null });
    }, NOTICE_MS);
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
