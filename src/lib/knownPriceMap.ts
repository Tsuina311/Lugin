// Trusted known-cheapest map — prices Lugin has already observed locally.
//
// This is NOT “cheapest on Cardmarket”. Only comparable, fresh observations
// contribute. No extra fetches just to populate deltas.

export type KnownOfferSource =
  | 'PRICE_IT'
  | 'PRODUCT_PAGE'
  | 'CART'
  | 'SELLER_BROWSE'
  | 'OTHER_TRUSTED';

export type PriceTrust = 'TRUSTED' | 'STALE' | 'INCOMPLETE';

/** Constraints that must match before two offers are compared. */
export interface WantComparability {
  wantKey: string;
  /** Same want-list filter ⇒ Cardmarket already applied language/condition/foil. */
  wantListId?: string;
  language?: string;
  condition?: string;
  foil?: boolean;
  /** Exact printing / expansion name when the want constrains printing. */
  printing?: string;
}

export interface KnownOfferObservation {
  wantKey: string;
  wantListId?: string;
  sellerId: string;
  sellerName?: string;
  articleId?: string;
  unitPrice: number;
  quantity: number;
  language?: string;
  condition?: string;
  foil?: boolean;
  printing?: string;
  observedAt: number;
  source: KnownOfferSource;
}

export interface KnownCheapestSlice {
  sellerId: string;
  sellerName?: string;
  articleId?: string;
  unitPrice: number;
  observedAt: number;
  source: KnownOfferSource;
  freshness: PriceTrust;
}

export interface KnownPriceEntry {
  wantKey: string;
  observations: KnownOfferObservation[];
  cheapestQualifying?: KnownCheapestSlice;
  updatedAt: number;
}

/** Fresh enough to show as current truth. */
export const KNOWN_PRICE_TRUSTED_MS = 48 * 60 * 60 * 1000;
/** Stale but still visible (labeled). Older than this → hidden. */
export const KNOWN_PRICE_HIDE_MS = 7 * 24 * 60 * 60 * 1000;
/** Cap retained observations per want key. */
export const KNOWN_PRICE_MAX_PER_WANT = 12;
/** Global cap across the map. */
export const KNOWN_PRICE_MAX_TOTAL = 800;

export const freshnessOf = (observedAt: number, now = Date.now()): PriceTrust => {
  const age = now - observedAt;
  if (age < 0) return 'TRUSTED';
  if (age <= KNOWN_PRICE_TRUSTED_MS) return 'TRUSTED';
  if (age <= KNOWN_PRICE_HIDE_MS) return 'STALE';
  return 'INCOMPLETE';
};

/**
 * Same-want comparability. Prefer wantListId match (CM filter). Otherwise
 * require foil / language / printing agreement when both sides specify them.
 */
export const observationsAreComparable = (
  obs: KnownOfferObservation,
  need: WantComparability,
): boolean => {
  if (obs.wantKey !== need.wantKey) return false;
  if (need.wantListId && obs.wantListId && need.wantListId === obs.wantListId) {
    // Same list filter — attributes already constrained by Cardmarket.
    return Number.isFinite(obs.unitPrice) && obs.unitPrice > 0;
  }
  if (need.foil != null && obs.foil != null && need.foil !== obs.foil) return false;
  if (need.language && obs.language && need.language !== obs.language) return false;
  if (need.printing && obs.printing && need.printing !== obs.printing) return false;
  // Condition: only exclude when both present and clearly different labels.
  if (need.condition && obs.condition && need.condition !== obs.condition) return false;
  // Without a shared wantListId, require at least one overlapping attribute
  // beyond wantKey so we do not invent cross-constraint deltas.
  if (!need.wantListId || !obs.wantListId) {
    const overlap =
      (need.foil != null && obs.foil != null) ||
      (!!need.language && !!obs.language) ||
      (!!need.printing && !!obs.printing) ||
      (!!need.condition && !!obs.condition);
    if (!overlap) return false;
  }
  return Number.isFinite(obs.unitPrice) && obs.unitPrice > 0;
};

export const emptyKnownPriceMap = (): Record<string, KnownPriceEntry> => ({});

