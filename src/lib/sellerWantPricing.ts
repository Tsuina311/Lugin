// Pure seller ↔ want-list pricing for Best Sellers “Price it”.
//
// Cardmarket’s `?idWantslist=` filter already applies language / condition /
// foil / printing constraints server-side. This module does not re-implement
// those rules — it turns the qualifying offer rows into matched / partial /
// missing lines with quantities and article ids for cart adds.
//
// Future consolidation (seller removal → shipping delta) lives elsewhere; see
// `src/lib/consolidation.ts`. Never treat “price premium < ship estimate” as
// savings without proving a seller can be removed from the plan.

import { cardKey, stripVersion } from '@/lib/cardName';
import {
  knownCheapestDelta,
  type KnownPriceEntry,
} from '@/lib/knownPriceMap';

/** One want the buyer still needs from a list. */
export interface WantRequirement {
  /** Normalized card key (stripVersion(cardKey(name))). */
  wantKey: string;
  name: string;
  /**
   * Wanted copies. Authoritative only when `quantityStatus === 'KNOWN'`.
   * When UNKNOWN, callers must not pretend Cardmarket confirmed this number.
   */
  quantity: number;
  quantityStatus: 'KNOWN' | 'UNKNOWN';
}

/** One Cardmarket article that may fill a want. */
export interface SellerOfferLine {
  articleId?: string;
  name: string;
  price: number;
  quantity: number;
  condition?: string;
  language?: string;
  foil?: boolean;
  printing?: string;
  productId?: string;
  /** Product art URL when the offer row carried one. */
  imageUrl?: string;
}

export interface SelectedOfferSlice {
  articleId?: string;
  condition?: string;
  language?: string;
  foil?: boolean;
  printing?: string;
  /** Copies taken from this article toward the want. */
  quantity: number;
  unitPrice: number;
}

export type MatchStatus = 'matched' | 'partial' | 'missing';

export interface SellerWantLine {
  wantKey: string;
  cardName: string;
  status: MatchStatus;
  wantedQty: number;
  quantityStatus: 'KNOWN' | 'UNKNOWN';
  availableQty: number;
  chosenQty: number;
  selectedOffers: SelectedOfferSlice[];
  /** Average unit price across selected slices (chosenQty-weighted). */
  unitPrice: number;
  goodsTotal: number;
  condition?: string;
  language?: string;
  foil?: boolean;
  printing?: string;
  articleIds: string[];
  /** Optional — fill only when a trustworthy comparison exists. */
  knownCheapestUnitPrice?: number;
  knownCheapestSellerId?: string;
  knownCheapestSource?: string;
  priceDeltaVsKnownCheapest?: number;
  knownCheapestFreshness?: 'TRUSTED' | 'STALE';
}

export interface ShippingTierContext {
  estimatedPrice: number;
  methodName: string;
  weight: number;
  /** Rough max cards for the chosen method’s weight tier. */
  tierMaxCards?: number;
  /** Next cheaper-capacity tier’s max cards, if any. */
  nextTierMaxCards?: number;
  /** Estimated grams still free in the current weight bracket. */
  remainingWeightInTier?: number;
  isEstimate: true;
}

export interface SellerWantPricingResult {
  sellerId: string;
  sellerName: string;
  wantListId: string;
  matched: SellerWantLine[];
  partial: SellerWantLine[];
  missing: SellerWantLine[];
  /** Card-line coverage (matched + partial), same spirit as CM’s count. */
  lineCoverage: number;
  /** Copies fulfilled / copies wanted. */
  quantityFulfilled: number;
  quantityWanted: number;
  goodsTotal: number;
  shipping?: ShippingTierContext;
  estimatedDeliveredTotal?: number;
  fetchedAt: number;
  /** Flat article ids for selected copies (one entry per copy when qty > 1). */
  selectedArticleIds: string[];
}

/** Future scaffold — not used by Phase A UI. */
export interface BasketPlanAssignment {
  wantKey: string;
  articleId?: string;
  quantity: number;
  unitPrice: number;
}

export interface BasketPlanSeller {
  sellerId: string;
  assignments: BasketPlanAssignment[];
  goodsTotal: number;
  shippingTotal: number;
}

export interface BasketPlan {
  sellers: BasketPlanSeller[];
  totalGoods: number;
  totalShipping: number;
  totalDelivered: number;
}

export const wantKeyOf = (name: string): string => stripVersion(cardKey(name));

/**
 * Greedy cheapest fill: sort offers by unit price, take from each until the
 * want quantity is met (or stock runs out).
 */
export const selectOffersForQuantity = (
  offers: readonly SellerOfferLine[],
  wantedQty: number,
): { slices: SelectedOfferSlice[]; availableQty: number; chosenQty: number } => {
  const wanted = Math.max(0, Math.floor(wantedQty));
  const sorted = [...offers]
    .filter(o => Number.isFinite(o.price) && o.quantity > 0)
    .sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));

  const availableQty = sorted.reduce((s, o) => s + o.quantity, 0);
  const slices: SelectedOfferSlice[] = [];
  let need = wanted;
  for (const o of sorted) {
    if (need <= 0) break;
    const take = Math.min(need, o.quantity);
    if (take <= 0) continue;
    slices.push({
      articleId: o.articleId,
      condition: o.condition,
      language: o.language,
      foil: o.foil,
      printing: o.printing,
      quantity: take,
      unitPrice: o.price,
    });
    need -= take;
  }
  const chosenQty = wanted - need;
  return { slices, availableQty, chosenQty };
};

