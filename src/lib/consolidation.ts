// Plan-aware consolidation — transparent one-want moves.
//
// Shipping from the source seller may disappear ONLY when that seller has no
// remaining assigned purchases after the move. Tier changes on source /
// destination use before/after estimates — never a fixed “save one letter”
// heuristic. No combinatorial optimizer here.

import type { PlanSeller, PurchasePlan } from '@/lib/purchasePlan';

export type ConsolidationConfidence = 'TRUSTED' | 'STALE' | 'INCOMPLETE';

export interface ConsolidationMoveResult {
  wantKey: string;
  fromSellerId: string;
  toSellerId: string;
  quantityMoved: number;

  goodsBefore: number;
  goodsAfter: number;
  goodsDelta: number;

  sourceShippingBefore: number;
  sourceShippingAfter: number;
  destinationShippingBefore: number;
  destinationShippingAfter: number;
  shippingDelta: number;

  sourceSellerRemoved: boolean;

  deliveredBefore: number;
  deliveredAfter: number;
  netDelta: number;

  confidence: ConsolidationConfidence;
  explanation: string[];
}

export interface ConsolidationMove {
  wantKey: string;
  fromSellerId: string;
  toSellerId: string;
  goodsDelta: number;
  fromSellerRemoved: boolean;
  shippingDelta: number;
  netDelta: number;
}

export interface PlanSellerSlice {
  sellerId: string;
  wantKeys: readonly string[];
  shippingTotal: number;
}

/**
 * Legacy simple evaluator (Phase A). Prefer {@link evaluateOneWantMove} when
 * before/after shipping estimates are available.
 */
export const evaluateConsolidationMove = (args: {
  wantKey: string;
  from: PlanSellerSlice;
  to: PlanSellerSlice;
  goodsDelta: number;
}): ConsolidationMove => {
  const remaining = args.from.wantKeys.filter(k => k !== args.wantKey);
  const fromSellerRemoved = remaining.length === 0 && args.from.wantKeys.includes(args.wantKey);
  const shippingDelta = fromSellerRemoved ? -args.from.shippingTotal : 0;
  return {
    wantKey: args.wantKey,
    fromSellerId: args.from.sellerId,
    toSellerId: args.to.sellerId,
    goodsDelta: args.goodsDelta,
    fromSellerRemoved,
    shippingDelta,
    netDelta: args.goodsDelta + shippingDelta,
  };
};

export type ShipEstimateFn = (
  sellerId: string,
  cardCount: number,
  goodsTotal: number,
) => number | undefined;

const sellerShip = (s: PlanSeller | undefined): number => s?.shippingEstimate?.price ?? 0;

const cloneSellerWithoutQty = (
  seller: PlanSeller,
  wantKey: string,
  qty: number,
): PlanSeller | null => {
  const assignment = seller.assignments.find(a => a.wantKey === wantKey);
  if (!assignment || assignment.quantity < qty) return null;
  const leftQty = assignment.quantity - qty;
  const assignments =
    leftQty <= 0
      ? seller.assignments.filter(a => a.wantKey !== wantKey)
      : seller.assignments.map(a =>
          a.wantKey !== wantKey
            ? a
            : {
                ...a,
                quantity: leftQty,
                // Approximate goods: proportional unit average.
                goodsTotal: (a.goodsTotal / a.quantity) * leftQty,
                articleIds: a.articleIds.slice(0, leftQty),
                unitPrices: a.unitPrices.slice(0, leftQty),
              },
        );
  if (assignments.length === 0) return null;
  const goodsTotal = assignments.reduce((s, a) => s + a.goodsTotal, 0);
  const cardCount = assignments.reduce((s, a) => s + a.quantity, 0);
  return {
    ...seller,
    assignments,
    goodsTotal,
    cardCount,
    shippingEstimate: seller.shippingEstimate
      ? { ...seller.shippingEstimate }
      : undefined,
    deliveredTotal: goodsTotal + sellerShip(seller),
  };
};

const addQtyToSeller = (
  seller: PlanSeller,
  wantKey: string,
  name: string,
  qty: number,
  unitPrice: number,
  articleIds: string[],
): PlanSeller => {
  const existing = seller.assignments.find(a => a.wantKey === wantKey);
  const assignments = existing
    ? seller.assignments.map(a =>
        a.wantKey !== wantKey
          ? a
          : {
              ...a,
              quantity: a.quantity + qty,
              goodsTotal: a.goodsTotal + unitPrice * qty,
              articleIds: [...a.articleIds, ...articleIds],
              unitPrices: [...a.unitPrices, ...Array.from({ length: qty }, () => unitPrice)],
            },
      )
    : [
        ...seller.assignments,
        {
          wantKey,
          name,
          quantity: qty,
          goodsTotal: unitPrice * qty,
          articleIds,
          unitPrices: Array.from({ length: qty }, () => unitPrice),
        },
      ];
  const goodsTotal = assignments.reduce((s, a) => s + a.goodsTotal, 0);
  const cardCount = assignments.reduce((s, a) => s + a.quantity, 0);
  return {
    ...seller,
    assignments,
    goodsTotal,
    cardCount,
    deliveredTotal: goodsTotal + sellerShip(seller),
  };
};

