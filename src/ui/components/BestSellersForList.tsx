import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { compareFavouriteFirst, useFavouriteSellers } from '../useFavouriteSellers';

import { Button } from './Button';
import { CardResultThumb } from './CardResultThumb';
import { Select } from './Field';
import { FavouriteSellerBadge, FavouriteSellerControl } from './FavouriteSellerControl';
import { ChevronDown, ChevronRight, ShoppingCart } from './icons';
import { SellerNameButton } from './SellerNameButton';

import { cartStore } from '@/content/cartStore';
import {
  clearChallengeResume,
  hydrateChallengeResume,
  needsVerification,
  OVERLAY_RESTORED_EVENT,
  peekChallengeResume,
  saveChallengeResume,
  yieldToChallenge,
  type WizardAlsoAllResumeJob,
} from '@/content/challengeResume';
import { expansionIconStore, normalizeSetName } from '@/content/expansionIconStore';
import { knownPriceStore } from '@/content/knownPriceStore';
import { askForLogin, clearCachedTokens, cmToken, rememberWriteToken } from '@/content/session';
import { sellerShipPrefsStore } from '@/content/sellerShipPrefsStore';
import { shippingStore } from '@/content/shippingStore';
import { listCards as cardsOnWantList } from '@/content/wantsIndex';
import { wantsStore } from '@/content/wantsStore';
import { imageUrlFor } from '@/lib/cardImage';
import {
  findAllBeneficialOneWantMoves,
  findBeneficialOneWantMoves,
  offersMapFromLines,
  summarizeMoves,
  type ConsolidationMoveResult,
} from '@/lib/consolidation';
import { flags } from '@/lib/flags';
import {
  knownCheapestDelta,
  type KnownOfferObservation,
  type KnownPriceEntry,
} from '@/lib/knownPriceMap';
import { buildPurchasePlanFromCart } from '@/lib/purchasePlan';
import {
  annotateWithKnownCheapest,
  goodsTotalForSelection,
  priceSellerOffers,
  wantKeyOf,
  wantListFingerprint,
  type SellerOfferLine,
  type SellerWantLine,
  type SellerWantPricingResult,
  type WantRequirement,
} from '@/lib/sellerWantPricing';
import { addArticleToCart } from '@/sites/cardmarket/cart';
import { countryId, estimateShipping } from '@/sites/cardmarket/shipping';
import {
  addWizardArticlesToCart,
  runShoppingWizard,
  type WizardResults,
} from '@/sites/cardmarket/shoppingWizard';
import {
  currentLang,
  fetchDoc,
  fetchSellerListOffers,
  fetchSellersWithMostWants,
  findProductForCard,
  pace,
  parseOffers,
  sellerProfileBase,
  sellerStockUrls,
  type ParsedOffer,
  type SellerWants,
} from '@/sites/cardmarket/wants';

/** Cache priced results so expand/collapse does not re-fetch. */
const PRICE_CACHE_TTL_MS = 5 * 60 * 1000;
const priceCache = new Map<string, { at: number; result: SellerWantPricingResult }>();

const cacheKey = (sellerId: string, wantListId: string, fp: string): string =>
  `${sellerId}|${wantListId}|${fp}`;

interface SellerPriceUi {
  cartError?: string;
  cartStatus?: 'idle' | 'adding' | 'done' | 'error';
  consolidations?: ConsolidationMoveResult[];
  error?: string;
  /** Selected wantKeys for Add all (defaults to all matched+partial). */
  selectedKeys?: Set<string>;
  status: 'loading' | 'done' | 'error';
  result?: SellerWantPricingResult;
}

interface WizardAlsoCompare {
  /** Positive = this seller is more expensive than the other. */
  delta: number;
  otherSellerName?: string;
  otherUnitPrice: number;
}

interface WizardAlsoLine extends SellerOfferLine {
  compare?: WizardAlsoCompare;
  wantKey: string;
}

interface WizardAlsoState {
  error?: string;
  lines: WizardAlsoLine[];
  status: 'idle' | 'loading' | 'done' | 'error';
}

interface WizardGridCell {
  amount: number;
  articleId: string;
  /** Extra articles when qty spans multiple offers. */
  articles: { amount: number; articleId: string; unitPrice: number }[];
  condition?: string;
  /** Expansion / set name for icon lookup. */
  edition?: string;
  foil?: boolean;
  imageUrl?: string;
  language?: string;
  source: 'wizard' | 'also';
  unitPrice: number;
}

interface WizardGridColumn {
  sellerKey: string;
  sellerName: string;
  sellerUrl?: string;
  /** Wizard-plan baseline for this shipment (from Results). */
  wizardCardCount: number;
  wizardGoods: number;
  wizardShip?: number;
}

interface WizardGridRow {
  cardName: string;
  /** Rows from another want list — kept below the primary list order. */
  fromOtherList?: boolean;
  imageUrl?: string;
  wantKey: string;
}

interface WizardColumnPickStats {
  cardCount: number;
  goods: number;
  /** Current estimated or wizard shipping; 0 if no cards. */
  ship: number | null;
  shipDelta: number | null;
  shipKind: 'none' | 'wizard' | 'estimate' | 'unknown';
  /** Estimate used a tracked-only filter. */
  trackedOnly?: boolean;
  /** Chosen method name when estimated. */
  methodName?: string;
  /** True when falling back to wizard ship after the pick size changed. */
  shipApprox?: boolean;
  total: number | null;
}

/** wantKey → sellerKey */
type WizardGridPicks = Record<string, string>;

interface CrossListLine {
  articleIds: string[];
  cardName: string;
  chosenQty: number;
  unitPrice: number;
  wantKey: string;
}

interface CrossListSellerHit {
  error?: string;
  goods: number;
  inPicks: boolean;
  lines: CrossListLine[];
  matchCount: number;
  pickCardCount: number;
  sellerKey: string;
  sellerName: string;
  sellerUrl?: string;
  status: 'done' | 'error' | 'skipped';
  wantCount: number;
}

const cellMapKey = (wantKey: string, sellerKey: string): string => `${wantKey}||${sellerKey}`;

const crossMoveKey = (m: ConsolidationMoveResult): string =>
  `${m.wantKey}|${m.fromSellerId}|${m.toSellerId}`;

const sellerSlug = (url?: string): string => {
  if (!url) return '';
  try {
    const path = new URL(url, location.origin).pathname;
    const m = path.match(/\/Users\/([^/]+)/i);
    return (m?.[1] ?? '').toLowerCase();
  } catch {
    return '';
  }
};

const sameGridSeller = (
  a: { sellerName: string; sellerUrl?: string },
  name: string,
  url?: string,
): boolean => {
  if (a.sellerName.toLowerCase() === name.toLowerCase()) return true;
  const sa = sellerSlug(a.sellerUrl);
  const sb = sellerSlug(url);
  return !!sa && !!sb && sa === sb;
};

const fmtEuro = (n: number): string => `${n.toFixed(2).replace('.', ',')} €`;
const fmtDelta = (n: number): string => `${n >= 0 ? '+' : ''}${fmtEuro(n)}`;

/** Short condition + language for dense grid cells. */
const fmtOfferMeta = (cell: {
  condition?: string;
  foil?: boolean;
  language?: string;
}): string | null => {
  const bits: string[] = [];
  if (cell.condition) bits.push(cell.condition);
  if (cell.language) bits.push(cell.language);
  if (cell.foil) bits.push('foil');
  return bits.length > 0 ? bits.join(' · ') : null;
};

/** Cardmarket set sprite (or short text fallback) for a cell. */
const GridEditionIcon = ({ edition }: { edition?: string }) => {
  const icons = useSyncExternalStore(
    expansionIconStore.subscribe,
    expansionIconStore.getSnapshot,
  );
  if (!edition) return null;
  const icon = icons[normalizeSetName(edition)];
  if (!icon) {
    return (
      <span className="block truncate text-[9px] leading-tight text-ink-faint" title={edition}>
        {edition}
      </span>
    );
  }
  const size = 12;
  const scale = size / icon.size;
  return (
    <span className="mx-auto flex h-3 w-3 items-center justify-center overflow-hidden" title={edition}>
      <span
        aria-label={edition}
        className="inline-block flex-none"
        style={{
          backgroundImage: `url("${icon.url}")`,
          backgroundPosition: icon.pos,
          backgroundRepeat: 'no-repeat',
          height: icon.size,
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
          width: icon.size,
        }}
      />
    </span>
  );
};

const offerLine = (o: ParsedOffer): SellerOfferLine | null => {
  const price = o.priceValue;
  if (price == null || !Number.isFinite(price)) return null;
  return {
    articleId: o.articleId,
    name: o.name,
    price,
    quantity: Math.max(1, o.quantity ?? 1),
    condition: o.condition,
    language: o.language,
    foil: o.isFoil,
    printing: o.edition,
    imageUrl: o.imageUrl,
  };
};

/** Name + art with the shared hover preview (CM image, else Scryfall by name). */
const WizardCardLabel = ({
  articleId,
  imageUrl,
  name,
  prefix,
}: {
  articleId: string;
  imageUrl?: string;
  name: string;
  prefix?: string;
}) => {
  const displayName = name.trim() || `Article ${articleId}`;
  const candidates = [imageUrl, imageUrlFor(undefined, displayName)].filter(
    (u): u is string => !!u,
  );
  const label = `${prefix ?? ''}${displayName}`;

  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      {candidates.length > 0 ? (
        <CardResultThumb
          candidates={candidates}
          className="relative h-7 w-5 flex-none overflow-hidden rounded bg-raised"
          name={displayName}
          previewKey={`wizard-thumb|${articleId}`}
        />
      ) : null}
      <span className="truncate">{label}</span>
    </span>
  );
};

const metaBits = (line: SellerWantLine): string => {
  const parts: string[] = [];
  if (line.condition) parts.push(line.condition);
  if (line.language) parts.push(line.language);
  if (line.foil) parts.push('foil');
  if (line.printing) parts.push(line.printing);
  const wantLabel =
    line.quantityStatus === 'UNKNOWN' ? `${line.chosenQty}/?` : `${line.chosenQty}/${line.wantedQty}`;
  parts.push(`qty ${wantLabel}`);
  return parts.join(' · ');
};

const observationsFromResult = (result: SellerWantPricingResult): KnownOfferObservation[] => {
  const now = Date.now();
  const out: KnownOfferObservation[] = [];
  for (const line of [...result.matched, ...result.partial]) {
    for (const slice of line.selectedOffers) {
      out.push({
        wantKey: line.wantKey,
        wantListId: result.wantListId,
        sellerId: result.sellerId,
        sellerName: result.sellerName,
        articleId: slice.articleId,
        unitPrice: slice.unitPrice,
        quantity: slice.quantity,
        language: slice.language,
        condition: slice.condition,
        foil: slice.foil,
        printing: slice.printing,
        observedAt: now,
        source: 'PRICE_IT',
      });
    }
  }
  return out;
};

const wizardSellerKey = (name: string, url?: string, i?: number | string): string =>
  `${url ?? name}|${i ?? 0}`;

