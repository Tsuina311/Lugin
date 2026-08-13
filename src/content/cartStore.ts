// Live mirror of the Cardmarket shopping cart. We add articles by replaying the
// POST via fetch (not the site's own button), so the site's header cart widget
// doesn't refresh on its own. This store re-reads the authoritative cart from
// the server (`/ShoppingCart`) so the overlay's total always mirrors the site.
// It seeds instantly from the current page's header, then refreshes over the
// network for the full item list.
//
// It also watches captured traffic (via `noteCall`) for any cart-mutating AJAX
// request — the site's own "add to cart" / remove / change-amount buttons, or
// our replayed adds — and re-reads the cart automatically. This runs in the
// content script independent of the overlay, so the total stays correct even
// while the panel is hidden and after each article is added.

import type { CapturedCall } from '@/lib/types';
import { fetchServerCart, parseCartHeader, type CartItem } from '@/sites/cardmarket/cart';

export type { CartItem };

// Cardmarket mutates the cart with AJAX actions like
// `…/AjaxAction/ShoppingCart_Add_AddArticlesFromUserOffers` (also Remove_,
// Change_, …). The trailing underscore distinguishes these action endpoints
// from a plain GET of the `/ShoppingCart` page, so reading the cart never
// re-triggers a refresh.
const CART_MUTATION_RE = /ShoppingCart_[A-Za-z]/i;
// Coalesce bursts (adding several offers in quick succession) into one fetch.
const REFRESH_DEBOUNCE_MS = 500;

export interface CartState {
  count: number;
  error: string | null;
  fetchedAt: number | null;
  items: CartItem[];
  status: 'idle' | 'loading' | 'error';
  total: string | null;
  totalValue: number | null;
}

let state: CartState = {
  count: 0,
  error: null,
  fetchedAt: null,
  items: [],
  status: 'idle',
  total: null,
  totalValue: null,
};

const listeners = new Set<() => void>();
let controller: AbortController | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

const set = (partial: Partial<CartState>) => {
  state = { ...state, ...partial };
  for (const l of listeners) l();
};

export const cartStore = {
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
    cartStore.refreshSoon();
  },

  /** Re-read the authoritative cart from the server. */
  async refresh() {
    controller?.abort();
    controller = new AbortController();
    set({ error: null, status: 'loading' });
    try {
      const cart = await fetchServerCart(controller.signal);
      set({
        count: cart.count,
        error: null,
        fetchedAt: Date.now(),
        items: cart.items,
        status: 'idle',
        total: cart.total ?? null,
        totalValue: cart.totalValue ?? null,
      });
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

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