/**
 * Evaluate moving `quantity` copies of `wantKey` from source → destination,
 * recomputing shipping with {@link estimateShip} for BEFORE and AFTER states.
 */
export const evaluateOneWantMove = (args: {
  plan: PurchasePlan;
  wantKey: string;
  fromSellerId: string;
  toSellerId: string;
  /** How many copies to move (defaults to all assigned on source). */
  quantity?: number;
  /** Unit price at the destination for the moved copies. */
  toUnitPrice: number;
  toArticleIds?: string[];
  estimateShip: ShipEstimateFn;
  confidence?: ConsolidationConfidence;
}): ConsolidationMoveResult | undefined => {
  const from = args.plan.sellers.find(s => s.sellerId === args.fromSellerId);
  const to = args.plan.sellers.find(s => s.sellerId === args.toSellerId);
  if (!from || !to) return undefined;
  const assignment = from.assignments.find(a => a.wantKey === args.wantKey);
  if (!assignment) return undefined;

  const quantityMoved = Math.min(
    args.quantity ?? assignment.quantity,
    assignment.quantity,
  );
  if (quantityMoved <= 0) return undefined;

  const fromUnit =
    assignment.quantity > 0 ? assignment.goodsTotal / assignment.quantity : 0;
  const goodsBefore = args.plan.totalGoods;
  const goodsDelta = (args.toUnitPrice - fromUnit) * quantityMoved;
  const goodsAfter = goodsBefore + goodsDelta;

  const sourceShippingBefore = sellerShip(from);
  const destinationShippingBefore = sellerShip(to);

  const fromAfter = cloneSellerWithoutQty(from, args.wantKey, quantityMoved);
  const sourceSellerRemoved = fromAfter == null;
  const sourceShippingAfter = sourceSellerRemoved
    ? 0
    : (args.estimateShip(from.sellerId, fromAfter.cardCount, fromAfter.goodsTotal) ??
      sourceShippingBefore);

  const toAfter = addQtyToSeller(
    to,
    args.wantKey,
    assignment.name,
    quantityMoved,
    args.toUnitPrice,
    args.toArticleIds ?? [],
  );
  const destinationShippingAfter =
    args.estimateShip(to.sellerId, toAfter.cardCount, toAfter.goodsTotal) ??
    destinationShippingBefore;

  const shippingDelta =
    sourceShippingAfter -
    sourceShippingBefore +
    (destinationShippingAfter - destinationShippingBefore);

  const deliveredBefore = args.plan.totalDelivered;
  const deliveredAfter = deliveredBefore + goodsDelta + shippingDelta;
  const netDelta = goodsDelta + shippingDelta;

  const confidence = args.confidence ?? args.plan.planTrust;
  const explanation: string[] = [];
  explanation.push(
    `Buy ${quantityMoved}× ${assignment.name} from seller ${to.sellerName ?? to.sellerId} instead`,
  );
  explanation.push(
    `Card price: ${goodsDelta >= 0 ? '+' : ''}${goodsDelta.toFixed(2)} €`,
  );
  if (sourceSellerRemoved) {
    explanation.push(
      `Seller ${from.sellerName ?? from.sellerId} removed: ${(-sourceShippingBefore).toFixed(2)} € shipping`,
    );
  } else if (sourceShippingAfter !== sourceShippingBefore) {
    explanation.push(
      `Seller ${from.sellerName ?? from.sellerId} shipping: ${sourceShippingBefore.toFixed(2)} → ${sourceShippingAfter.toFixed(2)} €`,
    );
  } else {
    explanation.push(
      `Seller ${from.sellerName ?? from.sellerId} still required — no full shipping removal`,
    );
  }
  if (destinationShippingAfter !== destinationShippingBefore) {
    explanation.push(
      `Seller ${to.sellerName ?? to.sellerId} shipping: ${destinationShippingBefore.toFixed(2)} → ${destinationShippingAfter.toFixed(2)} €`,
    );
  } else {
    explanation.push(`Seller ${to.sellerName ?? to.sellerId} shipping: no change`);
  }
  explanation.push(
    `Estimated ${netDelta <= 0 ? 'saving' : 'cost'}: ${Math.abs(netDelta).toFixed(2)} €`,
  );

  return {
    wantKey: args.wantKey,
    fromSellerId: from.sellerId,
    toSellerId: to.sellerId,
    quantityMoved,
    goodsBefore,
    goodsAfter,
    goodsDelta,
    sourceShippingBefore,
    sourceShippingAfter,
    destinationShippingBefore,
    destinationShippingAfter,
    shippingDelta,
    sourceSellerRemoved,
    deliveredBefore,
    deliveredAfter,
    netDelta,
    confidence,
    explanation,
  };
};

/**
 * Scan one-want moves from every other plan seller into `toSellerId` where the
 * destination already has a priced unit for that want. Returns only moves with
 * netDelta < 0 and TRUSTED/STALE confidence (not INCOMPLETE).
 */