const pruneObservations = (
  list: KnownOfferObservation[],
  now: number,
): KnownOfferObservation[] => {
  const kept = list
    .filter(o => freshnessOf(o.observedAt, now) !== 'INCOMPLETE')
    .sort((a, b) => b.observedAt - a.observedAt || a.unitPrice - b.unitPrice);
  // Prefer diversity of sellers; keep cheapest recent per seller first.
  const bySeller = new Map<string, KnownOfferObservation>();
  for (const o of kept) {
    const prev = bySeller.get(o.sellerId);
    if (!prev || o.unitPrice < prev.unitPrice || o.observedAt > prev.observedAt) {
      bySeller.set(o.sellerId, o);
    }
  }
  return [...bySeller.values()]
    .sort((a, b) => a.unitPrice - b.unitPrice || b.observedAt - a.observedAt)
    .slice(0, KNOWN_PRICE_MAX_PER_WANT);
};

export const upsertObservation = (
  map: Record<string, KnownPriceEntry>,
  obs: KnownOfferObservation,
  now = Date.now(),
): Record<string, KnownPriceEntry> => {
  if (!obs.wantKey || !Number.isFinite(obs.unitPrice) || obs.unitPrice <= 0) return map;
  const prev = map[obs.wantKey];
  const observations = pruneObservations([...(prev?.observations ?? []), obs], now);
  const next: Record<string, KnownPriceEntry> = {
    ...map,
    [obs.wantKey]: {
      wantKey: obs.wantKey,
      observations,
      updatedAt: now,
      cheapestQualifying: undefined,
    },
  };
  // Bound total entries by dropping oldest want keys.
  const keys = Object.keys(next);
  if (keys.length > KNOWN_PRICE_MAX_TOTAL) {
    const ranked = keys
      .map(k => ({ k, at: next[k].updatedAt }))
      .sort((a, b) => a.at - b.at);
    for (let i = 0; i < ranked.length - KNOWN_PRICE_MAX_TOTAL; i++) {
      delete next[ranked[i].k];
    }
  }
  return next;
};

export const recordObservations = (
  map: Record<string, KnownPriceEntry>,
  observations: readonly KnownOfferObservation[],
  now = Date.now(),
): Record<string, KnownPriceEntry> => {
  let cur = map;
  for (const o of observations) cur = upsertObservation(cur, o, now);
  return cur;
};

/**
 * Cheapest qualifying observation for a want, excluding a seller if requested
 * (so “this seller vs known cheapest elsewhere” is meaningful).
 */
export const findKnownCheapest = (
  map: Record<string, KnownPriceEntry>,
  need: WantComparability,
  opts: { excludeSellerId?: string; now?: number; allowStale?: boolean } = {},
): KnownCheapestSlice | undefined => {
  const entry = map[need.wantKey];
  if (!entry) return undefined;
  const now = opts.now ?? Date.now();
  let best: KnownOfferObservation | undefined;
  for (const o of entry.observations) {
    if (opts.excludeSellerId && o.sellerId === opts.excludeSellerId) continue;
    if (!observationsAreComparable(o, need)) continue;
    const fresh = freshnessOf(o.observedAt, now);
    if (fresh === 'INCOMPLETE') continue;
    if (fresh === 'STALE' && !opts.allowStale) continue;
    if (!best || o.unitPrice < best.unitPrice) best = o;
  }
  if (!best) return undefined;
  return {
    sellerId: best.sellerId,
    sellerName: best.sellerName,
    articleId: best.articleId,
    unitPrice: best.unitPrice,
    observedAt: best.observedAt,
    source: best.source,
    freshness: freshnessOf(best.observedAt, now),
  };
};

export interface KnownCheapestDelta {
  thisUnitPrice: number;
  knownCheapest: KnownCheapestSlice;
  /** Positive = this seller is more expensive. */
  delta: number;
}

/** Delta vs known cheapest when comparison is trustworthy enough to show. */
export const knownCheapestDelta = (
  map: Record<string, KnownPriceEntry>,
  need: WantComparability,
  thisUnitPrice: number,
  thisSellerId: string,
  opts: { now?: number; allowStale?: boolean } = {},
): KnownCheapestDelta | undefined => {
  if (!Number.isFinite(thisUnitPrice) || thisUnitPrice <= 0) return undefined;
  const known = findKnownCheapest(map, need, {
    excludeSellerId: thisSellerId,
    now: opts.now,
    allowStale: opts.allowStale ?? true,
  });
  if (!known) return undefined;
  // Hide incomplete; allow STALE (caller labels it).
  if (known.freshness === 'INCOMPLETE') return undefined;
  return {
    thisUnitPrice,
    knownCheapest: known,
    delta: thisUnitPrice - known.unitPrice,
  };
};
