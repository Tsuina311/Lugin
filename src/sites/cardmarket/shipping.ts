import { requestApi } from '@/lib/messaging';

// ---------------------------------------------------------------------------
// Cardmarket shipping-cost calculator
// ---------------------------------------------------------------------------
// Cardmarket exposes a public JSON calculator on its help subdomain:
//
//   https://help.cardmarket.com/api/shippingCosts
//       ?locale=en&fromCountry=<id>&toCountry=<id>&preview=false
//
// It returns every shipping method available from one country to another, each
// with a weight tier (grams), an order-value cap (€) and the charged price (€).
// We use it to estimate what a given seller would charge to ship a set of cards
// to the user's own country — data that isn't shown on seller/offers pages.

/**
 * Country name → Cardmarket numeric id, taken from the calculator page's country
 * dropdown. The ids are stable but arbitrary (not alphabetical); if Cardmarket
 * ever adds a country, extend this map.
 */
export const COUNTRY_IDS: Record<string, number> = {
  Austria: 1,
  Belgium: 2,
  Bulgaria: 3,
  Croatia: 35,
  Cyprus: 5,
  'Czech Republic': 6,
  Denmark: 8,
  Estonia: 9,
  Finland: 11,
  France: 12,
  Germany: 7,
  Greece: 14,
  Hungary: 15,
  Iceland: 37,
  Ireland: 16,
  Italy: 17,
  Japan: 36,
  Latvia: 21,
  Liechtenstein: 18,
  Lithuania: 19,
  Luxembourg: 20,
  Malta: 22,
  Netherlands: 23,
  Norway: 24,
  Poland: 25,
  Portugal: 26,
  Romania: 27,
  Singapore: 29,
  Slovakia: 31,
  Slovenia: 30,
  Spain: 10,
  Sweden: 28,
  Switzerland: 4,
  'United Kingdom': 13,
};

/** Sorted [name, id] pairs for populating a country dropdown. */
export const COUNTRIES: { id: number; name: string }[] = Object.entries(COUNTRY_IDS)
  .map(([name, id]) => ({ id, name }))
  .sort((a, b) => a.name.localeCompare(b.name));

const NAME_BY_ID: Record<number, string> = Object.fromEntries(
  Object.entries(COUNTRY_IDS).map(([name, id]) => [id, name]),
);

/** Resolve a (possibly messy) country name to its Cardmarket id. */
export const countryId = (name?: string | null): number | undefined => {
  if (!name) return undefined;
  const trimmed = name.trim();
  if (COUNTRY_IDS[trimmed] != null) return COUNTRY_IDS[trimmed];
  // Case-insensitive / partial fallback (e.g. "United Kingdom (UK)").
  const lower = trimmed.toLowerCase();
  for (const { name: n, id } of COUNTRIES) {
    if (n.toLowerCase() === lower || lower.includes(n.toLowerCase())) return id;
  }
  return undefined;
};

export const countryName = (id?: number | null): string | undefined =>
  id == null ? undefined : NAME_BY_ID[id];

/**
 * Read the user's home country from their account page. The primary-address
 * block on `/<lang>/Magic/Account` renders `<div class="Country">Belgium</div>`.
 * Returns the matching Cardmarket country id, or undefined if not found.
 */
export const fetchHomeCountryId = async (signal?: AbortSignal): Promise<number | undefined> => {
  const first = location.pathname.split('/').filter(Boolean)[0] ?? '';
  const lang = /^[a-z]{2}$/.test(first) ? first : 'en';
  const url = `${location.origin}/${lang}/Magic/Account`;
  const res = await fetch(url, { credentials: 'include', signal });
  if (!res.ok) throw new Error(`Account page ${res.status}`);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  // Primary address is the first `.Country` in the account info block.
  const name = doc
    .querySelector('.account-info .Country, .asList .Country, .Country')
    ?.textContent?.trim();
  return countryId(name);
};

/** One shipping method/tier as returned by the calculator (values normalized). */
export interface ShipMethod {
  isLetter: boolean;
  isTracked: boolean;
  isVirtual: boolean;
  /** Maximum insured order value this method covers, in €. */
  maxValue: number;
  /** Maximum weight this tier covers, in grams. */
  maxWeight: number;
  name: string;
  /** Price charged for this method, in €. */
  price: number;
}

interface RawMethod {
  isLetter?: boolean;
  isTracked?: boolean;
  isVirtual?: boolean;
  maxValue?: string;
  maxWeight?: number;
  name?: string;
  price?: string;
}

