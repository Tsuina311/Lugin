// Who you actually buy from, derived from your own order history.
//
// Cardmarket has no notion of a favourite seller, so this builds one out of
// evidence rather than opinion: how often you bought, what you paid, what postage
// cost, and how fast the seller dispatched. That is a better basis than a badge on
// a profile, because it is measured on orders *you* placed.
//
// Pure and structurally typed — it takes the shape of a `PurchaseIndex` rather
// than the type, so `src/lib` keeps its independence from `src/sites` and the
// whole thing is testable from plain objects.
//
// Everything is optional in the input. This data arrived after people had already
// synced, so "unknown" is a normal answer and the callers have to render it.

/** A day, for turning timestamps into something a person reads. */
const DAY_MS = 24 * 60 * 60 * 1000;

export interface OrderFacts {
  paidTs?: number;
  seller?: string;
  sellerSlug?: string;
  sellerUrl?: string;
  sentTs?: number;
  /** Delivery state when captured from the purchases list. */
  state?: string;
}

export interface PurchaseLine {
  orderId: string;
  price?: number;
  qty?: number;
}

export interface PurchaseHistory {
  cards: Record<string, { count?: number; name?: string; purchases?: PurchaseLine[] }>;
  orders?: Record<string, OrderFacts>;
  shipping?: Record<string, number>;
}

export interface SellerStats {
  /** Distinct cards bought, not copies. */
  cards: number;
  /** Copies bought across every order. */
  copies: number;
  /**
   * Median days between payment and dispatch, or null when never observed.
   *
   * Median rather than mean: one order that shipped after a fortnight's holiday
   * should not redefine a seller who is otherwise same-day.
   */
  handlingDays: number | null;
  /** Orders the handling figure is based on — 1 is an anecdote, not a rate. */
  handlingSamples: number;
  /** Most recent purchase (ms). */
  lastTs: number | null;
  name: string;
  /** Orders placed with this seller. */
  orders: number;
  /** Postage paid to them, across the orders where it was captured. */
  shipping: number;
  /** First purchase (ms). */
  sinceTs: number | null;
  slug: string;
  /** Spent on cards, excluding postage. */
  spent: number;
  url?: string;
}

const median = (values: readonly number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

interface Accumulator {
  cardNames: Set<string>;
  copies: number;
  handling: number[];
  lastTs: number | null;
  name: string;
  orderIds: Set<string>;
  shipping: number;
  sinceTs: number | null;
  slug: string;
  spent: number;
  url?: string;
}

/**
 * Roll a purchase history up per seller.
 *
 * Orders whose seller was never captured are skipped rather than pooled into an
 * "unknown" seller: a bucket holding nine unrelated shops would rank first on
 * every measure and mean nothing. The caller reports the count instead, which is
 * actionable — it tells you a re-sync is worth running.
 */
export const sellerStats = (history: PurchaseHistory): SellerStats[] => {
  const orders = history.orders ?? {};
  const shipping = history.shipping ?? {};
  const bySlug = new Map<string, Accumulator>();

  const accumulatorFor = (orderId: string): Accumulator | undefined => {
    const facts = orders[orderId];
    const slug = facts?.sellerSlug;
    if (!slug) return undefined;
    const held = bySlug.get(slug);
    if (held) return held;
    const fresh: Accumulator = {
      cardNames: new Set(),
      copies: 0,
      handling: [],
      lastTs: null,
      name: facts.seller ?? slug,
      orderIds: new Set(),
      shipping: 0,
      sinceTs: null,
      slug,
      spent: 0,
      ...(facts.sellerUrl ? { url: facts.sellerUrl } : {}),
    };
    bySlug.set(slug, fresh);
    return fresh;
  };

  // Order-level facts first, so a seller with a known order but no readable card
  // rows still appears.
  for (const [orderId, facts] of Object.entries(orders)) {
    const into = accumulatorFor(orderId);
    if (!into) continue;
    into.orderIds.add(orderId);
    into.shipping += shipping[orderId] ?? 0;

    const paid = facts.paidTs;
    if (paid != null) {
      into.sinceTs = into.sinceTs == null ? paid : Math.min(into.sinceTs, paid);
      into.lastTs = into.lastTs == null ? paid : Math.max(into.lastTs, paid);
      if (facts.sentTs != null && facts.sentTs >= paid) {
        into.handling.push((facts.sentTs - paid) / DAY_MS);
      }
    }
  }

  for (const [key, card] of Object.entries(history.cards ?? {})) {
    for (const line of card.purchases ?? []) {
      const into = accumulatorFor(line.orderId);
      if (!into) continue;
      const qty = line.qty ?? 1;
      into.copies += qty;
      into.cardNames.add(card.name ?? key);
      if (line.price !== undefined && Number.isFinite(line.price)) {
        into.spent += line.price * qty;
      }
    }
  }

  return [...bySlug.values()]
    .map(a => ({
      cards: a.cardNames.size,
      copies: a.copies,
      handlingDays: median(a.handling),
      handlingSamples: a.handling.length,
      lastTs: a.lastTs,
      name: a.name,
      orders: a.orderIds.size,
      shipping: Math.round(a.shipping * 100) / 100,
      sinceTs: a.sinceTs,
      slug: a.slug,
      spent: Math.round(a.spent * 100) / 100,
      ...(a.url ? { url: a.url } : {}),
    }))
    .sort((x, y) => y.orders - x.orders || y.spent - x.spent || x.name.localeCompare(y.name));
};

/** Orders whose seller is still unknown — i.e. what a re-sync would recover. */
export const ordersWithoutSeller = (history: PurchaseHistory): number => {
  const orders = history.orders ?? {};
  const seen = new Set<string>();
  for (const card of Object.values(history.cards ?? {})) {
    for (const line of card.purchases ?? []) seen.add(line.orderId);
  }
  for (const id of Object.keys(orders)) seen.add(id);
  let missing = 0;
  for (const id of seen) if (!orders[id]?.sellerSlug) missing += 1;
  return missing;
};

/** Average postage per copy — what a seller's shipping really costs you. */
export const shippingPerCopy = (stats: SellerStats): number | null =>
  stats.copies > 0 && stats.shipping > 0
    ? Math.round((stats.shipping / stats.copies) * 100) / 100
    : null;

/** Days since the last order, for spotting a seller you have drifted away from. */
export const daysSince = (ts: number | null, now = Date.now()): number | null =>
  ts == null ? null : Math.max(0, Math.floor((now - ts) / DAY_MS));