const observationsFromWizard = (
  results: WizardResults,
  wantListId: string,
): KnownOfferObservation[] => {
  const now = Date.now();
  const out: KnownOfferObservation[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < results.sellers.length; i++) {
    const seller = results.sellers[i];
    const sellerId = wizardSellerKey(seller.name, seller.url, i);
    for (const a of seller.articles) {
      if (!a.name || a.unitPrice == null || !(a.unitPrice > 0)) continue;
      const dedupe = `${sellerId}:${a.articleId}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      out.push({
        wantKey: wantKeyOf(a.name),
        wantListId,
        sellerId,
        sellerName: seller.name,
        articleId: a.articleId,
        unitPrice: a.unitPrice,
        quantity: a.amount,
        observedAt: now,
        source: 'OTHER_TRUSTED',
      });
    }
  }
  return out;
};

const compareAlsoLine = (
  map: Record<string, KnownPriceEntry>,
  wantListId: string,
  sellerId: string,
  line: SellerOfferLine,
): WizardAlsoLine => {
  const wantKey = wantKeyOf(line.name);
  const delta = knownCheapestDelta(
    map,
    { wantKey, wantListId },
    line.price,
    sellerId,
    { allowStale: true },
  );
  return {
    ...line,
    wantKey,
    compare: delta
      ? {
          delta: delta.delta,
          otherSellerName: delta.knownCheapest.sellerName,
          otherUnitPrice: delta.knownCheapest.unitPrice,
        }
      : undefined,
  };
};

const buildWizardGrid = (
  results: WizardResults,
  also: Record<string, WizardAlsoState>,
  extraColumns: readonly WizardGridColumn[] = [],
  /** wantKey → how many copies to buy (defaults to 1). */
  wantQtyByKey: ReadonlyMap<string, number> = new Map(),
  /** Want keys that came from a cross-list scan — append after primary rows. */
  otherListWantKeys: ReadonlySet<string> = new Set(),
): {
  cells: Map<string, WizardGridCell>;
  columns: WizardGridColumn[];
  defaultPicks: WizardGridPicks;
  rows: WizardGridRow[];
} => {
  const buyQty = (wantKey: string, available: number): number => {
    const wanted = wantQtyByKey.get(wantKey) ?? 1;
    return Math.min(Math.max(1, wanted), Math.max(1, available));
  };

  const columns: WizardGridColumn[] = [
    ...results.sellers.map((s, i) => {
      const wizardCardCount = s.articles.reduce((n, a) => n + (a.amount > 0 ? a.amount : 1), 0);
      const wizardGoods =
        s.articlesValue ??
        s.articles.reduce(
          (n, a) => n + (a.unitPrice != null && a.unitPrice > 0 ? a.unitPrice * a.amount : 0),
          0,
        );
      return {
        sellerKey: wizardSellerKey(s.name, s.url, i),
        sellerName: s.name,
        sellerUrl: s.url,
        wizardCardCount,
        wizardGoods,
        wizardShip: s.shippingCost,
      };
    }),
    ...extraColumns,
  ];
  const cells = new Map<string, WizardGridCell>();
  const rowMeta = new Map<string, WizardGridRow>();
  const defaultPicks: WizardGridPicks = {};
  /** Encounter order for primary (wizard) rows — stable, not re-sorted into other-list. */
  const primaryOrder: string[] = [];

  const notePrimaryRow = (wantKey: string, cardName: string, imageUrl?: string) => {
    const existing = rowMeta.get(wantKey);
    if (!existing) {
      rowMeta.set(wantKey, { wantKey, cardName, imageUrl, fromOtherList: false });
      primaryOrder.push(wantKey);
      return;
    }
    if (existing.fromOtherList) {
      rowMeta.set(wantKey, { ...existing, fromOtherList: false, cardName, imageUrl: imageUrl ?? existing.imageUrl });
      primaryOrder.push(wantKey);
    } else if (!existing.imageUrl && imageUrl) {
      rowMeta.set(wantKey, { ...existing, imageUrl });
    }
  };

  for (let i = 0; i < results.sellers.length; i++) {
    const seller = results.sellers[i];
    const sellerKey = wizardSellerKey(seller.name, seller.url, i);
    for (const a of seller.articles) {
      if (!a.name) continue;
      const unitPrice = a.unitPrice ?? 0;
      if (!(unitPrice > 0)) continue;
      const wantKey = wantKeyOf(a.name);
      notePrimaryRow(wantKey, a.name, a.imageUrl);
      const ck = cellMapKey(wantKey, sellerKey);
      const prev = cells.get(ck);
      const amount = Math.max(1, a.amount);
      if (prev?.source === 'wizard') {
        // Wizard can list several articles for the same want (multi-copy / printings).
        const articles = [...prev.articles, { amount, articleId: a.articleId, unitPrice }];
        const totalAmount = articles.reduce((n, x) => n + x.amount, 0);
        const goods = articles.reduce((n, x) => n + x.unitPrice * x.amount, 0);
        cells.set(ck, {
          ...prev,
          amount: totalAmount,
          articles,
          condition: prev.condition ?? a.condition,
          edition: prev.edition ?? a.edition,
          foil: prev.foil || a.foil,
          imageUrl: prev.imageUrl ?? a.imageUrl,
          language: prev.language ?? a.language,
          unitPrice: totalAmount > 0 ? goods / totalAmount : unitPrice,
        });
      } else if (!prev || unitPrice < prev.unitPrice) {
        cells.set(ck, {
          amount,
          articleId: a.articleId,
          articles: [{ amount, articleId: a.articleId, unitPrice }],
          condition: a.condition,
          edition: a.edition,
          foil: a.foil,
          imageUrl: a.imageUrl,
          language: a.language,
          source: 'wizard',
          unitPrice,
        });
      }
      const curPick = defaultPicks[wantKey];
      if (!curPick) {
        defaultPicks[wantKey] = sellerKey;
      } else {
        const curCell = cells.get(cellMapKey(wantKey, curPick));
        if (curCell && unitPrice < curCell.unitPrice) {
          defaultPicks[wantKey] = sellerKey;
        }
      }
    }
  }

  for (const [sellerKey, state] of Object.entries(also)) {
    if (state.status !== 'done') continue;
    for (const line of state.lines) {
      if (!line.articleId || !(line.price > 0)) continue;
      const wantKey = line.wantKey || wantKeyOf(line.name);
      const existing = rowMeta.get(wantKey);
      if (!existing) {
        const fromOtherList = otherListWantKeys.has(wantKey);
        rowMeta.set(wantKey, {
          wantKey,
          cardName: line.name,
          imageUrl: line.imageUrl,
          fromOtherList,
        });
        if (!fromOtherList) primaryOrder.push(wantKey);
      } else if (!existing.imageUrl && line.imageUrl) {
        rowMeta.set(wantKey, { ...existing, imageUrl: line.imageUrl });
      }
      const ck = cellMapKey(wantKey, sellerKey);
      const prev = cells.get(ck);
      // Prefer wizard cell for the same seller+card; also-has fills empties / extras
      // and can backfill condition / language / edition when the Results row lacked them.
      if (prev?.source === 'wizard') {
        if (
          line.articleId === prev.articleId &&
          ((!prev.condition && line.condition) ||
            (!prev.language && line.language) ||
            (!prev.edition && line.printing) ||
            (prev.foil == null && line.foil) ||
            (!prev.imageUrl && line.imageUrl))
        ) {
          cells.set(ck, {
            ...prev,
            condition: prev.condition ?? line.condition,
            edition: prev.edition ?? line.printing,
            foil: prev.foil ?? line.foil,
            imageUrl: prev.imageUrl ?? line.imageUrl,
            language: prev.language ?? line.language,
          });
        }
        continue;
      }
      // `line.quantity` is often seller stock — only buy the want amount (usually 1).
      const amount = buyQty(wantKey, line.quantity);
      if (!prev || line.price < prev.unitPrice) {
        cells.set(ck, {
          amount,
          articleId: line.articleId,
          articles: [{ amount, articleId: line.articleId, unitPrice: line.price }],
          condition: line.condition,
          edition: line.printing,
          foil: line.foil,
          imageUrl: line.imageUrl,
          language: line.language,
          source: 'also',
          unitPrice: line.price,
        });
      }
    }
  }

  const primaryRows = primaryOrder
    .map(k => rowMeta.get(k))
    .filter((r): r is WizardGridRow => !!r && !r.fromOtherList);
  const otherRows = [...rowMeta.values()]
    .filter(r => r.fromOtherList)
    .sort((a, b) => a.cardName.localeCompare(b.cardName));
  // Any primary row that wasn't in encounter order (shouldn't happen) — append before other.
  const seenPrimary = new Set(primaryRows.map(r => r.wantKey));
  for (const r of rowMeta.values()) {
    if (!r.fromOtherList && !seenPrimary.has(r.wantKey)) primaryRows.push(r);
  }
  const rows = [...primaryRows, ...otherRows];
  return { cells, columns, defaultPicks, rows };
};

/**
 * Rank sellers by coverage of one want list, then optionally price each one
 * into a structured matched / partial / missing table (Phase A–B.5).
 */
export const BestSellersForList = ({
  autoLoad = false,
  heading,
  listCards,
  listWantQtys,
  wantListId,
}: {
  autoLoad?: boolean;
  heading?: string;
  /** Normalized card key → display name. */
  listCards: Map<string, string>;
  /**
   * Authoritative wanted quantities (KNOWN only). Keys absent from the map are
   * treated as quantityStatus UNKNOWN (operational qty 1 for pricing, not claimed
   * as Cardmarket truth).
   */
  listWantQtys?: Map<string, number>;
  wantListId: string;
}) => {
  const { favourites, isFavourite, toggle: toggleFavourite } = useFavouriteSellers();
  const shipping = useSyncExternalStore(shippingStore.subscribe, shippingStore.getSnapshot);
  const cart = useSyncExternalStore(cartStore.subscribe, cartStore.getSnapshot);
  const knownMap = useSyncExternalStore(knownPriceStore.subscribe, knownPriceStore.getSnapshot);
  const shipPrefs = useSyncExternalStore(
    sellerShipPrefsStore.subscribe,
    sellerShipPrefsStore.getSnapshot,
  );
  const wantsSnap = useSyncExternalStore(wantsStore.subscribe, wantsStore.getSnapshot);
  const [sellers, setSellers] = useState<{
    error: string | null;
    rows: SellerWants[];
    status: 'idle' | 'loading' | 'done' | 'error';
  }>({ error: null, rows: [], status: 'idle' });
  const [priced, setPriced] = useState<Record<string, SellerPriceUi>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [wizard, setWizard] = useState<{
    cartStatus: 'idle' | 'adding' | 'done' | 'error';
    error: string | null;
    /** wantKey → sellerKey for the grid pick. */
    gridPicks: WizardGridPicks;
    message: string | null;
    progress: number | null;
    results: WizardResults | null;
    status: 'idle' | 'running' | 'done' | 'error';
  }>({
    cartStatus: 'idle',
    error: null,
    gridPicks: {},
    message: null,
    progress: null,
    results: null,
    status: 'idle',
  });
  /** Extra want-list offers per wizard seller key (name|url), beyond the Wizard pick. */
  const [wizardAlso, setWizardAlso] = useState<Record<string, WizardAlsoState>>({});
  const [alsoAll, setAlsoAll] = useState<{
    current: number;
    status: 'idle' | 'running' | 'done' | 'paused';
    total: number;
  }>({ current: 0, status: 'idle', total: 0 });
  /** Sellers pulled in via “Add next cheapest” (not in the wizard plan). */
  const [extraColumns, setExtraColumns] = useState<WizardGridColumn[]>([]);
  const [nextCheap, setNextCheap] = useState<
    Record<string, { error?: string; status: 'idle' | 'loading' | 'done' | 'error' }>
  >({});
  const [crossListId, setCrossListId] = useState('');
  const [crossList, setCrossList] = useState<{
    applyMsg: string | null;
    error: string | null;
    hits: CrossListSellerHit[];
    listName: string;
    moves: ConsolidationMoveResult[];
    progress: string | null;
    status: 'idle' | 'scanning' | 'done' | 'error';
  }>({
    applyMsg: null,
    error: null,
    hits: [],
    listName: '',
    moves: [],
    progress: null,
    status: 'idle',
  });
  /** Quantities from other lists scanned into the grid (merged into buy qty). */
  const [crossListQtyByKey, setCrossListQtyByKey] = useState<Map<string, number>>(() => new Map());
  const extraSeq = useRef(0);
  const priceAborts = useRef<Map<string, AbortController>>(new Map());
  const wizardAbort = useRef<AbortController | null>(null);
  const alsoAllAbort = useRef<AbortController | null>(null);
  const crossListAbort = useRef<AbortController | null>(null);
  const alsoAllResuming = useRef(false);
  const expansionIconsPrefetched = useRef(false);
  const expansionIcons = useSyncExternalStore(
    expansionIconStore.subscribe,
    expansionIconStore.getSnapshot,
  );

  useEffect(() => {
    if (expansionIconsPrefetched.current || expansionIconStore.isLoading()) return;
    if (Object.keys(expansionIcons).length >= 200) return;
    expansionIconsPrefetched.current = true;
    void fetchDoc(`/${currentLang()}/Magic/Expansions`)
      .then(({ doc }) => expansionIconStore.captureFrom(doc))
      .catch(() => {});
  }, [expansionIcons]);
  const wizardAlsoRef = useRef(wizardAlso);
  wizardAlsoRef.current = wizardAlso;
  const wizardRef = useRef(wizard);
  wizardRef.current = wizard;
  const extraColumnsRef = useRef(extraColumns);
  extraColumnsRef.current = extraColumns;
  const wants: WantRequirement[] = useMemo(() => {
    const out: WantRequirement[] = [];
    for (const [key, name] of listCards) {
      const knownQty = listWantQtys?.get(key);
      const known = knownQty != null && Number.isFinite(knownQty) && knownQty > 0;
      out.push({
        wantKey: key,
        name,
        quantity: known ? Math.floor(knownQty) : 1,
        quantityStatus: known ? 'KNOWN' : 'UNKNOWN',
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [listCards, listWantQtys]);

  const fingerprint = useMemo(() => wantListFingerprint(wants), [wants]);

  const wantQtyByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of wants) {
      m.set(w.wantKey, w.quantityStatus === 'KNOWN' ? Math.max(1, w.quantity) : 1);
    }
    for (const [key, qty] of crossListQtyByKey) {
      if (!m.has(key)) m.set(key, Math.max(1, qty));
    }
    return m;
  }, [wants, crossListQtyByKey]);

  const purchasePlan = useMemo(() => {
    const estimate = (sellerId: string, cardCount: number, goodsTotal: number) => {
      const item = cart.items.find(i => i.sellerId === sellerId);
      const fromId = countryId(item?.sellerCountry);
      const matrix = fromId != null ? shipping.matrices[fromId] : undefined;
      if (!matrix?.length || cardCount <= 0) return undefined;
      const est = estimateShipping(matrix, cardCount, goodsTotal);
      if (!est) return undefined;
      return {
        price: est.method.price,
        weight: est.weight,
        tierMaxCards: est.tierMaxCards,
        nextTierMaxCards: est.nextTierMaxCards,
        remainingWeightInTier: est.remainingWeightInTier,
        methodName: est.method.name,
      };
    };
    return buildPurchasePlanFromCart(
      cart.items.map(i => ({
        articleId: i.articleId,
        name: i.name,
        amount: i.amount,
        unitPrice: i.priceValue,
        sellerId: i.sellerId,
        sellerName: i.seller,
      })),
      estimate,
      cart.fetchedAt ?? Date.now(),
    );
  }, [cart.items, cart.fetchedAt, shipping.matrices]);

  useEffect(() => {
    for (const c of priceAborts.current.values()) c.abort();
    priceAborts.current.clear();
    wizardAbort.current?.abort();
    wizardAbort.current = null;
    setSellers({ error: null, rows: [], status: 'idle' });
    setPriced({});
    setExpanded(null);
    setWizard({
      cartStatus: 'idle',
      error: null,
      gridPicks: {},
      message: null,
      progress: null,
      results: null,
      status: 'idle',
    });
    setWizardAlso({});
    setAlsoAll({ current: 0, status: 'idle', total: 0 });
    setExtraColumns([]);
    setNextCheap({});
    setCrossListId('');
    setCrossList({
      applyMsg: null,
      error: null,
      hits: [],
      listName: '',
      moves: [],
      progress: null,
      status: 'idle',
    });
    setCrossListQtyByKey(new Map());
    alsoAllAbort.current?.abort();
    alsoAllAbort.current = null;
    crossListAbort.current?.abort();
    crossListAbort.current = null;
  }, [wantListId, fingerprint]);

  useEffect(() => {
    return () => {
      wizardAbort.current?.abort();
      alsoAllAbort.current?.abort();
      crossListAbort.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (shipping.toCountry == null) return;
    for (const row of sellers.rows) {
      const id = countryId(row.location);
      if (id != null) void shippingStore.ensureMatrix(id);
    }
  }, [sellers.rows, shipping.toCountry]);

  const loadSellers = async () => {
    const token = await cmToken();
    if (!token) {
      askForLogin();
      setSellers({
        error: 'Sign in to Cardmarket to rank sellers for this list.',
        rows: [],
        status: 'error',
      });
      return;
    }
    setSellers({ error: null, rows: [], status: 'loading' });
    setPriced({});
    setExpanded(null);
    try {
      const rows = await fetchSellersWithMostWants(wantListId, token);
      for (const row of rows) {
        if (row.location) {
          void sellerShipPrefsStore.note(row.name, { country: row.location });
        }
      }
      setSellers({ error: null, rows, status: 'done' });
    } catch (err) {
      setSellers({
        error: err instanceof Error ? err.message : String(err),
        rows: [],
        status: 'error',
      });
    }
  };

  const runWizard = async () => {
    const token = await cmToken();
    if (!token) {
      askForLogin();
      setWizard({
        cartStatus: 'idle',
        error: 'Sign in to Cardmarket to run the Shopping Wizard.',
        gridPicks: {},
        message: null,
        progress: null,
        results: null,
        status: 'error',
      });
      return;
    }
    wizardAbort.current?.abort();
    const ac = new AbortController();
    wizardAbort.current = ac;
    setWizardAlso({});
    setAlsoAll({ current: 0, status: 'idle', total: 0 });
    setExtraColumns([]);
    setNextCheap({});
    alsoAllAbort.current?.abort();
    alsoAllAbort.current = null;
    setWizard({
      cartStatus: 'idle',
      error: null,
      gridPicks: {},
      message: null,
      progress: 0,
      results: null,
      status: 'running',
    });
    try {
      const results = await runShoppingWizard({
        idWantsList: wantListId,
        token,
        signal: ac.signal,
        onProgress: pct =>
          setWizard(cur => (cur.status === 'running' ? { ...cur, progress: pct } : cur)),
      });
      rememberWriteToken(token);
      await knownPriceStore.note(observationsFromWizard(results, wantListId));
      const { defaultPicks } = buildWizardGrid(results, {}, [], wantQtyByKey);
      setWizard({
        cartStatus: 'idle',
        error: null,
        gridPicks: defaultPicks,
        message: 'Plan ready — pick cells, then Confirm',
        progress: 100,
        results,
        status: 'done',
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : String(err);
      if (/CHALLENGE:/i.test(msg)) {
        clearCachedTokens();
        askForLogin();
      }
      setWizard({
        cartStatus: 'idle',
        error: msg.replace(/^CHALLENGE:\s*/i, ''),
        gridPicks: {},
        message: null,
        progress: null,
        results: null,
        status: 'error',
      });
    }
  };

  const otherListWantKeys = useMemo(
    () => new Set(crossListQtyByKey.keys()),
    [crossListQtyByKey],
  );

  const wizardGrid = useMemo(() => {
    if (!wizard.results) {
      return {
        cells: new Map<string, WizardGridCell>(),
        columns: [] as WizardGridColumn[],
        defaultPicks: {} as WizardGridPicks,
        rows: [] as WizardGridRow[],
      };
    }
    return buildWizardGrid(
      wizard.results,
      wizardAlso,
      extraColumns,
      wantQtyByKey,
      otherListWantKeys,
    );
  }, [wizard.results, wizardAlso, extraColumns, wantQtyByKey, otherListWantKeys]);

  // Keep every wizard-plan row selected when cells appear so the live total
  // matches Cardmarket’s plan (covers late-parsed / multi-article wants).
  useEffect(() => {
    if (!wizard.results || wizard.status !== 'done') return;
    setWizard(cur => {
      let changed = false;
      const next = { ...cur.gridPicks };
      for (const [wantKey, sellerKey] of Object.entries(wizardGrid.defaultPicks)) {
        if (next[wantKey]) continue;
        if (!wizardGrid.cells.has(cellMapKey(wantKey, sellerKey))) continue;
        next[wantKey] = sellerKey;
        changed = true;
      }
      for (const row of wizardGrid.rows) {
        if (row.fromOtherList || next[row.wantKey]) continue;
        for (const col of wizardGrid.columns) {
          const cell = wizardGrid.cells.get(cellMapKey(row.wantKey, col.sellerKey));
          if (cell?.source === 'wizard') {
            next[row.wantKey] = col.sellerKey;
            changed = true;
            break;
          }
        }
      }
      return changed ? { ...cur, gridPicks: next } : cur;
    });
  }, [
    wizard.results,
    wizard.status,
    wizardGrid.defaultPicks,
    wizardGrid.cells,
    wizardGrid.rows,
    wizardGrid.columns,
  ]);

  const sellerLocationByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const [name, pref] of Object.entries(shipPrefs)) {
      if (pref.country) m.set(name, pref.country);
    }
    for (const row of sellers.rows) {
      if (row.location) m.set(row.name.toLowerCase(), row.location);
    }
    for (const item of cart.items) {
      if (item.seller && item.sellerCountry) {
        m.set(item.seller.toLowerCase(), item.sellerCountry);
      }
    }
    return m;
  }, [sellers.rows, cart.items, shipPrefs]);

  useEffect(() => {
    for (const col of wizardGrid.columns) {
      const loc = sellerLocationByName.get(col.sellerName.toLowerCase());
      const id = countryId(loc);
      if (id != null) void shippingStore.ensureMatrix(id);
    }
  }, [wizardGrid.columns, sellerLocationByName]);

  const wizardColumnStats = useMemo(() => {
    const out = new Map<string, WizardColumnPickStats>();
    for (const col of wizardGrid.columns) {
      let cardCount = 0;
      let goods = 0;
      for (const [wantKey, sellerKey] of Object.entries(wizard.gridPicks)) {
        if (sellerKey !== col.sellerKey) continue;
        const cell = wizardGrid.cells.get(cellMapKey(wantKey, sellerKey));
        if (!cell) continue;
        cardCount += cell.amount;
        goods += cell.unitPrice * cell.amount;
      }

      const baselineShip = col.wizardShip;
      if (cardCount <= 0) {
        out.set(col.sellerKey, {
          cardCount: 0,
          goods: 0,
          ship: 0,
          shipDelta:
            baselineShip != null && baselineShip > 0 ? -baselineShip : baselineShip != null ? 0 : null,
          shipKind: 'none',
          total: 0,
        });
        continue;
      }

      const pref = shipPrefs[col.sellerName.toLowerCase()];
      const requireTracked = pref?.requireTracked === true;
      const loc = sellerLocationByName.get(col.sellerName.toLowerCase());
      const fromId = countryId(loc);
      const matrix = fromId != null ? shipping.matrices[fromId] : undefined;
      const pending =
        fromId != null && shipping.pending.includes(fromId) && !(matrix && matrix.length > 0);
      const estimated =
        matrix && matrix.length > 0
          ? estimateShipping(matrix, cardCount, goods, { requireTracked })
          : null;

      let ship: number | null = null;
      let shipKind: WizardColumnPickStats['shipKind'] = pending ? 'unknown' : 'unknown';
      let shipApprox = false;
      let methodName: string | undefined;
      if (estimated) {
        ship = estimated.method.price;
        shipKind = 'estimate';
        methodName = estimated.method.name;
      } else if (baselineShip != null) {
        // Keep wizard postage visible when we can't re-estimate yet (missing
        // country / matrix) — better than "ship ?" after a pick change.
        ship = baselineShip;
        shipKind = 'wizard';
        shipApprox = cardCount !== col.wizardCardCount || Math.abs(goods - col.wizardGoods) > 0.02;
      }

      const shipDelta =
        ship != null && baselineShip != null ? ship - baselineShip : null;

      out.set(col.sellerKey, {
        cardCount,
        goods,
        ship,
        shipDelta,
        shipKind,
        shipApprox,
        trackedOnly: requireTracked || estimated?.method.isTracked,
        methodName,
        total: ship != null ? goods + ship : null,
      });
    }
    return out;
  }, [
    wizard.gridPicks,
    wizardGrid.cells,
    wizardGrid.columns,
    sellerLocationByName,
    shipping.matrices,
    shipping.pending,
    shipPrefs,
  ]);

  const wizardPickSummary = useMemo(() => {
    let goods = 0;
    let articles = 0;
    let ship = 0;
    let shipKnown = true;
    const active = new Set<string>();
    for (const [wantKey, sellerKey] of Object.entries(wizard.gridPicks)) {
      const cell = wizardGrid.cells.get(cellMapKey(wantKey, sellerKey));
      if (!cell) continue;
      goods += cell.unitPrice * cell.amount;
      articles += cell.amount;
      active.add(sellerKey);
    }
    for (const sellerKey of active) {
      const st = wizardColumnStats.get(sellerKey);
      if (!st || st.ship == null) {
        shipKnown = false;
        continue;
      }
      ship += st.ship;
    }
    const wizardShip = wizard.results?.shippingCost;
    const wizardGoods = wizard.results?.articlesValue;
    const wizardTotal = wizard.results?.total;
    const shipDelta =
      shipKnown && wizardShip != null ? ship - wizardShip : null;
    const goodsDelta = wizardGoods != null ? goods - wizardGoods : null;
    const total = shipKnown ? goods + ship : null;
    const totalDelta =
      total != null && wizardTotal != null ? total - wizardTotal : null;
    return {
      articles,
      goods,
      goodsDelta,
      picks: Object.keys(wizard.gridPicks).length,
      ship: shipKnown ? ship : null,
      shipDelta,
      shipments: active.size,
      total,
      totalDelta,
      wizardShip: wizardShip ?? null,
      wizardTotal: wizardTotal ?? null,
    };
  }, [wizard.gridPicks, wizard.results, wizardGrid.cells, wizardColumnStats]);

  const gridSelectable = useMemo(
    () =>
      alsoAll.status === 'done' ||
      extraColumns.length > 0 ||
      Object.values(wizardAlso).some(s => s.status === 'done'),
    [alsoAll.status, wizardAlso, extraColumns.length],
  );

  const pickGridCell = (wantKey: string, sellerKey: string) => {
    if (!gridSelectable) return;
    setWizard(cur => {
      const next = { ...cur.gridPicks };
      if (next[wantKey] === sellerKey) delete next[wantKey];
      else next[wantKey] = sellerKey;
      return { ...cur, gridPicks: next };
    });
  };

  const confirmGridToCart = async () => {
    const results = wizard.results;
    if (!results) return;
    const picks = wizard.gridPicks;
    const wantKeys = Object.keys(picks);
    if (wantKeys.length === 0) return;

    const wizardArticleIds = new Set(results.articles.map(a => a.articleId));
    const wizardBatch: { articleId: string; amount: number }[] = [];
    const alsoBatch: { articleId: string; amount: number }[] = [];

    for (const wantKey of wantKeys) {
      const sellerKey = picks[wantKey];
      const cell = wizardGrid.cells.get(cellMapKey(wantKey, sellerKey));
      if (!cell) continue;
      for (const a of cell.articles) {
        if (wizardArticleIds.has(a.articleId) && cell.source === 'wizard') {
          wizardBatch.push({ articleId: a.articleId, amount: a.amount });
        } else {
          alsoBatch.push({ articleId: a.articleId, amount: a.amount });
        }
      }
    }

    if (wizardBatch.length === 0 && alsoBatch.length === 0) return;
    setWizard(cur => ({ ...cur, cartStatus: 'adding', error: null }));
    try {
      let added = 0;
      if (wizardBatch.length > 0) {
        const token = await cmToken();
        if (!token) {
          askForLogin();
          throw new Error('Not signed in');
        }
        rememberWriteToken(token);
        const byId = new Map(results.articles.map(a => [a.articleId, a]));
        const articles = wizardBatch
          .map(b => {
            const base = byId.get(b.articleId);
            return base ? { ...base, amount: b.amount } : null;
          })
          .filter((a): a is NonNullable<typeof a> => !!a);
        if (articles.length > 0) {
          const add = await addWizardArticlesToCart({ ...results, articles }, token);
          if (!add.ok) throw new Error(add.message);
          added += articles.length;
        }
      }
      for (const a of alsoBatch) {
        const attempt = async () => {
          const token = await cmToken();
          if (!token) return { message: 'Not signed in', ok: false as const };
          rememberWriteToken(token);
          return addArticleToCart(a.articleId, token, a.amount);
        };
        let r = await attempt();
        if (!r.ok && /could not be completed|session|token|csrf|sign in/i.test(r.message)) {
          clearCachedTokens();
          r = await attempt();
        }
        if (!r.ok && /not signed in/i.test(r.message)) {
          askForLogin();
          throw new Error(r.message);
        }
        if (r.ok) added++;
        await new Promise(done => setTimeout(done, 350 + Math.random() * 350));
      }
      await cartStore.refresh();
      setWizard(cur => ({
        ...cur,
        cartStatus: 'done',
        message: `Added ${added} to cart`,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/CHALLENGE:/i.test(msg)) {
        clearCachedTokens();
        askForLogin();
      }
      setWizard(cur => ({
        ...cur,
        cartStatus: 'error',
        error: msg.replace(/^CHALLENGE:\s*/i, ''),
      }));
    }
  };

  const otherListOptions = useMemo(
    () =>
      (wantsSnap.index?.lists ?? []).filter(
        l => l.id !== wantListId && (l.extracted > 0 || l.expected > 0),
      ),
    [wantsSnap.index, wantListId],
  );

  useEffect(() => {
    if (crossListId) return;
    if (otherListOptions[0]?.id) setCrossListId(otherListOptions[0].id);
  }, [crossListId, otherListOptions]);

  const scanCrossList = async () => {
    if (!crossListId || wizardGrid.columns.length === 0) return;
    const index = wantsSnap.index;
    if (!index) {
      setCrossList(cur => ({
        ...cur,
        error: 'Sync want lists first (Wants tab).',
        status: 'error',
      }));
      return;
    }
    const meta = index.lists.find(l => l.id === crossListId);
    const listName = meta?.name ?? crossListId;
    const otherCards = cardsOnWantList(index, crossListId);
    if (otherCards.length === 0) {
      setCrossList(cur => ({
        ...cur,
        error: `No cards indexed for “${listName}” — re-sync that list.`,
        listName,
        status: 'error',
      }));
      return;
    }
    const otherWants: WantRequirement[] = otherCards.map(c => ({
      wantKey: wantKeyOf(c.name) || c.key,
      name: c.name,
      quantity:
        c.quantityStatus === 'KNOWN' && c.amount != null && c.amount > 0
          ? Math.floor(c.amount)
          : 1,
      quantityStatus: c.quantityStatus,
    }));

    const pickedKeys = new Set(Object.values(wizard.gridPicks));
    const targets = wizardGrid.columns
      .map(col => {
        const urls = sellerStockUrls(col.sellerName, col.sellerUrl);
        return urls
          ? {
              sellerKey: col.sellerKey,
              sellerName: col.sellerName,
              sellerUrl: urls.profile,
              inPicks: pickedKeys.has(col.sellerKey),
              pickCardCount: wizardColumnStats.get(col.sellerKey)?.cardCount ?? 0,
            }
          : null;
      })
      .filter((t): t is NonNullable<typeof t> => !!t);

    if (targets.length === 0) {
      setCrossList(cur => ({
        ...cur,
        error: 'No seller URLs on the grid — run Also-on-list or Add next cheapest first.',
        listName,
        status: 'error',
      }));
      return;
    }

    crossListAbort.current?.abort();
    const controller = new AbortController();
    crossListAbort.current = controller;
    setCrossList({
      applyMsg: null,
      error: null,
      hits: [],
      listName,
      moves: [],
      progress: null,
      status: 'scanning',
    });

    const hits: CrossListSellerHit[] = [];
    const gridAlsoBySeller = new Map<string, WizardAlsoLine[]>();
    try {
      for (let i = 0; i < targets.length; i++) {
        if (controller.signal.aborted) return;
        const t = targets[i];
        setCrossList(cur => ({
          ...cur,
          progress: `Probing ${t.sellerName} (${i + 1}/${targets.length})…`,
        }));
        if (i > 0) await pace(controller.signal);
        try {
          const { offers, requireTracked } = await fetchSellerListOffers(
            t.sellerUrl,
            crossListId,
            () => {},
            controller.signal,
          );
          const countryFromOffers = offers.find(o => o.sellerCountry)?.sellerCountry;
          void sellerShipPrefsStore.note(t.sellerName, {
            ...(countryFromOffers ? { country: countryFromOffers } : {}),
            ...(requireTracked ? { requireTracked: true } : {}),
          });
          const lines = offers.map(offerLine).filter((o): o is SellerOfferLine => !!o);
          const imageByArticle = new Map<string, string>();
          for (const o of lines) {
            if (o.articleId && o.imageUrl) imageByArticle.set(o.articleId, o.imageUrl);
          }
          const pricedOther = priceSellerOffers({
            sellerId: t.sellerKey,
            sellerName: t.sellerName,
            wantListId: crossListId,
            wants: otherWants,
            offers: lines,
          });
          void knownPriceStore.note(observationsFromResult(pricedOther));
          const matched = [...pricedOther.matched, ...pricedOther.partial];
          const goods = matched.reduce((s, l) => s + l.goodsTotal, 0);
          const alsoLines: WizardAlsoLine[] = [];
          for (const line of matched) {
            for (const slice of line.selectedOffers) {
              if (!slice.articleId) continue;
              alsoLines.push({
                articleId: slice.articleId,
                name: line.cardName,
                price: slice.unitPrice,
                quantity: Math.max(slice.quantity, line.availableQty),
                condition: slice.condition,
                language: slice.language,
                foil: slice.foil,
                printing: slice.printing,
                imageUrl: imageByArticle.get(slice.articleId),
                wantKey: line.wantKey,
              });
            }
          }
          if (alsoLines.length > 0) gridAlsoBySeller.set(t.sellerKey, alsoLines);
          hits.push({
            sellerKey: t.sellerKey,
            sellerName: t.sellerName,
            sellerUrl: t.sellerUrl,
            inPicks: t.inPicks,
            pickCardCount: t.pickCardCount,
            matchCount: matched.length,
            wantCount: otherWants.length,
            goods,
            lines: matched
              .slice()
              .sort((a, b) => a.unitPrice - b.unitPrice)
              .slice(0, 8)
              .map(l => ({
                wantKey: l.wantKey,
                cardName: l.cardName,
                unitPrice: l.unitPrice,
                chosenQty: l.chosenQty,
                articleIds: l.articleIds,
              })),
            status: 'done',
          });
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          const message = err instanceof Error ? err.message : String(err);
          if (needsVerification(message)) {
            setCrossList(cur => ({
              ...cur,
              error:
                'Paused for Cardmarket captcha — clear the check on the page, then scan again.',
              hits: [...hits],
              listName,
              progress: null,
              status: 'error',
            }));
            clearCachedTokens();
            askForLogin();
            return;
          }
          hits.push({
            sellerKey: t.sellerKey,
            sellerName: t.sellerName,
            sellerUrl: t.sellerUrl,
            inPicks: t.inPicks,
            pickCardCount: t.pickCardCount,
            matchCount: 0,
            wantCount: otherWants.length,
            goods: 0,
            lines: [],
            status: 'error',
            error: message,
          });
        }
      }

      // Letter cuts on current picks using grid also-has prices, boosted when
      // the destination also stocks the other list.
      const planLines = [];
      for (const [wantKey, sellerKey] of Object.entries(wizard.gridPicks)) {
        const cell = wizardGrid.cells.get(cellMapKey(wantKey, sellerKey));
        const row = wizardGrid.rows.find(r => r.wantKey === wantKey);
        if (!cell || !row) continue;
        planLines.push({
          articleId: cell.articleId,
          name: row.cardName,
          amount: cell.amount,
          unitPrice: cell.unitPrice,
          sellerId: sellerKey,
          sellerName: wizardGrid.columns.find(c => c.sellerKey === sellerKey)?.sellerName,
        });
      }
      const estimateShip = (sellerId: string, cardCount: number, goodsTotal: number) => {
        const col = wizardGrid.columns.find(c => c.sellerKey === sellerId);
        if (!col || cardCount <= 0) return 0;
        const pref = shipPrefs[col.sellerName.toLowerCase()];
        const requireTracked = pref?.requireTracked === true;
        const loc = sellerLocationByName.get(col.sellerName.toLowerCase());
        const fromId = countryId(loc);
        const matrix = fromId != null ? shipping.matrices[fromId] : undefined;
        if (!matrix?.length) {
          return wizardColumnStats.get(sellerId)?.ship ?? col.wizardShip ?? 0;
        }
        return (
          estimateShipping(matrix, cardCount, goodsTotal, { requireTracked })?.method.price ?? 0
        );
      };
      const planEstimate = (sellerId: string, cardCount: number, goodsTotal: number) => {
        const price = estimateShip(sellerId, cardCount, goodsTotal);
        return price > 0 ? { price, methodName: 'estimate' } : undefined;
      };
      const plan = buildPurchasePlanFromCart(planLines, planEstimate);
      const offersBySeller = new Map<
        string,
        Map<string, { unitPrice: number; articleIds: string[]; maxQty: number }>
      >();
      for (const col of wizardGrid.columns) {
        const lines = [];
        for (const row of wizardGrid.rows) {
          const cell = wizardGrid.cells.get(cellMapKey(row.wantKey, col.sellerKey));
          if (!cell) continue;
          lines.push({
            wantKey: row.wantKey,
            unitPrice: cell.unitPrice,
            articleId: cell.articleId,
            quantity: Math.max(1, cell.amount),
          });
        }
        if (lines.length > 0) offersBySeller.set(col.sellerKey, offersMapFromLines(lines));
      }
      const moves =
        plan.planTrust !== 'INCOMPLETE' && plan.sellers.length >= 2
          ? findAllBeneficialOneWantMoves({ plan, offersBySeller, estimateShip })
          : [];

      hits.sort((a, b) => {
        if (a.inPicks !== b.inPicks) return a.inPicks ? -1 : 1;
        return b.matchCount - a.matchCount || a.goods - b.goods;
      });

      setCrossListQtyByKey(prev => {
        const next = new Map(prev);
        for (const w of otherWants) {
          next.set(
            w.wantKey,
            w.quantityStatus === 'KNOWN' ? Math.max(1, w.quantity) : 1,
          );
        }
        return next;
      });

      let addedCells = 0;
      const nextAlso: Record<string, WizardAlsoState> = { ...wizardAlsoRef.current };
      for (const [sellerKey, lines] of gridAlsoBySeller) {
        if (lines.length === 0) continue;
        const cur = nextAlso[sellerKey];
        const existing = cur?.status === 'done' ? cur.lines : [];
        const byArticle = new Map<string, WizardAlsoLine>();
        for (const l of existing) {
          if (l.articleId) byArticle.set(l.articleId, l);
        }
        for (const l of lines) {
          if (!l.articleId) continue;
          const prior = byArticle.get(l.articleId);
          if (!prior || l.price < prior.price) {
            if (!prior) addedCells++;
            byArticle.set(l.articleId, l);
          }
        }
        nextAlso[sellerKey] = { lines: [...byArticle.values()], status: 'done' };
      }
      setWizardAlso(nextAlso);

      const addedCards = new Set(
        [...gridAlsoBySeller.values()].flatMap(lines => lines.map(l => l.wantKey)),
      ).size;

      setCrossList({
        applyMsg:
          addedCards > 0
            ? `Added ${addedCards} card${addedCards === 1 ? '' : 's'} from “${listName}” to the grid (${addedCells} price${addedCells === 1 ? '' : 's'}) — click to pick, then Confirm.`
            : `No stock for “${listName}” on these sellers.`,
        error: null,
        hits,
        listName,
        moves,
        progress: null,
        status: 'done',
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setCrossList(cur => ({
        ...cur,
        error: err instanceof Error ? err.message : String(err),
        hits,
        listName,
        progress: null,
        status: 'error',
      }));
    }
  };

  const applyCrossListMove = (move: ConsolidationMoveResult) => {
    const cell = wizardGrid.cells.get(cellMapKey(move.wantKey, move.toSellerId));
    if (!cell) {
      setCrossList(cur => ({
        ...cur,
        applyMsg: 'Destination cell missing — run Also-on-list, then scan again.',
      }));
      return;
    }
    setWizard(cur => ({
      ...cur,
      gridPicks: { ...cur.gridPicks, [move.wantKey]: move.toSellerId },
    }));
    setCrossList(cur => ({
      ...cur,
      applyMsg: `Moved pick to ${
        wizardGrid.columns.find(c => c.sellerKey === move.toSellerId)?.sellerName ?? 'seller'
      }. Confirm to cart when ready.`,
      moves: cur.moves.filter(m => crossMoveKey(m) !== crossMoveKey(move)),
    }));
  };

  const loadWizardAlso = async (
    sellerName: string,
    sellerUrl: string | undefined,
    index: number,
    opts: { fromBatch?: boolean } = {},
  ) => {
    if (!sellerUrl) return;
    const key = wizardSellerKey(sellerName, sellerUrl, index);
    const wizardIds = new Set(
      wizard.results?.sellers[index]?.articles.map(a => a.articleId) ?? [],
    );
    setWizardAlso(prev => ({
      ...prev,
      [key]: { lines: [], status: 'loading' },
    }));
    try {
      const { offers, requireTracked } = await fetchSellerListOffers(
        sellerUrl,
        wantListId,
        () => {},
      );
      const countryFromOffers = offers.find(o => o.sellerCountry)?.sellerCountry;
      void sellerShipPrefsStore.note(sellerName, {
        ...(countryFromOffers ? { country: countryFromOffers } : {}),
        ...(requireTracked ? { requireTracked: true } : {}),
      });
      const imageByArticle = new Map<string, string>();
      for (const o of offers) {
        if (o.articleId && o.imageUrl) imageByArticle.set(o.articleId, o.imageUrl);
      }
      const lines = offers
        .map(offerLine)
        .filter((o): o is SellerOfferLine => !!o && !!o.articleId);
      const pricedAlso = priceSellerOffers({
        sellerId: key,
        sellerName,
        wantListId,
        wants,
        offers: lines,
      });
      const extraLines: SellerOfferLine[] = [];
      const seen = new Set<string>();
      // Wizard-plan articles first — backfill condition / language / edition on
      // default cells even when a cheaper copy exists on the same seller.
      for (const o of lines) {
        if (!o.articleId || !wizardIds.has(o.articleId) || seen.has(o.articleId)) continue;
        seen.add(o.articleId);
        extraLines.push(o);
      }
      for (const line of [...pricedAlso.matched, ...pricedAlso.partial]) {
        for (const slice of line.selectedOffers) {
          if (!slice.articleId || seen.has(slice.articleId)) continue;
          seen.add(slice.articleId);
          extraLines.push({
            articleId: slice.articleId,
            name: line.cardName,
            price: slice.unitPrice,
            quantity: slice.quantity,
            condition: slice.condition,
            language: slice.language,
            foil: slice.foil,
            printing: slice.printing,
            imageUrl:
              imageByArticle.get(slice.articleId) ??
              lines.find(l => l.articleId === slice.articleId)?.imageUrl,
          });
        }
      }
      const map = knownPriceStore.getSnapshot();
      const compared = extraLines.map(l => compareAlsoLine(map, wantListId, key, l));
      await knownPriceStore.note(observationsFromResult(pricedAlso));
      setWizardAlso(prev => ({
        ...prev,
        [key]: { lines: compared, status: 'done' },
      }));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : String(err);
      if (needsVerification(message)) {
        setWizardAlso(prev => ({
          ...prev,
          [key]: { lines: [], status: 'idle' },
        }));
        if (opts.fromBatch) throw err;
        const results = wizardRef.current.results;
        if (results) {
          const pending = results.sellers
            .map((s, i) => ({ name: s.name, url: s.url, i }))
            .filter((t): t is { name: string; url: string; i: number } => !!t.url)
            .filter(t => {
              const k = wizardSellerKey(t.name, t.url, t.i);
              return wizardAlsoRef.current[k]?.status !== 'done';
            });
          await pauseAlsoAllForChallenge(
            message,
            pending,
            results.sellers.filter(s => s.url).length,
          );
        } else {
          await yieldToChallenge(message);
        }
        return;
      }
      setWizardAlso(prev => ({
        ...prev,
        [key]: {
          error: message,
          lines: [],
          status: 'error',
        },
      }));
    }
  };

  const pauseAlsoAllForChallenge = async (
    reason: string,
    pending: { i: number; name: string; url: string }[],
    total: number,
  ) => {
    const results = wizardRef.current.results;
    if (!results) return;
    const alsoDone: WizardAlsoAllResumeJob['alsoDone'] = {};
    for (const [k, v] of Object.entries(wizardAlsoRef.current)) {
      if (v.status === 'done') {
        alsoDone[k] = { lines: v.lines, status: 'done' };
      }
    }
    alsoAllAbort.current?.abort();
    setAlsoAll({ current: Math.max(0, total - pending.length), status: 'paused', total });
    setWizard(cur => ({
      ...cur,
      message:
        'Paused for Cardmarket captcha — clear the check on the page, then reopen Lugin to continue Also-on-list.',
    }));
    await saveChallengeResume(reason, {
      type: 'wizardAlsoAll',
      wantListId,
      tab: 'wantlists',
      results,
      gridPicks: { ...wizardRef.current.gridPicks },
      alsoDone,
      pending,
      alsoAllTotal: total,
    });
    await yieldToChallenge(reason);
  };

  const runAlsoAllTargets = async (
    targets: { i: number; name: string; url: string }[],
    total: number,
  ) => {
    if (targets.length === 0) {
      setAlsoAll({ current: total, status: 'done', total });
      await clearChallengeResume();
      return;
    }
    alsoAllAbort.current?.abort();
    const ac = new AbortController();
    alsoAllAbort.current = ac;
    const doneBefore = total - targets.length;
    setAlsoAll({ current: doneBefore, status: 'running', total });
    for (let n = 0; n < targets.length; n++) {
      if (ac.signal.aborted) return;
      const t = targets[n];
      setAlsoAll({ current: doneBefore + n + 1, status: 'running', total });
      const key = wizardSellerKey(t.name, t.url, t.i);
      const cur = wizardAlsoRef.current[key];
      if (cur?.status === 'done' || cur?.status === 'loading') continue;
      try {
        await loadWizardAlso(t.name, t.url, t.i, { fromBatch: true });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message = err instanceof Error ? err.message : String(err);
        if (needsVerification(message)) {
          const pending = targets.slice(n);
          await pauseAlsoAllForChallenge(message, pending, total);
          return;
        }
      }
    }
    if (!ac.signal.aborted) {
      setAlsoAll({ current: total, status: 'done', total });
      await clearChallengeResume();
      setWizard(cur => ({
        ...cur,
        message: cur.message?.includes('captcha')
          ? `Also-on-list finished · ${total} seller${total === 1 ? '' : 's'}`
          : cur.message,
      }));
    }
  };

  const loadWizardAlsoAll = async () => {
    const results = wizard.results;
    if (!results) return;
    const targets = results.sellers
      .map((s, i) => ({ name: s.name, url: s.url, i }))
      .filter((t): t is { name: string; url: string; i: number } => !!t.url)
      .filter(t => {
        const key = wizardSellerKey(t.name, t.url, t.i);
        const cur = wizardAlsoRef.current[key];
        return cur?.status !== 'done';
      });
    if (targets.length === 0) {
      setAlsoAll({
        current: results.sellers.filter(s => s.url).length,
        status: 'done',
        total: results.sellers.filter(s => s.url).length,
      });
      return;
    }
    const total = results.sellers.filter(s => s.url).length;
    await runAlsoAllTargets(targets, total);
  };

  /**
   * Find the cheapest product-page seller for this card who is not already a
   * grid column, add their column, then pull their want-list also-has offers.
   */
  const addNextCheapest = async (row: WizardGridRow) => {
    if (nextCheap[row.wantKey]?.status === 'loading') return;
    setNextCheap(prev => ({ ...prev, [row.wantKey]: { status: 'loading' } }));
    try {
      const ids = await findProductForCard(row.cardName);
      if (!ids?.idProduct) {
        throw new Error('Could not find this card on Cardmarket');
      }
      const productUrl = `/${currentLang()}/Magic/Products?idProduct=${encodeURIComponent(ids.idProduct)}`;
      const { doc } = await fetchDoc(productUrl);
      const offers = parseOffers(doc.body, {
        allowNameFallback: false,
        defaultName: row.cardName,
      })
        .filter(
          (o): o is ParsedOffer & { seller: string; priceValue: number; sellerUrl: string } =>
            !!o.seller &&
            !!o.sellerUrl &&
            o.priceValue != null &&
            Number.isFinite(o.priceValue) &&
            o.priceValue > 0 &&
            !!o.articleId,
        )
        .sort((a, b) => a.priceValue - b.priceValue);

      const results = wizardRef.current.results;
      const knownCols: { sellerName: string; sellerUrl?: string }[] = [
        ...(results?.sellers.map((s, i) => ({
          sellerName: s.name,
          sellerUrl: s.url,
          sellerKey: wizardSellerKey(s.name, s.url, i),
        })) ?? []),
        ...extraColumnsRef.current,
      ];

      const next = offers.find(
        o => !knownCols.some(c => sameGridSeller(c, o.seller, o.sellerUrl)),
      );
      if (!next) {
        setNextCheap(prev => ({
          ...prev,
          [row.wantKey]: {
            status: 'error',
            error: 'No further sellers on the product page (all cheapest already in the grid)',
          },
        }));
        return;
      }

      const profileUrl = sellerProfileBase(next.sellerUrl);
      extraSeq.current += 1;
      const sellerKey = wizardSellerKey(next.seller, profileUrl, `x${extraSeq.current}`);
      const wantBuy = wantQtyByKey.get(row.wantKey) ?? 1;
      const available = Math.max(1, next.quantity ?? 1);
      const buyAmount = Math.min(wantBuy, available);
      const seedLine: WizardAlsoLine = {
        articleId: next.articleId,
        name: row.cardName,
        price: next.priceValue,
        quantity: buyAmount,
        condition: next.condition,
        language: next.language,
        foil: next.isFoil,
        printing: next.edition,
        imageUrl: next.imageUrl ?? row.imageUrl,
        wantKey: row.wantKey,
      };

      void sellerShipPrefsStore.note(next.seller, {
        ...(next.sellerCountry ? { country: next.sellerCountry } : {}),
      });

      setExtraColumns(prev => [
        ...prev,
        {
          sellerKey,
          sellerName: next.seller,
          sellerUrl: profileUrl,
          wizardCardCount: 0,
          wizardGoods: 0,
        },
      ]);
      setWizardAlso(prev => ({
        ...prev,
        [sellerKey]: { lines: [seedLine], status: 'loading' },
      }));

      try {
        const { offers: listOffers, requireTracked } = await fetchSellerListOffers(
          profileUrl,
          wantListId,
          () => {},
        );
        const countryFromOffers = listOffers.find(o => o.sellerCountry)?.sellerCountry;
        void sellerShipPrefsStore.note(next.seller, {
          ...(countryFromOffers || next.sellerCountry
            ? { country: countryFromOffers ?? next.sellerCountry }
            : {}),
          ...(requireTracked ? { requireTracked: true } : {}),
        });
        const imageByArticle = new Map<string, string>();
        for (const o of listOffers) {
          if (o.articleId && o.imageUrl) imageByArticle.set(o.articleId, o.imageUrl);
        }
        const lines = listOffers
          .map(offerLine)
          .filter((o): o is SellerOfferLine => !!o && !!o.articleId);
        const pricedAlso = priceSellerOffers({
          sellerId: sellerKey,
          sellerName: next.seller,
          wantListId,
          wants,
          offers: lines,
        });
        const extraLines: SellerOfferLine[] = [];
        const seen = new Set<string>(
          seedLine.articleId ? [seedLine.articleId] : [],
        );
        for (const line of [...pricedAlso.matched, ...pricedAlso.partial]) {
          for (const slice of line.selectedOffers) {
            if (!slice.articleId || seen.has(slice.articleId)) continue;
            seen.add(slice.articleId);
            extraLines.push({
              articleId: slice.articleId,
              name: line.cardName,
              price: slice.unitPrice,
              quantity: slice.quantity,
              condition: slice.condition,
              language: slice.language,
              foil: slice.foil,
              printing: slice.printing,
              imageUrl:
                imageByArticle.get(slice.articleId) ??
                lines.find(l => l.articleId === slice.articleId)?.imageUrl,
            });
          }
        }
        const map = knownPriceStore.getSnapshot();
        const compared = [
          seedLine,
          ...extraLines.map(l => compareAlsoLine(map, wantListId, sellerKey, l)),
        ];
        // Prefer list-priced seed if present under another article.
        await knownPriceStore.note(observationsFromResult(pricedAlso));
        setWizardAlso(prev => ({
          ...prev,
          [sellerKey]: { lines: compared, status: 'done' },
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (needsVerification(message)) throw err;
        // Keep the seed cell even if also-has failed.
        setWizardAlso(prev => ({
          ...prev,
          [sellerKey]: { lines: [seedLine], status: 'done' },
        }));
      }

      setNextCheap(prev => ({ ...prev, [row.wantKey]: { status: 'done' } }));
      setWizard(cur => ({
        ...cur,
        message: `Added ${next.seller} @ ${fmtEuro(next.priceValue)} for ${row.cardName}`,
      }));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : String(err);
      if (needsVerification(message)) {
        setNextCheap(prev => ({ ...prev, [row.wantKey]: { status: 'idle' } }));
        await yieldToChallenge(message);
        return;
      }
      setNextCheap(prev => ({
        ...prev,
        [row.wantKey]: { status: 'error', error: message },
      }));
    }
  };

  const tryResumeAlsoAll = async () => {
    if (alsoAllResuming.current) return;
    const peeked = await peekChallengeResume();
    if (!peeked || peeked.job.type !== 'wizardAlsoAll') return;
    if (peeked.job.wantListId !== wantListId) return;
    alsoAllResuming.current = true;
    try {
      const job = peeked.job;
      // Restore wizard plan + completed also-has, then continue pending.
      const restoredAlso: Record<string, WizardAlsoState> = {};
      for (const [k, v] of Object.entries(job.alsoDone)) {
        restoredAlso[k] = {
          lines: v.lines as WizardAlsoState['lines'],
          status: 'done',
        };
      }
      setWizardAlso(restoredAlso);
      setWizard({
        cartStatus: 'idle',
        error: null,
        gridPicks: job.gridPicks,
        message: 'Resuming Also-on-list after captcha…',
        progress: 100,
        results: job.results,
        status: 'done',
      });
      await clearChallengeResume();
      await runAlsoAllTargets(job.pending, job.alsoAllTotal);
    } finally {
      alsoAllResuming.current = false;
    }
  };

  useEffect(() => {
    void hydrateChallengeResume().then(() => {
      void tryResumeAlsoAll();
    });
    const onRestored = () => {
      void tryResumeAlsoAll();
    };
    window.addEventListener(OVERLAY_RESTORED_EVENT, onRestored);
    return () => window.removeEventListener(OVERLAY_RESTORED_EVENT, onRestored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantListId]);

  useEffect(() => {
    if (!autoLoad) return;
    void loadSellers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad, wantListId]);

  const attachShipping = (
    result: SellerWantPricingResult,
    location?: string,
  ): SellerWantPricingResult => {
    const fromId = countryId(location);
    const matrix = fromId != null ? shipping.matrices[fromId] : undefined;
    if (!matrix || result.quantityFulfilled <= 0) return result;
    const est = estimateShipping(matrix, result.quantityFulfilled, result.goodsTotal);
    if (!est) return result;
    const shippingCtx = {
      estimatedPrice: est.method.price,
      methodName: est.method.name,
      weight: est.weight,
      tierMaxCards: est.tierMaxCards,
      nextTierMaxCards: est.nextTierMaxCards,
      remainingWeightInTier: est.remainingWeightInTier,
      isEstimate: true as const,
    };
    return {
      ...result,
      shipping: shippingCtx,
      estimatedDeliveredTotal: result.goodsTotal + est.method.price,
    };
  };

  const consolidationsFor = (
    result: SellerWantPricingResult,
    location?: string,
  ): ConsolidationMoveResult[] => {
    if (purchasePlan.planTrust === 'INCOMPLETE' || purchasePlan.sellers.length === 0) return [];
    const toOffers = new Map<
      string,
      { unitPrice: number; articleIds: string[]; maxQty: number }
    >();
    for (const line of [...result.matched, ...result.partial]) {
      toOffers.set(line.wantKey, {
        unitPrice: line.unitPrice,
        articleIds: line.articleIds,
        maxQty: line.availableQty,
      });
    }
    const fromId = countryId(location);
    const matrix = fromId != null ? shipping.matrices[fromId] : undefined;
    const estimateShip = (sellerId: string, cardCount: number, goodsTotal: number) => {
      // Prefer destination seller's matrix when estimating destination; for
      // source sellers reuse cart country matrices via plan builder path.
      const item = cart.items.find(i => i.sellerId === sellerId);
      const sid = countryId(item?.sellerCountry) ?? (sellerId === result.sellerId ? fromId : null);
      const m = sid != null ? shipping.matrices[sid] : matrix;
      if (!m?.length || cardCount <= 0) return undefined;
      return estimateShipping(m, cardCount, goodsTotal)?.method.price;
    };
    return findBeneficialOneWantMoves({
      plan: purchasePlan,
      toSellerId: result.sellerId,
      toOffers,
      estimateShip,
    });
  };

  const finalizeResult = (
    result: SellerWantPricingResult,
    location?: string,
  ): { result: SellerWantPricingResult; consolidations: ConsolidationMoveResult[] } => {
    let next = attachShipping(result, location);
    next = annotateWithKnownCheapest(next, knownMap);
    const consolidations = consolidationsFor(next, location);
    return { result: next, consolidations };
  };

  const priceSeller = async (row: SellerWants) => {
    const key = cacheKey(row.idSeller, wantListId, fingerprint);
    const cached = priceCache.get(key);
    if (cached && Date.now() - cached.at < PRICE_CACHE_TTL_MS) {
      const { result: withShip, consolidations } = finalizeResult(cached.result, row.location);
      const selectedKeys = new Set(
        [...withShip.matched, ...withShip.partial].map(l => l.wantKey),
      );
      setPriced(p => ({
        ...p,
        [row.idSeller]: {
          cartStatus: 'idle',
          consolidations,
          result: withShip,
          selectedKeys,
          status: 'done',
        },
      }));
      setExpanded(row.idSeller);
      if (flags.devTools) {
        console.debug('[lugin:best-sellers] cache hit', {
          sellerId: row.idSeller,
          wantListId,
          matched: withShip.matched.length,
          partial: withShip.partial.length,
          missing: withShip.missing.length,
        });
      }
      return;
    }

    priceAborts.current.get(row.idSeller)?.abort();
    const controller = new AbortController();
    priceAborts.current.set(row.idSeller, controller);
    setPriced(p => ({ ...p, [row.idSeller]: { status: 'loading' } }));
    const t0 = performance.now();
    try {
      const { offers } = await fetchSellerListOffers(
        row.url,
        wantListId,
        () => {},
        controller.signal,
      );
      const lines = offers.map(offerLine).filter((o): o is SellerOfferLine => !!o);
      let result = priceSellerOffers({
        sellerId: row.idSeller,
        sellerName: row.name,
        wantListId,
        wants,
        offers: lines,
      });
      priceCache.set(key, { at: Date.now(), result });
      void knownPriceStore.note(observationsFromResult(result));
      const finalized = finalizeResult(result, row.location);
      result = finalized.result;
      const selectedKeys = new Set([...result.matched, ...result.partial].map(l => l.wantKey));
      setPriced(p => ({
        ...p,
        [row.idSeller]: {
          cartStatus: 'idle',
          consolidations: finalized.consolidations,
          result,
          selectedKeys,
          status: 'done',
        },
      }));
      setExpanded(row.idSeller);
      if (flags.devTools) {
        console.debug('[lugin:best-sellers] priced', {
          sellerId: row.idSeller,
          wantListId,
          ms: Math.round(performance.now() - t0),
          matched: result.matched.length,
          partial: result.partial.length,
          missing: result.missing.length,
          goods: result.goodsTotal,
          ship: result.shipping?.estimatedPrice,
          consolidations: finalized.consolidations.length,
          planTrust: purchasePlan.planTrust,
        });
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setPriced(p => ({
        ...p,
        [row.idSeller]: {
          error: err instanceof Error ? err.message : String(err),
          status: 'error',
        },
      }));
    } finally {
      priceAborts.current.delete(row.idSeller);
    }
  };

  const toggleKey = (sellerId: string, wantKey: string) => {
    setPriced(prev => {
      const cur = prev[sellerId];
      if (!cur?.result) return prev;
      const next = new Set(cur.selectedKeys ?? []);
      if (next.has(wantKey)) next.delete(wantKey);
      else next.add(wantKey);
      return { ...prev, [sellerId]: { ...cur, selectedKeys: next } };
    });
  };

  const addArticles = async (row: SellerWants, articleIds: string[]) => {
    if (articleIds.length === 0) return;
    setPriced(prev => ({
      ...prev,
      [row.idSeller]: { ...prev[row.idSeller]!, cartStatus: 'adding', cartError: undefined },
    }));
    try {
      let added = 0;
      for (const articleId of articleIds) {
        const attempt = async () => {
          const token = await cmToken();
          if (!token) return { message: 'Not signed in', ok: false as const };
          rememberWriteToken(token);
          return addArticleToCart(articleId, token);
        };
        let r = await attempt();
        if (!r.ok && /could not be completed|session|token|csrf|sign in/i.test(r.message)) {
          clearCachedTokens();
          r = await attempt();
        }
        if (!r.ok && /not signed in/i.test(r.message)) {
          askForLogin();
          throw new Error(r.message);
        }
        if (r.ok) added++;
        await new Promise(done => setTimeout(done, 350 + Math.random() * 350));
      }
      await cartStore.refresh();
      if (added === 0) throw new Error('Cardmarket refused every add.');
      setPriced(prev => ({
        ...prev,
        [row.idSeller]: {
          ...prev[row.idSeller]!,
          cartError:
            added < articleIds.length
              ? `Added ${added} of ${articleIds.length} — some offers were refused. Remove any old copies from the other seller on Cardmarket.`
              : 'Added. If replacing a cart line, remove the old copy from the other seller on Cardmarket.',
          cartStatus: 'done',
        },
      }));
    } catch (err) {
      setPriced(prev => ({
        ...prev,
        [row.idSeller]: {
          ...prev[row.idSeller]!,
          cartError: err instanceof Error ? err.message : String(err),
          cartStatus: 'error',
        },
      }));
    }
  };

  const addAllToCart = async (row: SellerWants) => {
    const p = priced[row.idSeller];
    if (!p?.result || !p.selectedKeys) return;
    const { articleIds } = goodsTotalForSelection(p.result, p.selectedKeys);
    if (articleIds.length === 0) return;
    await addArticles(row, articleIds);
  };

  const addOneLine = async (row: SellerWants, line: SellerWantLine) => {
    if (line.articleIds.length === 0) return;
    await addArticles(row, line.articleIds);
  };

  const applyConsolidation = async (row: SellerWants, move: ConsolidationMoveResult) => {
    const p = priced[row.idSeller];
    const line = [...(p?.result?.matched ?? []), ...(p?.result?.partial ?? [])].find(
      l => l.wantKey === move.wantKey,
    );
    if (!line) return;
    const ids = line.articleIds.slice(0, move.quantityMoved);
    await addArticles(row, ids);
  };

  const unknownQtyCount = wants.filter(w => w.quantityStatus === 'UNKNOWN').length;
  const consolidationSummary = useMemo(() => {
    const all = Object.values(priced).flatMap(p => p.consolidations ?? []);
    return summarizeMoves(all);
  }, [priced]);

  return (
    <div
      className={`flex min-h-0 flex-col border-b border-line text-2xs ${
        wizard.results && wizardGrid.columns.length > 0
          ? 'flex-1 overflow-hidden'
          : 'flex-none'
      }`}
    >
      <div className="flex-none px-2 pt-2">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{heading ?? 'Best sellers for this list'}</span>
        <Button
          disabled={wizard.status === 'running' || listCards.size === 0}
          onClick={() => void runWizard()}
          size="xs"
          title="Run Cardmarket Shopping Wizard — builds a plan you can add from selectively"
          variant="success"
        >
          {wizard.status === 'running'
            ? `Wizard…${wizard.progress != null ? ` ${wizard.progress}%` : ''}`
            : 'Run wizard'}
        </Button>
        {sellers.status === 'idle' && (
          <Button onClick={() => void loadSellers()} size="xs" variant="neutral">
            Rank sellers
          </Button>
        )}
        {sellers.status === 'loading' && <span className="text-ink-muted">Ranking…</span>}
        {sellers.status === 'done' && (
          <Button onClick={() => void loadSellers()} size="xs" variant="neutral">
            Refresh
          </Button>
        )}
        {unknownQtyCount > 0 && (
          <span className="text-warn" title="Re-sync want lists to read Cardmarket amounts">
            {unknownQtyCount} want{unknownQtyCount === 1 ? '' : 's'} qty unknown
          </span>
        )}
      </div>

      {wizard.status === 'done' && wizard.results && (
        <p className="mb-1 rounded border border-pos/30 bg-pos/5 px-1.5 py-1 font-medium text-pos">
          {wizardPickSummary.picks === 0 ? (
            <>No cells selected — click prices after Also-on-list, then Confirm</>
          ) : (
            <>
              To cart · {wizardPickSummary.articles} article
              {wizardPickSummary.articles === 1 ? '' : 's'} ·{' '}
              {wizardPickSummary.shipments} shipment
              {wizardPickSummary.shipments === 1 ? '' : 's'} ·{' '}
              {wizardPickSummary.total != null ? (
                <>
                  {fmtEuro(wizardPickSummary.total)}
                  {wizardPickSummary.totalDelta != null &&
                    Math.abs(wizardPickSummary.totalDelta) > 0.001 && (
                      <span
                        className={
                          wizardPickSummary.totalDelta > 0 ? 'text-neg' : 'text-pos'
                        }
                      >
                        {' '}
                        ({fmtDelta(wizardPickSummary.totalDelta)} vs wizard
                        {wizardPickSummary.wizardTotal != null
                          ? ` ${fmtEuro(wizardPickSummary.wizardTotal)}`
                          : ''}
                        )
                      </span>
                    )}
                </>
              ) : (
                <>
                  goods {fmtEuro(wizardPickSummary.goods)}
                  {wizardPickSummary.ship == null ? ' + ship ?' : ''}
                </>
              )}
            </>
          )}
        </p>
      )}
      {wizard.message &&
        wizard.message !== 'Plan ready — pick cells, then Confirm' && (
          <p className="mb-1 rounded border border-pos/30 bg-pos/5 px-1.5 py-1 text-pos">
            {wizard.message}
          </p>
        )}
      {wizard.error && <p className="mb-1.5 text-neg">{wizard.error}</p>}
      </div>
      {wizard.results && wizardGrid.columns.length > 0 && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-2">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-line/80 bg-panel/30">
          <div className="flex flex-none flex-wrap items-center gap-1.5 border-b border-line/60 px-1.5 py-1">
            <span className="font-medium text-ink">
              Price grid ({wizardGrid.columns.length} seller
              {wizardGrid.columns.length === 1 ? '' : 's'} · {wizardGrid.rows.length} card
              {wizardGrid.rows.length === 1 ? '' : 's'})
            </span>
            {wizard.results.total != null && (
              <span className="text-ink-muted">Wizard {fmtEuro(wizard.results.total)}</span>
            )}
            {wizard.results.sellers.some(s => !!s.url) && (
              <Button
                disabled={alsoAll.status === 'running' || wizard.cartStatus === 'adding'}
                onClick={() => void loadWizardAlsoAll()}
                size="sm"
                title="Fetch every wizard seller’s prices for this want list so you can compare and pick"
                variant="primary"
              >
                {alsoAll.status === 'running'
                  ? `Also-has… (${alsoAll.current}/${alsoAll.total})`
                  : alsoAll.status === 'paused'
                    ? `Paused captcha — resume (${alsoAll.current}/${alsoAll.total})`
                    : alsoAll.status === 'done'
                      ? 'Also on list (all) ✓'
                      : 'Also on list (all)'}
              </Button>
            )}
            <Button
              disabled={wizard.cartStatus === 'adding'}
              onClick={() =>
                setWizard(cur => ({
                  ...cur,
                  gridPicks: { ...wizardGrid.defaultPicks },
                }))
              }
              size="xs"
              variant="neutral"
            >
              Reset to wizard
            </Button>
            <Button
              disabled={wizard.cartStatus === 'adding'}
              onClick={() => setWizard(cur => ({ ...cur, gridPicks: {} }))}
              size="xs"
              variant="neutral"
            >
              Clear picks
            </Button>
            <Button
              disabled={
                wizard.cartStatus === 'adding' || Object.keys(wizard.gridPicks).length === 0
              }
              onClick={() => void confirmGridToCart()}
              size="xs"
              variant="success"
            >
              {wizard.cartStatus === 'adding'
                ? 'Adding…'
                : `Confirm to cart (${Object.keys(wizard.gridPicks).length})`}
            </Button>
          </div>
          {!gridSelectable && (
            <p className="flex-none px-1.5 text-ink-faint">
              Run Also on list (all) to fill other sellers’ prices — cells become clickable to
              change who you buy from. Confirm adds the current picks.
            </p>
          )}
          {gridSelectable && (
            <p className="flex-none px-1.5 text-ink-faint">
              Click a price to pick that seller for the card (one per row). Confirm adds only
              those picks.
            </p>
          )}
          <div className="min-h-0 flex-1 overflow-auto overscroll-none">
            <table className="min-w-full border-collapse text-left">
              <thead className="sticky top-0 z-30">
                <tr className="bg-raised shadow-sm">
                  <th className="sticky left-0 top-0 z-40 min-w-[11rem] max-w-[14rem] border-b border-r border-line/60 bg-raised px-1.5 py-1 font-medium text-ink">
                    Card
                  </th>
                  {wizardGrid.columns.map(col => {
                    const st = wizardColumnStats.get(col.sellerKey);
                    const empty = !st || st.cardCount <= 0;
                    const shipDelta = st?.shipDelta;
                    const showShipDelta =
                      shipDelta != null && Math.abs(shipDelta) > 0.001;
                    return (
                      <th
                        key={col.sellerKey}
                        className={`sticky top-0 z-30 min-w-[5.5rem] max-w-[8rem] border-b border-line/60 bg-raised px-1 py-1 align-top font-medium ${
                          empty ? 'text-ink-faint' : 'text-ink'
                        }`}
                      >
                        <div className="flex flex-col gap-0.5">
                          <span className="truncate" title={col.sellerName}>
                            {col.sellerName}
                          </span>
                          {st && !empty && (
                            <>
                              <span className="font-normal text-ink-muted">
                                {st.cardCount} card{st.cardCount === 1 ? '' : 's'} ·{' '}
                                {fmtEuro(st.goods)}
                              </span>
                              <span
                                className={`font-normal ${
                                  showShipDelta
                                    ? shipDelta! > 0
                                      ? 'text-neg'
                                      : 'text-pos'
                                    : 'text-ink-faint'
                                }`}
                                title={
                                  st.shipKind === 'estimate'
                                    ? `${st.methodName ?? 'Estimated shipping'}${
                                        st.trackedOnly ? ' (tracked)' : ''
                                      }`
                                    : st.shipKind === 'wizard'
                                      ? st.shipApprox
                                        ? 'Wizard shipping — pick size changed; country needed for a fresh estimate'
                                        : 'Wizard shipping'
                                      : 'Shipping unknown — need seller country (rank sellers or open their stock)'
                                }
                              >
                                {st.ship != null ? (
                                  <>
                                    ship {fmtEuro(st.ship)}
                                    {st.shipKind === 'estimate' ? ' ≈' : ''}
                                    {st.shipApprox ? ' ~' : ''}
                                    {st.trackedOnly ? ' ⌖' : ''}
                                    {showShipDelta ? ` (${fmtDelta(shipDelta!)})` : ''}
                                  </>
                                ) : (
                                  'ship ?'
                                )}
                              </span>
                              {st.total != null && (
                                <span className="font-normal text-ink">
                                  Σ {fmtEuro(st.total)}
                                </span>
                              )}
                            </>
                          )}
                          {st && empty && (
                            <span
                              className={`font-normal ${
                                showShipDelta ? 'text-pos' : 'text-ink-faint'
                              }`}
                            >
                              {showShipDelta
                                ? `no cards · ship ${fmtDelta(shipDelta!)}`
                                : 'no cards'}
                            </span>
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {wizardGrid.rows.map((row, rowIndex) => {
                  let best = Infinity;
                  for (const col of wizardGrid.columns) {
                    const c = wizardGrid.cells.get(cellMapKey(row.wantKey, col.sellerKey));
                    if (c && c.unitPrice < best) best = c.unitPrice;
                  }
                  const pickedSeller = wizard.gridPicks[row.wantKey];
                  const otherListBreak =
                    row.fromOtherList &&
                    (rowIndex === 0 || !wizardGrid.rows[rowIndex - 1]?.fromOtherList);
                  return (
                    <Fragment key={row.wantKey}>
                      {otherListBreak && (
                        <tr className="border-t-2 border-accent/40">
                          <td
                            className="sticky left-0 z-10 bg-panel px-1.5 py-1 text-[10px] font-medium uppercase tracking-wide text-accent"
                            colSpan={wizardGrid.columns.length + 1}
                          >
                            Other want list
                          </td>
                        </tr>
                      )}
                    <tr className="border-t border-line/40">
                      <th className="sticky left-0 z-10 max-w-[14rem] border-r border-line/60 bg-panel px-1.5 py-0.5 font-normal text-ink">
                        <div className="flex flex-col items-stretch gap-0.5">
                          <WizardCardLabel
                            articleId={row.wantKey}
                            imageUrl={row.imageUrl}
                            name={row.cardName}
                          />
                          <Button
                            disabled={
                              nextCheap[row.wantKey]?.status === 'loading' ||
                              wizard.cartStatus === 'adding'
                            }
                            onClick={() => void addNextCheapest(row)}
                            size="xs"
                            title="Find the next-cheapest seller for this card who is not already in the grid, and add their column"
                            variant="neutral"
                          >
                            {nextCheap[row.wantKey]?.status === 'loading'
                              ? 'Finding…'
                              : 'Add next cheapest'}
                          </Button>
                          {nextCheap[row.wantKey]?.status === 'error' &&
                            nextCheap[row.wantKey]?.error && (
                              <span className="text-[10px] leading-tight text-neg">
                                {nextCheap[row.wantKey]?.error}
                              </span>
                            )}
                        </div>
                      </th>
                      {wizardGrid.columns.map(col => {
                        const cell = wizardGrid.cells.get(
                          cellMapKey(row.wantKey, col.sellerKey),
                        );
                        const selected = pickedSeller === col.sellerKey;
                        const isBest =
                          cell != null && Number.isFinite(best) && cell.unitPrice <= best + 0.001;
                        if (!cell) {
                          return (
                            <td
                              key={col.sellerKey}
                              className="px-1 py-0.5 text-center text-ink-faint"
                            >
                              —
                            </td>
                          );
                        }
                        const delta =
                          Number.isFinite(best) && cell.unitPrice > best + 0.001
                            ? cell.unitPrice - best
                            : 0;
                        const meta = fmtOfferMeta(cell);
                        const cellTitle = [
                          col.sellerName,
                          cell.edition,
                          meta,
                          selected ? 'selected' : null,
                        ]
                          .filter(Boolean)
                          .join(' · ');
                        const body = (
                          <>
                            <span className="block font-medium">{fmtEuro(cell.unitPrice)}</span>
                            <GridEditionIcon edition={cell.edition} />
                            {meta && (
                              <span className="block text-[10px] leading-tight text-ink-faint">
                                {meta}
                              </span>
                            )}
                            {cell.amount > 1 && (
                              <span className="block text-ink-faint">{cell.amount}×</span>
                            )}
                            {gridSelectable && delta > 0.001 && (
                              <span className="block text-ink-faint">{fmtDelta(delta)}</span>
                            )}
                          </>
                        );
                        const tone = selected
                          ? 'bg-accent/25 ring-1 ring-accent text-ink'
                          : isBest
                            ? 'text-pos'
                            : 'text-ink';
                        if (!gridSelectable) {
                          return (
                            <td key={col.sellerKey} className="p-0.5">
                              <div
                                className={`w-full rounded px-1 py-0.5 text-center ${tone}`}
                                title={
                                  selected
                                    ? `${cellTitle} — Confirm to cart, or run Also on list (all) to change`
                                    : cellTitle
                                }
                              >
                                {body}
                              </div>
                            </td>
                          );
                        }
                        return (
                          <td key={col.sellerKey} className="p-0.5">
                            <button
                              className={`w-full rounded px-1 py-0.5 text-center transition-colors ${tone} cursor-pointer hover:bg-raised/80`}
                              onClick={() => pickGridCell(row.wantKey, col.sellerKey)}
                              title={
                                selected
                                  ? `${cellTitle} — click to unselect`
                                  : `Buy from ${cellTitle}`
                              }
                              type="button"
                            >
                              {body}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          {Object.keys(wizard.gridPicks).length > 0 && (
            <div className="border-t border-line/60 px-1.5 py-1 text-ink-muted">
              Picks · goods {fmtEuro(wizardPickSummary.goods)}
              {wizardPickSummary.goodsDelta != null &&
                Math.abs(wizardPickSummary.goodsDelta) > 0.001 && (
                  <span
                    className={
                      wizardPickSummary.goodsDelta > 0 ? 'text-neg' : 'text-pos'
                    }
                  >
                    {' '}
                    ({fmtDelta(wizardPickSummary.goodsDelta)})
                  </span>
                )}
              {wizardPickSummary.ship != null ? (
                <>
                  {' · '}ship {fmtEuro(wizardPickSummary.ship)}
                  {wizardPickSummary.shipDelta != null &&
                    Math.abs(wizardPickSummary.shipDelta) > 0.001 && (
                      <span
                        className={
                          wizardPickSummary.shipDelta > 0 ? 'text-neg' : 'text-pos'
                        }
                      >
                        {' '}
                        ({fmtDelta(wizardPickSummary.shipDelta)} vs wizard)
                      </span>
                    )}
                </>
              ) : (
                ' · ship ?'
              )}
              {wizardPickSummary.total != null && (
                <>
                  {' · '}Σ {fmtEuro(wizardPickSummary.total)}
                  {wizardPickSummary.totalDelta != null &&
                    Math.abs(wizardPickSummary.totalDelta) > 0.001 && (
                      <span
                        className={
                          wizardPickSummary.totalDelta > 0 ? 'text-neg' : 'text-pos'
                        }
                      >
                        {' '}
                        ({fmtDelta(wizardPickSummary.totalDelta)})
                      </span>
                    )}
                </>
              )}
              {' · '}
              {wizardPickSummary.shipments} shipment
              {wizardPickSummary.shipments === 1 ? '' : 's'}
            </div>
          )}

          <div className="border-t border-line/60 pt-1.5">
            <div className="mb-1 font-medium text-ink">Other list on these sellers</div>
            <p className="mb-1.5 text-ink-muted">
              Probe loaded sellers for another want list — matches are added to the price grid so
              you can pick them (and fill shipments you’re already paying for).
            </p>
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              {otherListOptions.length > 0 ? (
                <Select
                  className="max-w-[12rem]"
                  onChange={e => setCrossListId(e.target.value)}
                  title="Want list to probe on loaded sellers"
                  value={crossListId}
                >
                  {otherListOptions.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <span className="text-warn">Need another synced want list.</span>
              )}
              <Button
                disabled={
                  !crossListId ||
                  crossList.status === 'scanning' ||
                  wizardGrid.columns.length === 0
                }
                onClick={() => void scanCrossList()}
                size="xs"
                variant="neutral"
              >
                {crossList.status === 'scanning' ? 'Scanning…' : 'Scan loaded sellers'}
              </Button>
              {crossList.status === 'scanning' && (
                <Button
                  onClick={() => crossListAbort.current?.abort()}
                  size="xs"
                  variant="subtle"
                >
                  Stop
                </Button>
              )}
            </div>
            {crossList.progress && <p className="text-ink-faint">{crossList.progress}</p>}
            {crossList.error && <p className="text-neg">{crossList.error}</p>}
            {crossList.applyMsg && <p className="text-warn">{crossList.applyMsg}</p>}

            {crossList.status === 'done' && crossList.hits.length === 0 && (
              <p className="text-ink-muted">No sellers to probe.</p>
            )}

            {crossList.status === 'done' && crossList.moves.length > 0 && (
              <div className="mb-1.5 space-y-1">
                <div className="text-ink-muted">
                  {(() => {
                    const removable = crossList.moves.filter(m => m.sourceSellerRemoved).length;
                    const save = summarizeMoves(crossList.moves);
                    return (
                      <>
                        {removable > 0
                          ? `${removable} letter-cut opportunit${removable === 1 ? 'y' : 'ies'}`
                          : `${crossList.moves.length} consolidat${
                              crossList.moves.length === 1 ? 'ion' : 'ions'
                            }`}
                        {save.estSave > 0 && <> · Est. save ~{fmtEuro(save.estSave)}</>}
                        {crossList.listName ? ` · vs “${crossList.listName}”` : ''}
                      </>
                    );
                  })()}
                </div>
                <ul className="max-h-40 space-y-1 overflow-y-auto overscroll-contain">
                  {crossList.moves.slice(0, 8).map(m => {
                    const toHit = crossList.hits.find(h => h.sellerKey === m.toSellerId);
                    const fromHit = crossList.hits.find(h => h.sellerKey === m.fromSellerId);
                    const fromName =
                      wizardGrid.columns.find(c => c.sellerKey === m.fromSellerId)?.sellerName ??
                      m.fromSellerId;
                    const toName =
                      wizardGrid.columns.find(c => c.sellerKey === m.toSellerId)?.sellerName ??
                      m.toSellerId;
                    return (
                      <li
                        key={crossMoveKey(m)}
                        className="rounded border border-pos/30 bg-pos/5 px-1.5 py-1"
                      >
                        <div className="font-medium text-pos">
                          {m.sourceSellerRemoved ? 'Remove a letter' : 'Goods / tier tweak'} ·
                          save ~{fmtEuro(-m.netDelta)}
                        </div>
                        <div className="text-ink-muted">
                          Move to {toName} instead of {fromName}
                          {toHit && toHit.matchCount > 0 && (
                            <>
                              {' '}
                              · {toName} also has {toHit.matchCount}/{toHit.wantCount} on “
                              {crossList.listName}” ({fmtEuro(toHit.goods)})
                            </>
                          )}
                          {fromHit && fromHit.matchCount > 0 && m.sourceSellerRemoved && (
                            <>
                              {' '}
                              · note: {fromName} stocks {fromHit.matchCount} on that list too
                            </>
                          )}
                        </div>
                        <Button
                          className="mt-1"
                          onClick={() => applyCrossListMove(m)}
                          size="xs"
                          variant="success"
                        >
                          Apply pick
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {crossList.hits.length > 0 && (
              <ul className="max-h-48 space-y-1 overflow-y-auto overscroll-contain">
                {crossList.hits.map(hit => {
                  const thinKeeper =
                    hit.inPicks && hit.pickCardCount <= 2 && hit.matchCount >= 3;
                  const fillShipment = hit.inPicks && hit.matchCount > 0;
                  return (
                    <li
                      key={hit.sellerKey}
                      className={`rounded border px-1.5 py-1 ${
                        fillShipment
                          ? 'border-pos/30 bg-pos/5'
                          : 'border-line/60 bg-raised/40'
                      }`}
                    >
                      <div className="flex flex-wrap items-baseline gap-x-1.5">
                        <span className="font-medium text-ink">{hit.sellerName}</span>
                        {hit.inPicks ? (
                          <span className="text-pos">
                            in picks · {hit.pickCardCount} card
                            {hit.pickCardCount === 1 ? '' : 's'}
                          </span>
                        ) : (
                          <span className="text-ink-faint">not in picks</span>
                        )}
                        {hit.status === 'error' ? (
                          <span className="text-neg">{hit.error ?? 'Failed'}</span>
                        ) : (
                          <span className="text-ink-muted">
                            {hit.matchCount}/{hit.wantCount} on “{crossList.listName}”
                            {hit.matchCount > 0 && <> · {fmtEuro(hit.goods)}</>}
                          </span>
                        )}
                      </div>
                      {thinKeeper && (
                        <div className="text-warn">
                          Thin on this list but strong on “{crossList.listName}” — shipment may
                          be worth keeping.
                        </div>
                      )}
                      {fillShipment && !thinKeeper && (
                        <div className="text-ink-muted">
                          Already shipping — can fill with “{crossList.listName}” without a new
                          letter.
                        </div>
                      )}
                      {hit.lines.length > 0 && (
                        <div className="mt-0.5 text-ink-faint">
                          {hit.lines
                            .slice(0, 4)
                            .map(
                              l =>
                                `${l.cardName} ${fmtEuro(l.unitPrice)}${
                                  l.chosenQty > 1 ? `×${l.chosenQty}` : ''
                                }`,
                            )
                            .join(' · ')}
                          {hit.lines.length > 4 ? ' …' : ''}
                          {' — in grid'}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          </div>
        </div>
        </div>
      )}
      {wizard.results && wizard.results.sellers.length === 0 && (
        <p className="mb-1.5 px-2 text-ink-muted">
          Wizard returned {wizard.results.articles.length} articles but no seller cards to show —{' '}
          <a
            className="text-accent underline"
            href={wizard.results.resultsUrl}
            rel="noreferrer"
            target="_blank"
          >
            open Results
          </a>
          .
        </p>
      )}

      <div className="flex-none space-y-1 overflow-y-auto overscroll-none px-2 pb-2">
      {consolidationSummary.count > 0 && purchasePlan.planTrust !== 'INCOMPLETE' && (
        <div className="mb-1.5 rounded border border-line/80 bg-panel/40 px-1.5 py-1 text-ink">
          <div className="font-medium">Lugin consolidation</div>
          <div className="text-ink-muted">
            {consolidationSummary.count} opportunit
            {consolidationSummary.count === 1 ? 'y' : 'ies'}
            {consolidationSummary.estSave > 0 && (
              <> · Est. save ~{fmtEuro(consolidationSummary.estSave)}</>
            )}
            {consolidationSummary.sellersRemovable > 0 && (
              <>
                {' '}
                · Potentially remove {consolidationSummary.sellersRemovable} shipment
                {consolidationSummary.sellersRemovable === 1 ? '' : 's'}
              </>
            )}
          </div>
          <div className="text-ink-faint">Expand a priced seller to review — nothing auto-applies.</div>
        </div>
      )}

      {flags.devTools && purchasePlan.sellers.length > 0 && (
        <details className="mb-1 text-ink-faint">
          <summary className="cursor-pointer">Plan debug ({purchasePlan.planTrust})</summary>
          <pre className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap">
            {purchasePlan.sellers
              .map(
                s =>
                  `${s.sellerName ?? s.sellerId}: ${s.cardCount} assigned · goods ${s.goodsTotal.toFixed(2)} · ship ${
                    s.shippingEstimate?.price?.toFixed(2) ?? '?'
                  }`,
              )
              .join('\n')}
          </pre>
        </details>
      )}

      {sellers.error && <p className="text-neg">{sellers.error}</p>}

      {sellers.status === 'done' && sellers.rows.length === 0 && (
        <p className="text-ink-muted">No sellers matched this want list filter.</p>
      )}

      {sellers.rows.length > 0 && (
        <div className="mt-1 max-h-[min(14rem,30vh)] space-y-1 overflow-y-auto overscroll-none">
          {[...sellers.rows]
            .sort((a, b) =>
              compareFavouriteFirst(
                favourites,
                a,
                b,
                row => ({ name: row.name, url: row.url }),
                (x, y) => y.count - x.count || x.name.localeCompare(y.name),
              ),
            )
            .map(row => {
              const p = priced[row.idSeller];
              const result = p?.result;
              const open = expanded === row.idSeller;
              const fav = isFavourite(row.url, row.name);
              const selection =
                result && p?.selectedKeys
                  ? goodsTotalForSelection(result, p.selectedKeys)
                  : undefined;
              const canCart =
                !!selection &&
                selection.articleIds.length > 0 &&
                p?.cartStatus !== 'adding';
              return (
                <div
                  key={row.idSeller}
                  className={`rounded border px-1.5 py-1 ${
                    fav ? 'border-accent/40 bg-accent-soft/40' : 'border-line/70'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      className="flex items-center gap-0.5 text-ink-muted"
                      onClick={() =>
                        setExpanded(cur => (cur === row.idSeller ? null : row.idSeller))
                      }
                      type="button"
                    >
                      {open ? <ChevronDown /> : <ChevronRight />}
                    </button>
                    <FavouriteSellerControl
                      active={fav}
                      name={row.name}
                      onToggle={() => void toggleFavourite(row.url, row.name)}
                    />
                    <SellerNameButton
                      name={row.name}
                      url={row.url}
                      wantListId={wantListId}
                    />
                    {fav ? <FavouriteSellerBadge /> : null}
                    <span className="text-ink-muted">
                      {row.count} match{row.count === 1 ? '' : 'es'}
                    </span>
                    {result && (
                      <span className="text-ink-faint">
                        · {result.lineCoverage}/{listCards.size} lines
                        · qty {result.quantityFulfilled}/{result.quantityWanted}
                        {selection && (
                          <> · sel {fmtEuro(selection.goods)}</>
                        )}
                        {result.shipping && (
                          <span className="ml-1">
                            · ship ≈{fmtEuro(result.shipping.estimatedPrice)}
                          </span>
                        )}
                        {result.shipping && (
                          <span className="ml-1 text-pos">
                            · ~
                            {fmtEuro(
                              (selection?.goods ?? result.goodsTotal) +
                                result.shipping.estimatedPrice,
                            )}
                          </span>
                        )}
                      </span>
                    )}
                    <span className="ml-auto flex flex-wrap items-center gap-1">
                      <Button
                        disabled={p?.status === 'loading'}
                        onClick={() => void priceSeller(row)}
                        size="xs"
                        variant="neutral"
                      >
                        {p?.status === 'loading'
                          ? 'Pricing…'
                          : p?.status === 'done'
                            ? 'Re-price'
                            : 'Price it'}
                      </Button>
                      {result && (
                        <Button
                          disabled={!canCart}
                          icon={ShoppingCart}
                          onClick={() => void addAllToCart(row)}
                          size="xs"
                          title={
                            selection?.articleIds.length
                              ? `Add ${selection.articleIds.length} article${
                                  selection.articleIds.length === 1 ? '' : 's'
                                } (${selection.copyCount} cop${selection.copyCount === 1 ? 'y' : 'ies'})`
                              : 'Select at least one matched want'
                          }
                          variant="success"
                        >
                          {p?.cartStatus === 'adding'
                            ? 'Adding…'
                            : p?.cartStatus === 'done'
                              ? 'Added to cart'
                              : `Add ${selection?.articleIds.length ?? 0}`}
                        </Button>
                      )}
                    </span>
                  </div>

                  {p?.status === 'error' && (
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-neg">
                      <span>Could not price seller — {p.error}</span>
                      <Button onClick={() => void priceSeller(row)} size="xs" variant="neutral">
                        Retry
                      </Button>
                    </div>
                  )}
                  {p?.cartError && <p className="mt-1 text-warn">{p.cartError}</p>}

                  {result && open && (
                    <div className="mt-1.5 space-y-1.5 border-t border-line/60 pt-1.5">
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-ink-muted">
                        <span>
                          Matched {result.matched.length}
                          {listCards.size > 0 ? ` / ${listCards.size}` : ''}
                        </span>
                        {result.partial.length > 0 && (
                          <span className="text-warn">Partial {result.partial.length}</span>
                        )}
                        {result.missing.length > 0 && (
                          <span className="text-neg">Missing {result.missing.length}</span>
                        )}
                        <span className="text-ink-faint">
                          lines {result.lineCoverage}/{listCards.size} · copies{' '}
                          {result.quantityFulfilled}/{result.quantityWanted}
                        </span>
                        {result.shipping && (
                          <span
                            className="text-ink-faint"
                            title={`${result.shipping.methodName} · ≈${result.shipping.weight} g · remaining ${result.shipping.remainingWeightInTier ?? '?'} g in tier`}
                          >
                            ship est. {fmtEuro(result.shipping.estimatedPrice)}
                          </span>
                        )}
                      </div>

                      {(p.consolidations?.length ?? 0) > 0 && (
                        <div className="space-y-1 rounded border border-pos/30 bg-pos/5 px-1.5 py-1">
                          <div className="font-medium text-pos">
                            This seller could absorb {p.consolidations!.length} card
                            {p.consolidations!.length === 1 ? '' : 's'} currently assigned elsewhere
                          </div>
                          {p.consolidations!.slice(0, 5).map(move => (
                            <div
                              key={`${move.fromSellerId}|${move.wantKey}`}
                              className="space-y-0.5 border-t border-line/40 pt-1"
                            >
                              <div className="font-medium text-ink">Consolidate</div>
                              {move.explanation.map((line, i) => (
                                <div key={i} className="text-ink-muted">
                                  {line}
                                </div>
                              ))}
                              <Button
                                onClick={() => void applyConsolidation(row, move)}
                                size="xs"
                                variant="success"
                              >
                                Use {row.name}
                              </Button>
                              <div className="text-ink-faint">
                                Adds the replacement only — remove the old copy from the other
                                seller on Cardmarket.
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {result.matched.length > 0 && (
                        <WantLines
                          heading="Matched"
                          lines={result.matched}
                          onAdd={line => void addOneLine(row, line)}
                          onToggle={k => toggleKey(row.idSeller, k)}
                          selected={p.selectedKeys ?? new Set()}
                          tone="pos"
                        />
                      )}
                      {result.partial.length > 0 && (
                        <WantLines
                          heading="Partial"
                          lines={result.partial}
                          onAdd={line => void addOneLine(row, line)}
                          onToggle={k => toggleKey(row.idSeller, k)}
                          selected={p.selectedKeys ?? new Set()}
                          tone="warn"
                        />
                      )}
                      {result.missing.length > 0 && (
                        <div>
                          <div className="mb-0.5 font-medium text-neg">
                            Missing {result.missing.length}
                          </div>
                          <ul className="space-y-0.5 text-ink-muted">
                            {result.missing.map(l => (
                              <li key={l.wantKey} className="truncate">
                                {l.cardName}
                                {l.quantityStatus === 'KNOWN' && l.wantedQty > 1
                                  ? ` ×${l.wantedQty}`
                                  : ''}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}
      </div>
    </div>
  );
};

const KnownCheapestBits = ({ line }: { line: SellerWantLine }) => {
  if (
    line.priceDeltaVsKnownCheapest == null ||
    line.knownCheapestUnitPrice == null ||
    line.unitPrice <= 0
  ) {
    return null;
  }
  const stale = line.knownCheapestFreshness === 'STALE';
  const delta = line.priceDeltaVsKnownCheapest;
  return (
    <span
      className={`w-full text-ink-faint sm:w-auto ${stale ? 'opacity-70' : ''}`}
      title={stale ? 'Known cheapest observation is stale' : 'From prices Lugin has already seen'}
    >
      This seller {fmtEuro(line.unitPrice)} · Known cheapest {fmtEuro(line.knownCheapestUnitPrice)}
      {delta > 0.001
        ? ` · Premium here ${fmtDelta(delta)}`
        : delta < -0.001
          ? ` · Better here ${fmtDelta(delta)}`
          : ' · Same'}
      {stale ? ' (stale)' : ''}
    </span>
  );
};

const WantLines = ({
  heading,
  lines,
  onAdd,
  onToggle,
  selected,
  tone,
}: {
  heading: string;
  lines: SellerWantLine[];
  onAdd: (line: SellerWantLine) => void;
  onToggle: (wantKey: string) => void;
  selected: ReadonlySet<string>;
  tone: 'pos' | 'warn';
}) => (
  <div>
    <div className={`mb-0.5 font-medium ${tone === 'pos' ? 'text-pos' : 'text-warn'}`}>
      {heading} {lines.length}
    </div>
    <ul className="space-y-0.5">
      {lines.map(line => (
        <li
          key={line.wantKey}
          className="flex flex-wrap items-center gap-1.5 rounded bg-panel/50 px-1 py-0.5"
        >
          <input
            checked={selected.has(line.wantKey)}
            className="flex-none"
            onChange={() => onToggle(line.wantKey)}
            title="Include in Add all"
            type="checkbox"
          />
          <span className="min-w-0 flex-1 truncate font-medium text-ink">{line.cardName}</span>
          <span className="flex-none tabular-nums text-pos">{fmtEuro(line.goodsTotal)}</span>
          <span className="w-full truncate text-ink-faint sm:w-auto">{metaBits(line)}</span>
          <KnownCheapestBits line={line} />
          <Button
            disabled={line.articleIds.length === 0}
            icon={ShoppingCart}
            onClick={() => onAdd(line)}
            size="xs"
            title={`Add ${line.chosenQty} to cart`}
            variant="neutral"
          >
            Add {line.chosenQty > 1 ? line.chosenQty : ''}
          </Button>
        </li>
      ))}
    </ul>
  </div>
);