const SHIPPING_API = 'https://help.cardmarket.com/api/shippingCosts';

/** Parse a European-formatted money string ("1.234,56 €") to a number. */
export const parseMoney = (s?: string): number => {
  if (!s) return NaN;
  const cleaned = s
    .replace(/[^\d.,]/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const v = Number.parseFloat(cleaned);
  return Number.isFinite(v) ? v : NaN;
};

/**
 * Fetch the shipping matrix from one country to another (through the background
 * worker to avoid CORS). Virtual methods (digital delivery) are dropped.
 */
export const fetchShippingMatrix = async (fromId: number, toId: number): Promise<ShipMethod[]> => {
  const url = `${SHIPPING_API}?locale=en&fromCountry=${fromId}&toCountry=${toId}&preview=false`;
  const res = await requestApi({ url });
  if (!res.ok) throw new Error(`Shipping API ${res.status} ${res.statusText}`);
  let raw: RawMethod[];
  try {
    raw = JSON.parse(res.body) as RawMethod[];
  } catch {
    throw new Error('Shipping API returned an unexpected response.');
  }
  if (!Array.isArray(raw)) throw new Error('Shipping API returned an unexpected response.');
  return raw
    .map(m => ({
      isLetter: !!m.isLetter,
      isTracked: !!m.isTracked,
      isVirtual: !!m.isVirtual,
      maxValue: parseMoney(m.maxValue),
      maxWeight: typeof m.maxWeight === 'number' ? m.maxWeight : NaN,
      name: m.name ?? 'Shipping',
      price: parseMoney(m.price),
    }))
    .filter(m => !m.isVirtual && Number.isFinite(m.price) && Number.isFinite(m.maxWeight));
};

// Weight model, calibrated to Cardmarket's own letter buckets (≈4 cards = 20 g,
// ≈17 = 50 g, ≈40 = 100 g): a packaging base plus a per-card weight. Rough — real
// weight depends on sleeves/toploaders/envelope.
const PACK_BASE_G = 11.1;
const PER_CARD_G = 2.22;

/** Estimate the physical weight (grams) of an order of `cardCount` singles. */
export const estimateWeightGrams = (cardCount: number): number => {
  const n = Math.max(1, cardCount);
  return Math.round(PACK_BASE_G + n * PER_CARD_G);
};

/** Inverse: roughly how many single cards fit within a weight tier (grams). */
export const maxCardsForWeight = (grams: number): number =>
  Math.max(0, Math.floor((grams - PACK_BASE_G) / PER_CARD_G));

export interface ShipTier {
  isLetter: boolean;
  isTracked: boolean;
  /** Rough max number of single cards this tier's weight allows. */
  maxCards: number;
  /** Order-value cap for this tier, in €. */
  maxValue: number;
  name: string;
  price: number;
}

/**
 * Turn the raw methods into a clean, price-sorted "up to N cards" tier list for
 * display. Walks cheapest-first and only keeps a tier if it lets you send more
 * cards than every cheaper tier already kept, dropping dominated/redundant ones.
 */
export const shippingTiers = (methods: ShipMethod[]): ShipTier[] => {
  const tiers = methods
    .map(m => ({
      isLetter: m.isLetter,
      isTracked: m.isTracked,
      maxCards: maxCardsForWeight(m.maxWeight),
      maxValue: m.maxValue,
      name: m.name,
      price: m.price,
    }))
    .sort((a, b) => a.price - b.price || b.maxCards - a.maxCards);
  const out: ShipTier[] = [];
  let bestCards = -1;
  for (const t of tiers) {
    if (t.maxCards > bestCards) {
      out.push(t);
      bestCards = t.maxCards;
    }
  }
  return out;
};

export interface ShippingEstimate {
  /** All methods that fit, cheapest first (the tier options). */
  eligible: ShipMethod[];
  /** Cheapest method that fits the estimated weight and order value. */
  method: ShipMethod;
  /** Estimated order weight in grams. */
  weight: number;
}

/**
 * Pick the cheapest shipping method that covers both the estimated weight and
 * the order's insured value. Returns null if the matrix is empty / nothing fits.
 */
export const estimateShipping = (
  methods: ShipMethod[],
  cardCount: number,
  orderValue: number,
): ShippingEstimate | null => {
  if (!methods.length) return null;
  const weight = estimateWeightGrams(cardCount);
  const eligible = methods
    .filter(m => m.maxWeight >= weight && m.maxValue >= orderValue)
    .sort((a, b) => a.price - b.price);
  if (eligible.length === 0) return null;
  return { eligible, method: eligible[0], weight };
};