const lineFrom = (
  want: WantRequirement,
  slices: SelectedOfferSlice[],
  availableQty: number,
  chosenQty: number,
): SellerWantLine => {
  const goodsTotal = slices.reduce((s, x) => s + x.unitPrice * x.quantity, 0);
  const unitPrice = chosenQty > 0 ? goodsTotal / chosenQty : 0;
  const lead = slices[0];
  const status: MatchStatus =
    chosenQty <= 0 ? 'missing' : chosenQty >= want.quantity ? 'matched' : 'partial';
  return {
    wantKey: want.wantKey,
    cardName: want.name,
    status,
    wantedQty: want.quantity,
    quantityStatus: want.quantityStatus,
    availableQty,
    chosenQty,
    selectedOffers: slices,
    unitPrice,
    goodsTotal,
    condition: lead?.condition,
    language: lead?.language,
    foil: lead?.foil,
    printing: lead?.printing,
    articleIds: slices
      .flatMap(s => (s.articleId ? Array.from({ length: s.quantity }, () => s.articleId!) : []))
      .filter(Boolean),
  };
};

/**
 * Price one seller against a want list using already-fetched qualifying offers.
 * Offers are assumed to already satisfy Cardmarket’s want-list filter.
 */
export const priceSellerOffers = (args: {
  sellerId: string;
  sellerName: string;
  wantListId: string;
  wants: readonly WantRequirement[];
  offers: readonly SellerOfferLine[];
  fetchedAt?: number;
  shipping?: ShippingTierContext;
}): SellerWantPricingResult => {
  const byKey = new Map<string, SellerOfferLine[]>();
  for (const o of args.offers) {
    const key = wantKeyOf(o.name);
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push(o);
    byKey.set(key, list);
  }

  const matched: SellerWantLine[] = [];
  const partial: SellerWantLine[] = [];
  const missing: SellerWantLine[] = [];

  for (const want of args.wants) {
    const pool = byKey.get(want.wantKey) ?? [];
    const { slices, availableQty, chosenQty } = selectOffersForQuantity(pool, want.quantity);
    const line = lineFrom(want, slices, availableQty, chosenQty);
    if (line.status === 'matched') matched.push(line);
    else if (line.status === 'partial') partial.push(line);
    else missing.push(line);
  }

  const goodsTotal = [...matched, ...partial].reduce((s, l) => s + l.goodsTotal, 0);
  const quantityWanted = args.wants.reduce((s, w) => s + w.quantity, 0);
  const quantityFulfilled = [...matched, ...partial].reduce((s, l) => s + l.chosenQty, 0);
  const selectedArticleIds = [...matched, ...partial].flatMap(l => l.articleIds);
  const shipping = args.shipping;
  const estimatedDeliveredTotal =
    shipping != null ? goodsTotal + shipping.estimatedPrice : undefined;

  return {
    sellerId: args.sellerId,
    sellerName: args.sellerName,
    wantListId: args.wantListId,
    matched,
    partial,
    missing,
    lineCoverage: matched.length + partial.length,
    quantityFulfilled,
    quantityWanted,
    goodsTotal,
    shipping,
    estimatedDeliveredTotal,
    fetchedAt: args.fetchedAt ?? Date.now(),
    selectedArticleIds,
  };
};

/** Goods total for currently selected lines (by wantKey). */
export const goodsTotalForSelection = (
  result: SellerWantPricingResult,
  selectedKeys: ReadonlySet<string>,
): { goods: number; articleIds: string[]; copyCount: number } => {
  const lines = [...result.matched, ...result.partial].filter(l => selectedKeys.has(l.wantKey));
  return {
    goods: lines.reduce((s, l) => s + l.goodsTotal, 0),
    articleIds: lines.flatMap(l => l.articleIds),
    copyCount: lines.reduce((s, l) => s + l.chosenQty, 0),
  };
};

/** Stable fingerprint of the want list for cache keys (includes quantities). */
export const wantListFingerprint = (wants: readonly WantRequirement[]): string =>
  wants
    .map(w => `${w.wantKey}:${w.quantityStatus === 'KNOWN' ? w.quantity : '?'}`)
    .sort()
    .join('|');

/** Attach known-cheapest deltas when a trustworthy comparison exists (no fetches). */
export const annotateWithKnownCheapest = (
  result: SellerWantPricingResult,
  map: Record<string, KnownPriceEntry>,
  now = Date.now(),
): SellerWantPricingResult => {
  const annotate = (line: SellerWantLine): SellerWantLine => {
    if (line.chosenQty <= 0 || line.unitPrice <= 0) return line;
    const delta = knownCheapestDelta(
      map,
      { wantKey: line.wantKey, wantListId: result.wantListId },
      line.unitPrice,
      result.sellerId,
      { now, allowStale: true },
    );
    if (!delta) return line;
    return {
      ...line,
      knownCheapestUnitPrice: delta.knownCheapest.unitPrice,
      knownCheapestSellerId: delta.knownCheapest.sellerId,
      knownCheapestSource: delta.knownCheapest.source,
      priceDeltaVsKnownCheapest: delta.delta,
      knownCheapestFreshness: delta.knownCheapest.freshness === 'STALE' ? 'STALE' : 'TRUSTED',
    };
  };
  return {
    ...result,
    matched: result.matched.map(annotate),
    partial: result.partial.map(annotate),
  };
};