export const findBeneficialOneWantMoves = (args: {
  plan: PurchasePlan;
  toSellerId: string;
  /** wantKey → unit price / article ids available on the destination. */
  toOffers: ReadonlyMap<string, { unitPrice: number; articleIds: string[]; maxQty: number }>;
  estimateShip: ShipEstimateFn;
}): ConsolidationMoveResult[] => {
  if (args.plan.planTrust === 'INCOMPLETE') return [];
  const out: ConsolidationMoveResult[] = [];
  for (const from of args.plan.sellers) {
    if (from.sellerId === args.toSellerId) continue;
    for (const a of from.assignments) {
      const offer = args.toOffers.get(a.wantKey);
      if (!offer || offer.maxQty <= 0) continue;
      const qty = Math.min(a.quantity, offer.maxQty);
      const move = evaluateOneWantMove({
        plan: args.plan,
        wantKey: a.wantKey,
        fromSellerId: from.sellerId,
        toSellerId: args.toSellerId,
        quantity: qty,
        toUnitPrice: offer.unitPrice,
        toArticleIds: offer.articleIds.slice(0, qty),
        estimateShip: args.estimateShip,
        confidence: args.plan.planTrust,
      });
      if (move && move.netDelta < -0.001) out.push(move);
    }
  }
  return out.sort((a, b) => a.netDelta - b.netDelta);
};

/**
 * Scan every destination seller that has offer data. Keeps the best move per
 * (wantKey, fromSellerId) — prefer seller-removal, then lowest netDelta.
 */
export const findAllBeneficialOneWantMoves = (args: {
  plan: PurchasePlan;
  /** sellerId → wantKey → offer available on that seller. */
  offersBySeller: ReadonlyMap<
    string,
    ReadonlyMap<string, { unitPrice: number; articleIds: string[]; maxQty: number }>
  >;
  estimateShip: ShipEstimateFn;
}): ConsolidationMoveResult[] => {
  if (args.plan.planTrust === 'INCOMPLETE') return [];
  const best = new Map<string, ConsolidationMoveResult>();
  for (const [toSellerId, toOffers] of args.offersBySeller) {
    if (!args.plan.sellers.some(s => s.sellerId === toSellerId)) continue;
    const moves = findBeneficialOneWantMoves({
      plan: args.plan,
      toSellerId,
      toOffers,
      estimateShip: args.estimateShip,
    });
    for (const m of moves) {
      const key = `${m.wantKey}|${m.fromSellerId}`;
      const prev = best.get(key);
      if (!prev) {
        best.set(key, m);
        continue;
      }
      const prevScore = (prev.sourceSellerRemoved ? 1_000_000 : 0) - prev.netDelta;
      const nextScore = (m.sourceSellerRemoved ? 1_000_000 : 0) - m.netDelta;
      if (nextScore > prevScore) best.set(key, m);
    }
  }
  return [...best.values()].sort((a, b) => {
    if (a.sourceSellerRemoved !== b.sourceSellerRemoved) {
      return a.sourceSellerRemoved ? -1 : 1;
    }
    return a.netDelta - b.netDelta;
  });
};

/**
 * Build destination offer maps from priced/parsed seller stock lines.
 * Cheapest unit wins per wantKey; article ids expand by chosen qty capacity.
 */
export const offersMapFromLines = (
  lines: readonly {
    wantKey: string;
    unitPrice: number;
    articleId?: string;
    quantity: number;
  }[],
): Map<string, { unitPrice: number; articleIds: string[]; maxQty: number }> => {
  const byKey = new Map<string, { unitPrice: number; articleIds: string[]; maxQty: number }>();
  const sorted = [...lines]
    .filter(l => l.wantKey && Number.isFinite(l.unitPrice) && l.unitPrice > 0 && l.quantity > 0)
    .sort((a, b) => a.unitPrice - b.unitPrice);
  for (const l of sorted) {
    const prev = byKey.get(l.wantKey);
    if (prev) {
      // Append cheaper-first stock already sorted; raise maxQty.
      const ids = l.articleId
        ? [...prev.articleIds, ...Array.from({ length: l.quantity }, () => l.articleId!)]
        : prev.articleIds;
      byKey.set(l.wantKey, {
        unitPrice: prev.unitPrice, // keep cheapest unit for goods delta
        articleIds: ids,
        maxQty: prev.maxQty + l.quantity,
      });
      continue;
    }
    byKey.set(l.wantKey, {
      unitPrice: l.unitPrice,
      articleIds: l.articleId
        ? Array.from({ length: l.quantity }, () => l.articleId!)
        : [],
      maxQty: l.quantity,
    });
  }
  return byKey;
};

export const summarizeMoves = (
  moves: readonly ConsolidationMoveResult[],
): { count: number; estSave: number; sellersRemovable: number } => {
  const sellers = new Set(moves.filter(m => m.sourceSellerRemoved).map(m => m.fromSellerId));
  return {
    count: moves.length,
    estSave: moves.reduce((s, m) => s + Math.max(0, -m.netDelta), 0),
    sellersRemovable: sellers.size,
  };
};
