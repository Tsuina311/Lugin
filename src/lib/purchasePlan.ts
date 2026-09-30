// Current purchase plan — trustworthy assignments only (cart / explicit picks).
// Pure domain: no DOM / React. Recompute in memory; do not invent assignments
// from “seller has this card”.

import { cardKey, stripVersion } from '@/lib/cardName';

export type PlanTrust = 'TRUSTED' | 'STALE' | 'INCOMPLETE';

export interface PlanAssignment {
  wantKey: string;
  name: string;
  quantity: number;
  articleIds: string[];
  unitPrices: number[];
  goodsTotal: number;
}

export interface PlanSellerShipping {
  price: number;
  weight?: number;
  tierMaxCards?: number;
  nextTierMaxCards?: number;
  remainingWeightInTier?: number;
  methodName?: string;
  isEstimate: boolean;
}

export interface PlanSeller {
  sellerId: string;
  sellerName?: string;
  assignments: PlanAssignment[];
  goodsTotal: number;
  cardCount: number;
  shippingEstimate?: PlanSellerShipping;
  deliveredTotal: number;
}

export interface PurchasePlan {
  sellers: PlanSeller[];
  totalGoods: number;
  totalShipping: number;
  totalDelivered: number;
  unassignedWants: string[];
  /** How complete assignment data is. */
  planTrust: PlanTrust;
  builtAt: number;
  /** Cart / plan fingerprint for invalidation. */
  fingerprint: string;
}

export interface CartPlanLine {
  articleId: string;
  name: string;
  amount: number;
  unitPrice?: number;
  sellerId?: string;
  sellerName?: string;
}

export interface ShippingEstimateInput {
  price: number;
  weight?: number;
  tierMaxCards?: number;
  nextTierMaxCards?: number;
  remainingWeightInTier?: number;
  methodName?: string;
}

export type ShippingEstimator = (
  sellerId: string,
  cardCount: number,
  goodsTotal: number,
) => ShippingEstimateInput | undefined;

const wantKeyOf = (name: string): string => stripVersion(cardKey(name));

const planFingerprint = (lines: readonly CartPlanLine[]): string =>
  lines
    .map(
      l =>
        `${l.sellerId ?? '?'}|${l.articleId}|${l.amount}|${l.unitPrice ?? ''}|${wantKeyOf(l.name)}`,
    )
    .sort()
    .join(';');

/**
 * Build a purchase plan from cart lines that already name a seller.
 * Lines without sellerId are listed under unassigned (by wantKey).
 */
export const buildPurchasePlanFromCart = (
  lines: readonly CartPlanLine[],
  estimateShipping?: ShippingEstimator,
  now = Date.now(),
): PurchasePlan => {
  const bySeller = new Map<string, CartPlanLine[]>();
  const unassignedWants: string[] = [];

  for (const line of lines) {
    if (!line.sellerId) {
      const key = wantKeyOf(line.name);
      if (key) unassignedWants.push(key);
      continue;
    }
    const list = bySeller.get(line.sellerId) ?? [];
    list.push(line);
    bySeller.set(line.sellerId, list);
  }

  const sellers: PlanSeller[] = [];
  for (const [sellerId, sellerLines] of bySeller) {
    // Group by wantKey within seller.
    const byWant = new Map<string, CartPlanLine[]>();
    for (const l of sellerLines) {
      const key = wantKeyOf(l.name) || l.articleId;
      const g = byWant.get(key) ?? [];
      g.push(l);
      byWant.set(key, g);
    }
    const assignments: PlanAssignment[] = [];
    for (const [wantKey, group] of byWant) {
      const quantity = group.reduce((s, g) => s + g.amount, 0);
      const unitPrices = group.flatMap(g =>
        Array.from({ length: g.amount }, () => g.unitPrice ?? 0),
      );
      const goodsTotal = group.reduce((s, g) => s + (g.unitPrice ?? 0) * g.amount, 0);
      assignments.push({
        wantKey,
        name: group[0]?.name ?? wantKey,
        quantity,
        articleIds: group.flatMap(g => Array.from({ length: g.amount }, () => g.articleId)),
        unitPrices,
        goodsTotal,
      });
    }
    const goodsTotal = assignments.reduce((s, a) => s + a.goodsTotal, 0);
    const cardCount = assignments.reduce((s, a) => s + a.quantity, 0);
    const ship = estimateShipping?.(sellerId, cardCount, goodsTotal);
    const shippingEstimate: PlanSellerShipping | undefined = ship
      ? {
          price: ship.price,
          weight: ship.weight,
          tierMaxCards: ship.tierMaxCards,
          nextTierMaxCards: ship.nextTierMaxCards,
          remainingWeightInTier: ship.remainingWeightInTier,
          methodName: ship.methodName,
          isEstimate: true,
        }
      : undefined;
    const shipPrice = shippingEstimate?.price ?? 0;
    sellers.push({
      sellerId,
      sellerName: sellerLines[0]?.sellerName,
      assignments,
      goodsTotal,
      cardCount,
      shippingEstimate,
      deliveredTotal: goodsTotal + shipPrice,
    });
  }

  sellers.sort((a, b) => (a.sellerName ?? a.sellerId).localeCompare(b.sellerName ?? b.sellerId));

  const totalGoods = sellers.reduce((s, x) => s + x.goodsTotal, 0);
  const totalShipping = sellers.reduce((s, x) => s + (x.shippingEstimate?.price ?? 0), 0);
  const hasAnySeller = sellers.length > 0;
  const missingPrices = lines.some(l => l.sellerId && (l.unitPrice == null || !Number.isFinite(l.unitPrice)));
  const planTrust: PlanTrust = !hasAnySeller
    ? 'INCOMPLETE'
    : missingPrices || unassignedWants.length > 0
      ? 'STALE'
      : 'TRUSTED';

  return {
    sellers,
    totalGoods,
    totalShipping,
    totalDelivered: totalGoods + totalShipping,
    unassignedWants,
    planTrust,
    builtAt: now,
    fingerprint: planFingerprint(lines),
  };
};

/** Helper for Fill-this-letter later — remaining capacity on a seller. */
export const fillShipmentHints = (
  seller: PlanSeller,
  candidateWeightGrams: number,
): {
  remainingWeightInTier?: number;
  candidateWeight: number;
  shippingBefore?: number;
  fitsWithoutTierBump: boolean | undefined;
} => {
  const rem = seller.shippingEstimate?.remainingWeightInTier;
  return {
    remainingWeightInTier: rem,
    candidateWeight: candidateWeightGrams,
    shippingBefore: seller.shippingEstimate?.price,
    fitsWithoutTierBump: rem == null ? undefined : candidateWeightGrams <= rem,
  };
};
