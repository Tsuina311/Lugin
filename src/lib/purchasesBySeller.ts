// Purchase history grouped by seller — one row per order, with dates.
//
// `sellerStats` answers "who do I buy from most". This answers "when did I buy
// from them", which is what you need when picking a favourite shop.

import { cardKey, stripVersion } from './cardName';
import {
  sellerStats,
  type PurchaseHistory,
  type SellerStats,
} from './sellerStats';

export interface SellerOrderRow {
  /** Distinct cards on this order. */
  lines: number;
  orderId: string;
  paidTs?: number;
  /** Postage paid on this order, when captured. */
  shipping?: number;
  sentTs?: number;
  spent: number;
  state?: string;
  copies: number;
}

/** One distinct card bought from a seller (any printing folds to one row). */
export interface SellerCardRow {
  copies: number;
  /** Normalized card key in the purchase index. */
  key: string;
  lastPaidTs?: number;
  name: string;
  spent: number;
}

export interface SellerPurchaseGroup extends SellerStats {
  /** Distinct cards bought from this seller, A→Z. */
  cardRows: SellerCardRow[];
  /** Every order from this seller, newest paid date first. */
  orderRows: SellerOrderRow[];
}

/** True when a card's display name matches a free-text query. */
export const cardNameMatchesQuery = (name: string, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const normalized = stripVersion(name).toLowerCase();
  return normalized.includes(q) || cardKey(name).includes(cardKey(q));
};

/** Seller name/slug or any card they sold you. */
export const sellerMatchesQuery = (group: SellerPurchaseGroup, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (group.name.toLowerCase().includes(q) || group.slug.toLowerCase().includes(q)) return true;
  return group.cardRows.some(c => cardNameMatchesQuery(c.name, q));
};

/** Card identity keys bought from one seller — for filtering their live stock. */
export const cardKeysFromSeller = (history: PurchaseHistory, slug: string): Set<string> => {
  const orders = history.orders ?? {};
  const keys = new Set<string>();
  for (const [key, card] of Object.entries(history.cards ?? {})) {
    for (const line of card.purchases ?? []) {
      if (orders[line.orderId]?.sellerSlug === slug) keys.add(stripVersion(key));
    }
  }
  return keys;
};

/**
 * Roll synced purchase history up per seller, keeping each order as its own line.
 */
export const groupPurchasesBySeller = (history: PurchaseHistory): SellerPurchaseGroup[] => {
  const orders = history.orders ?? {};
  const shipping = history.shipping ?? {};

  const perOrder = new Map<string, { copies: number; lines: Set<string>; spent: number }>();
  const cardsBySlug = new Map<string, Map<string, SellerCardRow>>();

  for (const [key, card] of Object.entries(history.cards ?? {})) {
    for (const line of card.purchases ?? []) {
      const facts = orders[line.orderId];
      const slug = facts?.sellerSlug;
      const qty = line.qty ?? 1;
      const unit = line.price ?? 0;
      const lineSpent = Number.isFinite(unit) ? unit * qty : 0;

      const into = perOrder.get(line.orderId) ?? { copies: 0, lines: new Set<string>(), spent: 0 };
      into.lines.add(key);
      into.copies += qty;
      into.spent += lineSpent;
      perOrder.set(line.orderId, into);

      if (!slug) continue;
      const byKey = cardsBySlug.get(slug) ?? new Map<string, SellerCardRow>();
      const norm = stripVersion(key);
      const ts = 'ts' in line && typeof line.ts === 'number' ? line.ts : facts?.paidTs;
      const existing = byKey.get(norm);
      if (existing) {
        existing.copies += qty;
        existing.spent = Math.round((existing.spent + lineSpent) * 100) / 100;
        if (ts != null && (existing.lastPaidTs ?? 0) < ts) existing.lastPaidTs = ts;
      } else {
        byKey.set(norm, {
          copies: qty,
          key: norm,
          lastPaidTs: ts,
          name: card.name ?? key,
          spent: Math.round(lineSpent * 100) / 100,
        });
      }
      cardsBySlug.set(slug, byKey);
    }
  }

  const bySlug = new Map<string, SellerOrderRow[]>();
  for (const [orderId, facts] of Object.entries(orders)) {
    const slug = facts.sellerSlug;
    if (!slug) continue;
    const agg = perOrder.get(orderId);
    const row: SellerOrderRow = {
      copies: agg?.copies ?? 0,
      lines: agg?.lines.size ?? 0,
      orderId,
      paidTs: facts.paidTs,
      sentTs: facts.sentTs,
      spent: Math.round((agg?.spent ?? 0) * 100) / 100,
      state: facts.state,
      ...(shipping[orderId] !== undefined ? { shipping: shipping[orderId] } : {}),
    };
    const list = bySlug.get(slug) ?? [];
    list.push(row);
    bySlug.set(slug, list);
  }

  return sellerStats(history).map(stats => ({
    ...stats,
    cardRows: [...(cardsBySlug.get(stats.slug)?.values() ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name),
    ),
    orderRows: (bySlug.get(stats.slug) ?? []).sort(
      (a, b) => (b.paidTs ?? 0) - (a.paidTs ?? 0) || b.orderId.localeCompare(a.orderId),
    ),
  }));
};
