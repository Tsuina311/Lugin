import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from 'react';

import { usePageData } from '../usePageData';
import { useWideLayout } from '../useWideLayout';

import { Badge } from './Badge';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { SelectionBar } from './Selection';
import { ViewToggle } from './ViewToggle';
import {
  ChevronDown,
  Info,
  Library,
  Loader2,
  ReceiptEuro,
  ShoppingCart,
  Sparkles,
  Trash2,
} from './icons';
import { useSequentialImages } from './useSequentialImages';

import { cartStore } from '@/content/cartStore';
import {
  collectionStore,
  shouldAddPurchasesToCollection,
  setAddPurchasesToCollection,
} from '@/content/collectionStore';
import { previewStore } from '@/content/previewStore';
import { purchaseStore } from '@/content/purchaseStore';
import { shippingStore } from '@/content/shippingStore';
import { taskQueue } from '@/content/taskQueue';
import { wantsStore } from '@/content/wantsStore';
import { cardKey, frontFaceName, stripVersion } from '@/lib/cardName';
import { flags } from '@/lib/flags';
import { requestPrices, requestScryfall, requestScryfallCached } from '@/lib/messaging';
import { MANA_VALUE_BUCKETS, manaValueBucket, manaValueLabel, type CardMetadata } from '@/lib/mtg';
import { money, priceOf } from '@/lib/prices';
import { addArticleToCart, findCmToken } from '@/sites/cardmarket/cart';
import {
  COUNTRIES,
  countryId,
  countryName,
  estimateShipping,
  shippingTiers,
  type ShippingEstimate,
} from '@/sites/cardmarket/shipping';
import {
  addWant,
  deleteWant,
  fetchAllWantLists,
  fetchCardEditions,
  fetchPriceGuide,
  fetchProductIds,
  fetchSellerListOffers,
  fetchSellersWithMostWants,
  findImageUrl,
  getLastGuideHtml,
  parseOffers,
  parseWantRows,
  scanSeller,
  type EditionPrice,
  type PriceGuide,
  type ScanMatch as ScanMatchT,
  type PurchaseRecord,
  type ScanProgress,
  type ScanStrategy,
  type SellerWants,
  type WantListMeta,
  type WantPlacement,
  type WantsIndex,
} from '@/sites/cardmarket/wants';
import { taskProgress } from '@/ui/format';
import { usePrices } from '@/ui/usePrices';
import { useRowSelection } from '@/ui/useRowSelection';

/** MTG color pips, for the metadata filter chips (C = colorless). */
const FILTER_COLORS: { cls: string; code: string }[] = [
  { cls: 'bg-amber-100 text-amber-900', code: 'W' },
  { cls: 'bg-sky-500 text-white', code: 'U' },
  { cls: 'bg-slate-700 text-slate-100', code: 'B' },
  { cls: 'bg-red-500 text-white', code: 'R' },
  { cls: 'bg-emerald-600 text-white', code: 'G' },
  { cls: 'bg-slate-400 text-slate-900', code: 'C' },
];

/**
 * The one-line row layout: card, printing, want lists, price, add, remove. The
 * flexible columns shrink together while price and the two actions keep their
 * width, so every row's numbers and buttons sit in the same place.
 */
/**
 * Where the illustration sits inside a full card image, as fractions of that
 * image. Cardmarket and Scryfall both hand us the whole card, frame and all, so
 * the tiles crop to this window instead of nudging `object-position` around,
 * which is what left border slivers and half a type line on screen.
 *
 * Measured against Scryfall's own art crops on several frames (white, black,
 * artifact, multicolour land); they agreed to within half a percent. Full-art
 * and older layouts sit a little differently, but a fixed crop of the common
 * case beats a compromise that suits none of them.
 */
const ART_WINDOW = { height: 0.4375, left: 0.078, top: 0.1145, width: 0.841 };
/** Full card images share one shape: 488×680 from Scryfall, 313×437 from Cardmarket. */
const CARD_ASPECT = 488 / 680;
/** …which makes the art window itself this shape, and so the tiles' art too. */
const ART_ASPECT = (ART_WINDOW.width * CARD_ASPECT) / ART_WINDOW.height;

/**
 * Pips that sit over card art. They carry their own dark backdrop so they read
 * on any illustration and in either theme — the one place raw black/white beats
 * the theme tokens.
 */
const ART_CHIP =
  'flex items-center gap-0.5 rounded bg-black/70 px-1 py-0.5 text-[10px] font-medium leading-none text-white backdrop-blur-[2px]';

const ROW_COLUMNS =
  'grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.5fr)_minmax(0,1.1fr)_8.75rem_5rem_1.25rem] items-center gap-x-2';

const useWants = () => useSyncExternalStore(wantsStore.subscribe, wantsStore.getSnapshot);

interface SellerContext {
  baseUrl: string;
  name: string;
}

/** If we're on a seller's Singles offers page, extract their name + base URL. */
const detectSeller = (): SellerContext | null => {
  const m = location.pathname.match(/\/Users\/([^/]+)\/Offers\/Singles/i);
  if (!m) return null;
  return { baseUrl: location.origin + location.pathname, name: decodeURIComponent(m[1]) };
};

/**
 * A Scryfall "card image by exact name" URL. Used as a fallback thumbnail for
 * offer rows that carry no Cardmarket image (e.g. spoiler-page cards, which have
 * no article/stock row and thus no product image). The front-face name keeps the
 * lookup exact for double-faced cards ("A // B" → "A").
 */
const scryfallImageByName = (name?: string): string | undefined =>
  name
    ? `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(frontFaceName(name))}&format=image&version=normal`
    : undefined;

/**
 * Read the seller's country from the current page.
 *
 * On a seller's Singles page the country is the flag next to their name in the
 * page `<h1>` — a span whose `aria-label`/tooltip is the plain country name
 * (e.g. `<h1>Angel-s-blade<span aria-label="Belgium" …>`). We check that first,
 * validating the value against the known country list. As a fallback (e.g. on
 * pages without that header), we use the per-offer "Item location: <Country>"
 * flag, taking the most common value. Bootstrap moves `title` into
 * `data-bs-original-title`/`data-bs-title` once tooltips init, so we read all.
 */
const detectSellerCountry = (): string | null => {
  // 1) Seller header flag (plain country name in aria-label / tooltip).
  for (const el of document.querySelectorAll<HTMLElement>(
    'h1 [aria-label], h1 [data-bs-original-title], h1 [data-original-title], h1 [title]',
  )) {
    const cand = (
      el.getAttribute('aria-label') ||
      el.getAttribute('data-bs-original-title') ||
      el.getAttribute('data-original-title') ||
      el.getAttribute('title') ||
      ''
    ).trim();
    if (cand && countryId(cand) != null) return cand;
  }

  // 2) Fallback: per-offer "Item location: <Country>" flags — most common wins.
  const els = document.querySelectorAll(
    '[title^="Item location" i],[data-bs-original-title^="Item location" i],[data-bs-title^="Item location" i]',
  );
  const counts = new Map<string, number>();
  els.forEach(el => {
    const raw = (
      el.getAttribute('title') ||
      el.getAttribute('data-bs-original-title') ||
      el.getAttribute('data-bs-title') ||
      ''
    )
      .replace(/^item location:\s*/i, '')
      .trim();
    if (raw) counts.set(raw, (counts.get(raw) ?? 0) + 1);
  });
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of counts) if (n > bestN) [best, bestN] = [k, n];
  return best;
};

type ScanMatch = ScanMatchT;
interface ScanState {
  diagnostics: string[];
  error: string | null;
  matches: ScanMatch[];
  progress: ScanProgress | null;
  requests: number;
  /** When a completed scan was finished — set on persisted/rehydrated scans. */
  scannedAt?: number;
  status: 'idle' | 'scanning' | 'done' | 'error';
  strategy: ScanStrategy | null;
  totalScanned: number;
}

/** Per-seller storage key so a completed scan survives a page reload (needed
 *  when the user must reload to solve Cardmarket's "verify you're human" check). */
const scanStorageKey = (baseUrl: string) => `lugin:sellerScan:${baseUrl}`;

// Live From/Trend still come from a product page (one request each), so we cache
// them — but the snapshot already colours every row, and a measured sample of
// printings tracked Cardmarket's Price Trend to the cent (median ratio 1.00).
// Live fetches are therefore only for close calls and on demand, not a crawl of
// the whole list. Stamped with a fetch time and treated as stale after a few
// days (prices drift), so old data never silently misleads.
const PRICE_STORAGE_KEY = 'lugin:priceGuides';
const EDITIONS_STORAGE_KEY = 'lugin:editions';
const PRICE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
/** Offer / snapshot ratios inside this band are the ones a live page can change. */
const CLOSE_LO = 0.85;
const CLOSE_HI = 1.2;
type StampedPrice = { guide: PriceGuide; ts: number };
type StampedEditions = { editions: EditionPrice[]; ts: number };

/** Merge one price guide into the persisted map, pruning stale entries. */
const persistPrice = async (url: string, guide: PriceGuide): Promise<void> => {
  try {
    const stored = await chrome.storage.local.get(PRICE_STORAGE_KEY);
    const map = (stored[PRICE_STORAGE_KEY] ?? {}) as Record<string, StampedPrice>;
    const now = Date.now();
    for (const [k, v] of Object.entries(map))
      if (!v || now - v.ts >= PRICE_MAX_AGE_MS) delete map[k];
    map[url] = { guide, ts: now };
    await chrome.storage.local.set({ [PRICE_STORAGE_KEY]: map });
  } catch {
    // best-effort cache; ignore storage failures
  }
};

/** Merge one card's editions breakdown into the persisted map, pruning stale entries. */
const persistEditions = async (key: string, editions: EditionPrice[]): Promise<void> => {
  try {
    const stored = await chrome.storage.local.get(EDITIONS_STORAGE_KEY);
    const map = (stored[EDITIONS_STORAGE_KEY] ?? {}) as Record<string, StampedEditions>;
    const now = Date.now();
    for (const [k, v] of Object.entries(map))
      if (!v || now - v.ts >= PRICE_MAX_AGE_MS) delete map[k];
    map[key] = { editions, ts: now };
    await chrome.storage.local.set({ [EDITIONS_STORAGE_KEY]: map });
  } catch {
    // best-effort cache; ignore storage failures
  }
};

const initialScan: ScanState = {
  diagnostics: [],
  error: null,
  matches: [],
  progress: null,
  requests: 0,
  status: 'idle',
  strategy: null,
  totalScanned: 0,
};

const timeAgo = (ts: number): string => {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
};

export const WantsPanel = () => {
  const { status, index: rawIndex, progress, error } = useWants();
  const pageData = usePageData();
  const cart = useSyncExternalStore(cartStore.subscribe, cartStore.getSnapshot);
  const cartItems = cart.items;

  // Lookups for the "in cart" tag: by exact article and by card (any printing).
  const cartArticleIds = useMemo(() => new Set(cartItems.map(i => i.articleId)), [cartItems]);
  const cartCardKeys = useMemo(() => new Set(cartItems.map(i => cardKey(i.name))), [cartItems]);

  // Cards purchased before (by name), from the scanned order-history index.
  const purchases = useSyncExternalStore(purchaseStore.subscribe, purchaseStore.getSnapshot);

  // The user's imported collection — powers the "owned" tag. Keyed by card name
  // (version suffix collapsed) so any printing counts as owned, mirroring the
  // "purchased" lookup.
  const collectionState = useSyncExternalStore(
    collectionStore.subscribe,
    collectionStore.getSnapshot,
  );
  const ownedLookup = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of collectionState.collection?.cards ?? []) {
      const norm = stripVersion(cardKey(c.name));
      map.set(norm, (map.get(norm) ?? 0) + (c.quantity || 0));
    }
    return map;
  }, [collectionState]);

  // Shipping-cost estimates. The user sets their home country once and syncs the
  // matrices FROM every source country; per-seller estimates are then instant.
  const shipping = useSyncExternalStore(shippingStore.subscribe, shippingStore.getSnapshot);
  // Detected seller country on an offers page, overridable if detection misses.
  const detectedSellerCountry = useMemo(() => detectSellerCountry(), []);
  const [sellerCountryOverride, setSellerCountryOverride] = useState<number | null>(null);
  const sellerCountryIdVal = sellerCountryOverride ?? countryId(detectedSellerCountry) ?? null;
  const [detectingCountry, setDetectingCountry] = useState(false);

  // Auto-detect the home country from the account page the first time the
  // panel loads with none set, so shipping estimates work with zero setup.
  const autoDetectedRef = useRef(false);
  useEffect(() => {
    if (shipping.loading || shipping.toCountry != null || autoDetectedRef.current) return;
    autoDetectedRef.current = true;
    setDetectingCountry(true);
    void shippingStore.detectHomeCountry().finally(() => setDetectingCountry(false));
  }, [shipping.loading, shipping.toCountry]);

  // Persistent task queue (sequential, survives navigation).
  const tasks = useSyncExternalStore(taskQueue.subscribe, taskQueue.getSnapshot);
  const wantsTask = tasks.find(
    t => t.type === 'syncWants' && (t.status === 'queued' || t.status === 'running'),
  );
  const purchaseTask = tasks.find(
    t => t.type === 'syncPurchases' && (t.status === 'queued' || t.status === 'running'),
  );
  const activeTasks = tasks.filter(t => t.status === 'queued' || t.status === 'running');

  // Two independent measurements: the panel decides whether it can afford a
  // sidebar, the results column decides whether a card fits on one line. Keeping
  // them apart means opening the sidebar can't quietly break the rows.
  const { ref: panelRef, wide } = useWideLayout(880);
  const { ref: listRef, wide: oneLine } = useWideLayout(700);

  // Collapse the management chrome (tasks + syncs + seller scan) so the scrolled
  // results list gets the most space. Remembered across navigations.
  const [toolsOpen, setToolsOpen] = useState(() => {
    try {
      return localStorage.getItem('lugin:toolsOpen') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('lugin:toolsOpen', toolsOpen ? '1' : '0');
    } catch {
      // ignore storage failures
    }
  }, [toolsOpen]);
  // Cardmarket names alternate printings like "Edgar Markov (V.2)". For
  // "purchased?" we treat any printing as the same card, so collapse the
  // version suffix. Built on the read side so it works against an existing
  // index without re-syncing; entries that collapse together are merged.
  const purchaseLookup = useMemo(() => {
    const map = new Map<string, { count: number; name: string; purchases: PurchaseRecord[] }>();
    for (const [key, entry] of Object.entries(purchases.index?.cards ?? {})) {
      const norm = stripVersion(key);
      const cur = map.get(norm);
      if (cur) {
        cur.count += entry.count;
        cur.purchases = [...cur.purchases, ...(entry.purchases ?? [])];
      } else {
        map.set(norm, {
          count: entry.count,
          name: entry.name,
          purchases: [...(entry.purchases ?? [])],
        });
      }
    }
    return map;
  }, [purchases]);
  const purchasedKeys = purchaseLookup;

  // Per-card face images for the hover preview. Looked up lazily from Scryfall
  // (cached in the background worker) the first time a card is hovered. A value
  // of length >= 2 means the card is double-faced and the preview can flip;
  // an empty array marks a resolved single-faced card so we don't re-request.
  const [facesByKey, setFacesByKey] = useState<Record<string, string[]>>({});
  const [addPurchasesToCollection, setAddPurchasesToCollectionState] = useState(
    shouldAddPurchasesToCollection(),
  );
  const faceRequested = useRef<Set<string>>(new Set());

  const loadFaces = (key: string, name: string, editionBack?: string) => {
    if (!key || faceRequested.current.has(key)) return;
    faceRequested.current.add(key);
    void requestScryfall([name])
      .then(cards => {
        const card = cards[0];
        const faces = card?.faceImages ?? [];
        setFacesByKey(prev => ({ ...prev, [key]: faces }));
        // Cache the full metadata so the front image can use Scryfall's direct
        // (browser-cacheable) CDN URL instead of the slow `named?format=image`
        // redirect on subsequent hovers.
        if (card) setMetaByName(prev => (key in prev ? prev : { ...prev, [key]: card }));
        // Card is double-faced → upgrade the live preview so it can flip. Prefer
        // the edition-specific back (built from the offer's Cardmarket product
        // id); only fall back to Scryfall's default-printing back if we couldn't
        // derive one. The empty string is a placeholder — setFaces keeps the
        // edition front already on screen and only takes the appended back.
        if (faces.length >= 2) previewStore.setFaces(key, ['', editionBack ?? faces[1]]);
      })
      .catch(() => {
        // Leave it unresolved so a later hover can retry.
        faceRequested.current.delete(key);
      });
  };

  // Be defensive: an index cached by an older build may be missing fields.
  const index = rawIndex
    ? {
        ...rawIndex,
        cards: rawIndex.cards ?? {},
        diagnostics: rawIndex.diagnostics ?? [],
        lists: rawIndex.lists ?? [],
      }
    : null;

  // Parse the current page's offer rows directly (rich: price/foil/edition/id),
  // re-running whenever the extracted page data changes. This is the default
  // view — the old "Cards" tab, now with the same UI as the wants results.
  const pageMatches = useMemo<ScanMatch[]>(() => {
    void pageData; // re-parse when the page's extracted data updates
    const offers = parseOffers(document.body);
    // On a want-list page, `parseOffers` only sees cards that carry a product
    // link. Want rows for cards without a live product page yet (e.g. new
    // spoilers) render as `.want-name` text with no link, so merge in the
    // dedicated want-row parser to capture them too (deduped by card key).
    if (/\/Wants\/\d+/.test(location.pathname)) {
      // Prefer any card image already on the page (instant — the browser has it
      // — and matches the exact printing) over a Scryfall lookup. Keyed by card.
      const pageImages = new Map<string, string>();
      document.querySelectorAll<HTMLElement>('.want-name').forEach(nameEl => {
        const name = nameEl.textContent?.trim();
        if (!name) return;
        const scope =
          nameEl.closest<HTMLElement>('.accordion-item, tr, li') ?? nameEl.parentElement;
        const img = scope ? findImageUrl(scope) : undefined;
        if (img) pageImages.set(cardKey(name), img);
      });
      const seen = new Set(offers.map(o => cardKey(o.name)));
      for (const row of parseWantRows(document.body)) {
        const key = cardKey(row.name);
        if (seen.has(key)) continue;
        seen.add(key);
        offers.push({ imageUrl: pageImages.get(key), isFoil: false, name: row.name });
      }
    }
    return offers.map(o => ({
      ...o,
      lists: index?.cards[cardKey(o.name)]?.lists ?? [],
    }));
  }, [index, pageData]);

  const totalWanted = index ? Object.keys(index.cards).length : 0;
  const mismatches = index?.lists.filter(l => l.extracted < l.expected) ?? [];

  // ---- Seller scan (find everything a seller has on my want lists) ---------
  const seller = useMemo(() => detectSeller(), []);
  const [scan, setScan] = useState<ScanState>(initialScan);
  const [forced, setForced] = useState<'auto' | ScanStrategy>('auto');
  const abortRef = useRef<AbortController | null>(null);

  // Rehydrate a previously-saved scan for this seller so reloading the page
  // (e.g. to clear a Cloudflare human-check) doesn't lose the results.
  useEffect(() => {
    if (!seller) return;
    let cancelled = false;
    void chrome.storage.local.get(scanStorageKey(seller.baseUrl)).then(stored => {
      const saved = stored[scanStorageKey(seller.baseUrl)] as ScanState | undefined;
      if (!cancelled && saved && saved.status === 'done') {
        setScan(cur => (cur.status === 'idle' ? saved : cur));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [seller]);

  const runScan = async () => {
    if (!index || !seller) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setScan({ ...initialScan, status: 'scanning' });
    try {
      const result = await scanSeller(
        seller.baseUrl,
        index,
        p => setScan(s => ({ ...s, progress: p })),
        controller.signal,
        forced === 'auto' ? undefined : forced,
      );
      const done: ScanState = {
        diagnostics: result.diagnostics,
        error: null,
        matches: result.matches,
        progress: null,
        requests: result.requests,
        scannedAt: Date.now(),
        status: 'done',
        strategy: result.strategy,
        totalScanned: result.totalScanned,
      };
      setScan(done);
      void chrome.storage.local.set({ [scanStorageKey(seller.baseUrl)]: done });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setScan(s => ({ ...s, progress: null, status: 'idle' }));
        return;
      }
      setScan(s => ({
        ...s,
        error: err instanceof Error ? err.message : String(err),
        progress: null,
        status: 'error',
      }));
    } finally {
      abortRef.current = null;
    }
  };

  // ---- Best sellers for the current want list ------------------------------
  // On `/Wants/<id>` Cardmarket can rank sellers by how many of the list's cards
  // they stock. We fetch that ranking, then price each seller by scanning their
  // want-list-filtered offers so they can be compared on real cost + which cards
  // are missing (the native "add all to cart" hides both).
  const wantListId = useMemo(() => location.pathname.match(/\/Wants\/(\d+)/)?.[1] ?? null, []);
  const wantListName = index?.lists.find(l => l.id === wantListId)?.name;
  // Cards in this list: normalized key -> display name (any-printing match).
  const listCards = useMemo(() => {
    const m = new Map<string, string>();
    if (index && wantListName) {
      for (const [key, entry] of Object.entries(index.cards)) {
        if (entry.lists?.includes(wantListName)) m.set(stripVersion(key), entry.name);
      }
    }
    return m;
  }, [index, wantListName]);

  interface SellerPrice {
    error?: string;
    matched?: number;
    missing?: string[];
    status: 'loading' | 'done' | 'error';
    total?: number;
  }
  const [sellers, setSellers] = useState<{
    error: string | null;
    rows: SellerWants[];
    status: 'idle' | 'loading' | 'done' | 'error';
  }>({ error: null, rows: [], status: 'idle' });
  const [priced, setPriced] = useState<Record<string, SellerPrice>>({});
  const priceAborts = useRef<Map<string, AbortController>>(new Map());

  const loadSellers = async () => {
    if (!wantListId) return;
    const token = findCmToken();
    if (!token) {
      setSellers({ error: 'No session token found on this page.', rows: [], status: 'error' });
      return;
    }
    setSellers({ error: null, rows: [], status: 'loading' });
    setPriced({});
    try {
      const rows = await fetchSellersWithMostWants(wantListId, token);
      setSellers({ error: null, rows, status: 'done' });
    } catch (err) {
      setSellers({
        error: err instanceof Error ? err.message : String(err),
        rows: [],
        status: 'error',
      });
    }
  };

  const priceSeller = async (row: SellerWants) => {
    if (!wantListId) return;
    priceAborts.current.get(row.idSeller)?.abort();
    const controller = new AbortController();
    priceAborts.current.set(row.idSeller, controller);
    setPriced(p => ({ ...p, [row.idSeller]: { status: 'loading' } }));
    try {
      const { offers } = await fetchSellerListOffers(
        row.url,
        wantListId,
        () => {},
        controller.signal,
      );
      // Cheapest offer per card (any printing collapses to one key).
      const cheapest = new Map<string, number>();
      for (const o of offers) {
        const key = stripVersion(cardKey(o.name));
        const v = o.priceValue ?? Infinity;
        if (v < (cheapest.get(key) ?? Infinity)) cheapest.set(key, v);
      }
      const total = [...cheapest.values()].reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
      const missing =
        listCards.size > 0
          ? [...listCards.entries()].filter(([k]) => !cheapest.has(k)).map(([, name]) => name)
          : [];
      setPriced(p => ({
        ...p,
        [row.idSeller]: { matched: cheapest.size, missing, status: 'done', total },
      }));
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

  // ---- Remove a purchase from all want lists (order page) ------------------
  // On `/Orders/<idShipment>` the site can clear everything bought in the order
  // from one want list at a time. We enqueue a task that loops that across every
  // want list (paced) — it runs sequentially with syncs and survives navigation.
  const shipmentId = useMemo(() => location.pathname.match(/\/Orders\/(\d+)/)?.[1] ?? null, []);
  const [confirmingCleanup, setConfirmingCleanup] = useState(false);
  // Active or most-recent cleanup task for THIS order.
  const cleanupTask = useMemo(() => {
    const mine = tasks.filter(
      t => t.type === 'cleanupWants' && t.params?.shipmentId === shipmentId,
    );
    const active = mine.find(t => t.status === 'queued' || t.status === 'running');
    return (
      active ?? mine.slice().sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))[0] ?? null
    );
  }, [tasks, shipmentId]);

  // ---- Add to cart ---------------------------------------------------------
  // status per article id: 'adding' | 'added' | '<error message>'
  const [added, setAdded] = useState<Record<string, string>>({});

  const addOne = async (offer: ScanMatch): Promise<boolean> => {
    const articleId = offer.articleId;
    if (!articleId) return false;
    const token = findCmToken();
    if (!token) {
      setAdded(s => ({
        ...s,
        [articleId]: 'No session token found — add one card manually once, then retry.',
      }));
      return false;
    }
    setAdded(s => ({ ...s, [articleId]: 'adding' }));
    try {
      const r = await addArticleToCart(articleId, token);
      setAdded(s => ({ ...s, [articleId]: r.ok ? 'added' : r.message }));
      // Re-read the authoritative server cart so the header total mirrors the
      // site (its header widget won't refresh since we didn't click its button).
      if (r.ok) void cartStore.refresh();
      return r.ok;
    } catch (err) {
      setAdded(s => ({ ...s, [articleId]: err instanceof Error ? err.message : String(err) }));
      return false;
    }
  };

  // ---- Add to want list (id-less rows, e.g. spoiler pages) -----------------
  // Keyed by the card's product URL (the id-less rows we offer this on always
  // carry one). Want lists come from the synced index when available, else a
  // live fetch the first time a menu opens.
  const [wantAdd, setWantAdd] = useState<
    Record<string, { listName?: string; msg?: string; status: 'adding' | 'added' | 'error' }>
  >({});
  const [wantMenu, setWantMenu] = useState<string | null>(null);
  const [fetchedLists, setFetchedLists] = useState<WantListMeta[] | null>(null);
  const [listsLoading, setListsLoading] = useState(false);

  const wantListOptions = useMemo<{ id: string; name: string }[] | null>(() => {
    if (index?.lists?.length) return index.lists.map(l => ({ id: l.id, name: l.name }));
    if (fetchedLists) return fetchedLists.map(l => ({ id: l.id, name: l.name }));
    return null;
  }, [index, fetchedLists]);

  const ensureWantLists = async () => {
    if (wantListOptions || listsLoading) return;
    setListsLoading(true);
    try {
      setFetchedLists(await fetchAllWantLists());
    } catch {
      setFetchedLists([]);
    } finally {
      setListsLoading(false);
    }
  };

  const addToWantList = async (o: ScanMatch, list: { id: string; name: string }) => {
    const url = o.productUrl;
    if (!url) return;
    setWantMenu(null);
    const token = findCmToken();
    if (!token) {
      setWantAdd(s => ({
        ...s,
        [url]: {
          msg: 'No session token found — add one card manually once, then retry.',
          status: 'error',
        },
      }));
      return;
    }
    setWantAdd(s => ({ ...s, [url]: { status: 'adding' } }));
    try {
      const ids = await fetchProductIds(url);
      if (!ids?.idMetacard)
        throw new Error('Couldn\u2019t find this card\u2019s id on Cardmarket.');
      const r = await addWant(
        { idMetacard: ids.idMetacard, idWantsList: list.id, isFoil: o.isFoil },
        token,
      );
      setWantAdd(s => ({
        ...s,
        [url]: r.ok
          ? { listName: list.name, status: 'added' }
          : { msg: r.message, status: 'error' },
      }));
    } catch (err) {
      setWantAdd(s => ({
        ...s,
        [url]: { msg: err instanceof Error ? err.message : String(err), status: 'error' },
      }));
    }
  };

  // What the results area shows: scan results once a scan is done, otherwise
  // the current page's offers.
  const showingScan = scan.status === 'done';
  const displayMatches = showingScan ? scan.matches : pageMatches;
  const wantedCount = displayMatches.filter(m => m.lists.length > 0).length;

  // Group offers by card name: a card with several editions collapses into one
  // row, cheapest offer first. Single-offer cards render flat.
  const grouped = useMemo(() => {
    const map = new Map<string, { lists: Set<string>; name: string; offers: ScanMatch[] }>();
    for (const m of displayMatches) {
      const key = cardKey(m.name);
      const g = map.get(key) ?? { lists: new Set<string>(), name: m.name, offers: [] };
      g.offers.push(m);
      m.lists.forEach(l => g.lists.add(l));
      map.set(key, g);
    }
    return [...map.values()]
      .map(g => ({
        lists: [...g.lists],
        name: g.name,
        offers: g.offers
          .slice()
          .sort((a, b) => (a.priceValue ?? Infinity) - (b.priceValue ?? Infinity)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [displayMatches]);

  // ---- Sub-tabs: split the results by want list ----------------------------
  // "All" plus one tab per want list that actually has a matching card here
  // (with its own count). Each tab's price/add actions operate only on its
  // visible subset, so you can load prices / add per list independently.
  const listTabs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of grouped) for (const l of g.lists) counts.set(l, (counts.get(l) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [grouped]);
  const [activeList, setActiveList] = useState<string | null>(null);
  // Fall back to "All" if the selected list vanished (e.g. after a re-scan).
  const effectiveList = activeList && listTabs.some(([l]) => l === activeList) ? activeList : null;

  // ---- Metadata filters (creature type, color, …) --------------------------
  // Cardmarket doesn't expose gameplay attributes in a filterable way, so we
  // cross-reference Scryfall (by name; identical across printings) to narrow the
  // matches — e.g. "black Elves". Loaded on demand for the cards in the current
  // results and cached in the background worker, so it's cheap to reopen.
  const [metaByName, setMetaByName] = useState<Record<string, CardMetadata>>({});
  const [metaState, setMetaState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [showFilters, setShowFilters] = useState(false);

  // List vs. box (grid) view for the results, persisted across navigations.
  const [resultsView, setResultsView] = useState<'list' | 'box'>(() => {
    try {
      return localStorage.getItem('lugin:resultsView') === 'box' ? 'box' : 'list';
    } catch {
      return 'list';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('lugin:resultsView', resultsView);
    } catch {
      // ignore storage failures
    }
  }, [resultsView]);
  const [fQuery, setFQuery] = useState('');
  const [fColors, setFColors] = useState<Set<string>>(new Set());
  const [fCmc, setFCmc] = useState<Set<number>>(new Set());
  const [fSubtype, setFSubtype] = useState('');

  const groupNames = useMemo(() => grouped.map(g => g.name), [grouped]);

  const loadMeta = async () => {
    const missing = groupNames.filter(n => !(cardKey(n) in metaByName));
    if (missing.length === 0) return;
    setMetaState('loading');
    try {
      const cards = await requestScryfall(missing);
      setMetaByName(prev => {
        const next = { ...prev };
        for (const c of cards) next[cardKey(c.name)] = c;
        return next;
      });
      setMetaState('idle');
    } catch {
      setMetaState('error');
    }
  };

  // Preload cached metadata (instant + offline, no network) so filters are ready
  // with no spinner for cards seen before. New cards fetch on demand below.
  useEffect(() => {
    if (groupNames.length === 0) return;
    void requestScryfallCached(groupNames)
      .then(cards => {
        if (cards.length === 0) return;
        setMetaByName(prev => {
          const next = { ...prev };
          for (const c of cards) next[cardKey(c.name)] = c;
          return next;
        });
      })
      .catch(() => {
        // best-effort preload; on-demand load still covers it
      });
  }, [groupNames]);

  // Load metadata for the current results whenever the filter panel is open.
  useEffect(() => {
    if (showFilters) void loadMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFilters, groupNames]);

  // Subtypes present among the loaded cards, for the subtype dropdown.
  const availableSubtypes = useMemo(() => {
    const set = new Set<string>();
    for (const n of groupNames) metaByName[cardKey(n)]?.subtypes.forEach(s => set.add(s));
    return [...set].sort();
  }, [groupNames, metaByName]);

  // The text box supports multiple terms (whitespace-separated); every term must
  // match, so "elf legendary" narrows to Legendary Elves. Terms are shown as
  // removable chips below the input.
  const fTerms = useMemo(() => fQuery.trim().toLowerCase().split(/\s+/).filter(Boolean), [fQuery]);
  const removeTerm = (term: string) => setFQuery(fTerms.filter(t => t !== term).join(' '));

  const filtersActive = fTerms.length > 0 || fColors.size > 0 || fCmc.size > 0 || fSubtype !== '';

  const metaMatch = (name: string): boolean => {
    if (!filtersActive) return true;
    const meta = metaByName[cardKey(name)];
    if (fTerms.length) {
      const hay =
        `${name} ${meta?.typeLine ?? ''} ${meta?.subtypes.join(' ') ?? ''} ${meta?.types.join(' ') ?? ''} ${meta?.keywords?.join(' ') ?? ''}`.toLowerCase();
      if (!fTerms.every(t => hay.includes(t))) return false;
    }
    if (fColors.size > 0) {
      const cc = meta?.colors ?? [];
      const colorless = cc.length === 0;
      const ok = [...fColors].some(c => (c === 'C' ? colorless : cc.includes(c)));
      if (!ok) return false;
    }
    if (fCmc.size > 0) {
      if (meta?.cmc == null || !fCmc.has(manaValueBucket(meta.cmc))) return false;
    }
    if (fSubtype && !meta?.subtypes.includes(fSubtype)) return false;
    return true;
  };

  const visibleGrouped = useMemo(
    () =>
      grouped.filter(g => (!effectiveList || g.lists.includes(effectiveList)) && metaMatch(g.name)),
    // metaMatch reads these; listing them keeps the memo correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grouped, effectiveList, metaByName, fQuery, fColors, fCmc, fSubtype],
  );

  /** Resolve the best front-image URL for a card (page image → cached CDN →
   * Scryfall-by-name redirect fallback). */
  const cardImageSrc = (url?: string, name?: string): string | undefined => {
    const key = name ? cardKey(name) : '';
    return url ?? (key ? metaByName[key]?.imageUrl : undefined) ?? scryfallImageByName(name);
  };

  // Box view needs every visible card's image. Fetch metadata (batched + cached)
  // so name-only want rows resolve to a direct CDN image instead of the slower
  // Scryfall redirect. Then feed the resolved URLs through the sequential loader
  // so on-screen cards fetch one after another rather than all at once.
  useEffect(() => {
    if (resultsView === 'box') void loadMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultsView, groupNames]);

  const boxSrcs = useMemo(
    () =>
      resultsView === 'box'
        ? visibleGrouped
            .map(g => cardImageSrc(g.offers.find(o => o.imageUrl)?.imageUrl, g.name))
            .filter((s): s is string => !!s)
        : [],
    // cardImageSrc reads metaByName; list it so newly-resolved images enqueue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resultsView, visibleGrouped, metaByName],
  );
  const loadedImages = useSequentialImages(boxSrcs);

  // The "order" the shipping estimate is based on: the cheapest offer of each
  // currently-visible card (mirrors what "Add cheapest of each" would buy).
  // The seller's shipping matrix (to your home country) and its display tiers.
  const sellerMatrix =
    sellerCountryIdVal != null ? shipping.matrices[sellerCountryIdVal] : undefined;
  const sellerTiers = useMemo(
    () => (sellerMatrix ? shippingTiers(sellerMatrix) : []),
    [sellerMatrix],
  );
  const sellerShipError =
    sellerCountryIdVal != null ? shipping.errors[sellerCountryIdVal] : undefined;

  // How many cards you currently have in your cart from *this* seller — this is
  // what decides which shipping tier you're in right now (a new card that tips
  // you into the next tier is where shipping jumps).
  const sellerCartCount = useMemo(() => {
    if (!seller) return 0;
    const slug = seller.name.toLowerCase();
    return cart.items.reduce((n, it) => (it.seller?.toLowerCase() === slug ? n + it.amount : n), 0);
  }, [cart.items, seller]);

  // On a seller page, fetch just that one route (seller country → your country)
  // on demand and cache it. No bulk sync — ensureMatrix no-ops when it's already
  // fresh or in flight.
  useEffect(() => {
    if (!seller || shipping.toCountry == null || sellerCountryIdVal == null) return;
    void shippingStore.ensureMatrix(sellerCountryIdVal);
  }, [seller, shipping.toCountry, sellerCountryIdVal]);

  // Prefetch each ranked seller's route so the "+ ship" column is ready without
  // clicking anything (deduped/cached by the store).
  useEffect(() => {
    if (shipping.toCountry == null) return;
    for (const row of sellers.rows) {
      const id = countryId(row.location);
      if (id != null) void shippingStore.ensureMatrix(id);
    }
  }, [sellers.rows, shipping.toCountry]);

  /** Cheapest shipping method a source country would charge for an order. */
  const shipEstimate = (
    fromCountryId: number | null | undefined,
    cardCount: number,
    orderValue: number,
  ): ShippingEstimate | null => {
    if (fromCountryId == null || cardCount <= 0) return null;
    const matrix = shipping.matrices[fromCountryId];
    if (!matrix) return null;
    return estimateShipping(matrix, cardCount, orderValue);
  };

  const [addingAll, setAddingAll] = useState(false);
  /** Add the cheapest article of each group to the cart, paced to stay polite. */
  const addGroups = async (groups: typeof visibleGrouped) => {
    setAddingAll(true);
    try {
      for (const g of groups) {
        const cheapest = g.offers.find(o => o.articleId);
        if (!cheapest?.articleId || added[cheapest.articleId] === 'added') continue;
        await addOne(cheapest);
        await new Promise(r => setTimeout(r, 400 + Math.random() * 400));
      }
    } finally {
      setAddingAll(false);
    }
  };

  const addAll = () => addGroups(visibleGrouped);

  // ---- Multi-select --------------------------------------------------------
  // One selection for both views (they list the same cards in the same order).
  // Its actions are the row actions in bulk: cheapest-to-cart, and clearing a
  // card off every want list it's on.
  const selection = useRowSelection(visibleGrouped.map(g => cardKey(g.name)));
  const selectedGroups = (): typeof visibleGrouped => {
    const picked = new Set(selection.ids);
    return visibleGrouped.filter(g => picked.has(cardKey(g.name)));
  };

  /** Clear each selected card off every want list holding it, one at a time. */
  const removeSelected = async () => {
    for (const g of selectedGroups()) {
      if (placementsFor(g.name).length === 0) continue;
      await removeFromAllLists(g.name);
    }
    selection.clear();
  };

  // ---- Market prices (snapshot trend + live From on demand) ----------------
  // Scryfall's daily `eur` tracks Cardmarket's Price Trend closely enough to
  // colour every row for free. Live page fetches only earn their keep for the
  // live *From* (and a printing-exact trend) when the offer is near market — or
  // when the user asks for one row. One request per card, paced, still.
  const { snapshot } = usePrices(requestPrices);
  const [prices, setPrices] = useState<Record<string, PriceGuide>>({});
  const [priceStatus, setPriceStatus] = useState<'idle' | 'loading'>('idle');
  const [priceProgress, setPriceProgress] = useState<{
    done: number;
    name: string;
    total: number;
  } | null>(null);
  // cardKey currently being fetched, for an inline per-row "loading…" hint.
  const [priceLoadingKey, setPriceLoadingKey] = useState<string | null>(null);
  const priceAbort = useRef<AbortController | null>(null);
  /** Product URLs we already tried this session (hit or miss), so auto-confirm
   *  doesn't re-walk the same close calls when the list refilters. */
  const liveAttempted = useRef(new Set<string>());

  const parseEuro = (s?: string): number | undefined => {
    if (!s) return undefined;
    const v = Number.parseFloat(s.replace(/[^\d,]/g, '').replace(',', '.'));
    return Number.isFinite(v) ? v : undefined;
  };

  const fmtEuro = (n?: number): string | undefined =>
    n == null ? undefined : `${n.toFixed(2).replace('.', ',')} €`;

  /** Snapshot reference for an offer (by name + foil — seller rows rarely carry set codes). */
  const snapshotTrend = (o: Pick<ScanMatch, 'isFoil' | 'name'>): number | undefined => {
    if (!snapshot) return undefined;
    const price = priceOf({ foil: o.isFoil, name: o.name }, snapshot);
    return price ? price.cents / 100 : undefined;
  };

  /** Does this offer need a live page to decide, or is the snapshot already enough? */
  const needsLive = (o: ScanMatch): boolean => {
    if (!o.productUrl || prices[o.productUrl]) return false;
    const offer = o.priceValue;
    const trend = snapshotTrend(o);
    if (trend == null || offer == null) return true;
    const ratio = offer / trend;
    return ratio >= CLOSE_LO && ratio <= CLOSE_HI;
  };

  const liveTargets = (
    mode: 'close' | 'all',
  ): { key: string; name: string; url: string }[] => {
    const targets: { key: string; name: string; url: string }[] = [];
    const seen = new Set<string>();
    for (const g of visibleGrouped) {
      const o = g.offers.find(offer => offer.productUrl);
      const url = o?.productUrl;
      if (!o || !url || prices[url] || seen.has(url)) continue;
      if (mode === 'close' && !needsLive(o)) continue;
      seen.add(url);
      targets.push({ key: cardKey(g.name), name: g.name, url });
    }
    return targets;
  };

  const loadPrices = async (mode: 'close' | 'all' = 'close') => {
    const targets = liveTargets(mode).filter(t => !liveAttempted.current.has(t.url));
    if (targets.length === 0) return;
    const controller = new AbortController();
    priceAbort.current = controller;
    setPriceStatus('loading');
    try {
      for (let i = 0; i < targets.length; i++) {
        if (controller.signal.aborted) break;
        const t = targets[i];
        liveAttempted.current.add(t.url);
        setPriceLoadingKey(t.key);
        setPriceProgress({ done: i, name: t.name, total: targets.length });
        try {
          const guide = await fetchPriceGuide(t.url, controller.signal);
          setPrices(p => ({ ...p, [t.url]: guide }));
          void persistPrice(t.url, guide);
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') break;
        }
        setPriceProgress({ done: i + 1, name: t.name, total: targets.length });
        await new Promise(r => setTimeout(r, 300 + Math.random() * 300));
      }
    } finally {
      setPriceStatus('idle');
      setPriceProgress(null);
      setPriceLoadingKey(null);
      priceAbort.current = null;
    }
  };

  const confirmOneLive = async (o: ScanMatch) => {
    const url = o.productUrl;
    if (!url || prices[url] || priceStatus === 'loading') return;
    liveAttempted.current.add(url);
    const controller = new AbortController();
    priceAbort.current = controller;
    setPriceStatus('loading');
    setPriceLoadingKey(cardKey(o.name));
    setPriceProgress({ done: 0, name: o.name, total: 1 });
    try {
      const guide = await fetchPriceGuide(url, controller.signal);
      setPrices(p => ({ ...p, [url]: guide }));
      void persistPrice(url, guide);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        // leave the row on the snapshot figure
      }
    } finally {
      setPriceStatus('idle');
      setPriceProgress(null);
      setPriceLoadingKey(null);
      priceAbort.current = null;
    }
  };

  // When the snapshot lands, quietly confirm the close calls on the visible
  // list — the ones where a live page can still change the colour.
  useEffect(() => {
    if (!snapshot || priceStatus === 'loading') return;
    if (liveTargets('close').filter(t => !liveAttempted.current.has(t.url)).length === 0) return;
    void loadPrices('close');
    // Intentionally tied to the visible set + snapshot, not to every price write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, visibleGrouped]);

  // ---- Other editions / foil (one "Show Offers" request per card) ----------
  // Keyed by cardKey. Each metacard page aggregates every printing + foil, so a
  // single request powers the "other editions / foil" breakdown for a card.
  const [editions, setEditions] = useState<Record<string, EditionPrice[]>>({});
  const [editionsState, setEditionsState] = useState<
    Record<string, 'loading' | 'error' | 'challenge'>
  >({});
  const [openEditions, setOpenEditions] = useState<Set<string>>(new Set());

  // Rehydrate cached prices + editions from chrome.storage on mount, dropping
  // anything older than PRICE_MAX_AGE_MS so stale figures don't reappear.
  useEffect(() => {
    void chrome.storage.local.get([PRICE_STORAGE_KEY, EDITIONS_STORAGE_KEY]).then(stored => {
      const now = Date.now();
      const pMap = (stored[PRICE_STORAGE_KEY] ?? {}) as Record<string, StampedPrice>;
      const fresh: Record<string, PriceGuide> = {};
      for (const [url, v] of Object.entries(pMap)) {
        if (v && now - v.ts < PRICE_MAX_AGE_MS) {
          fresh[url] = v.guide;
          liveAttempted.current.add(url);
        }
      }
      if (Object.keys(fresh).length) setPrices(p => ({ ...fresh, ...p }));

      const eMap = (stored[EDITIONS_STORAGE_KEY] ?? {}) as Record<string, StampedEditions>;
      const freshEds: Record<string, EditionPrice[]> = {};
      for (const [k, v] of Object.entries(eMap)) {
        if (v && now - v.ts < PRICE_MAX_AGE_MS) freshEds[k] = v.editions;
      }
      if (Object.keys(freshEds).length) setEditions(e => ({ ...freshEds, ...e }));
    });
  }, []);

  const toggleEditions = async (key: string, name: string, productUrl?: string) => {
    const willOpen = !openEditions.has(key);
    setOpenEditions(s => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
    // Fetch lazily the first time it's opened. We can resolve the card from a
    // product URL when present, otherwise from its name (metacard-page rows).
    if (!willOpen || editions[key] || editionsState[key] === 'loading') return;
    setEditionsState(s => ({ ...s, [key]: 'loading' }));
    try {
      const eds = await fetchCardEditions({ name, productUrl });
      setEditions(e => ({ ...e, [key]: eds }));
      void persistEditions(key, eds);
      setEditionsState(s => {
        const n = { ...s };
        delete n[key];
        return n;
      });
    } catch (err) {
      const challenge = err instanceof Error && err.message.startsWith('CHALLENGE:');
      setEditionsState(s => ({ ...s, [key]: challenge ? 'challenge' : 'error' }));
    }
  };

  // ---- Remove from all want lists (Feature 1) ------------------------------
  // Per cardKey status: 'removing' | 'done' | '<error message>'. `confirmKey`
  // gates the destructive action behind an explicit in-row confirmation.
  const [removeState, setRemoveState] = useState<Record<string, 'removing' | 'done' | string>>({});
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  const placementsFor = (name: string): WantPlacement[] =>
    index?.cards[cardKey(name)]?.placements ?? [];

  /** Remove a card from every want list that contains it, then update the index. */
  const removeFromAllLists = async (name: string) => {
    const key = cardKey(name);
    const placements = placementsFor(name);
    setConfirmKey(null);
    if (placements.length === 0 || !index) return;
    const token = findCmToken();
    if (!token) {
      setRemoveState(s => ({
        ...s,
        [key]: 'No session token found — remove one want manually once, then retry.',
      }));
      return;
    }
    setRemoveState(s => ({ ...s, [key]: 'removing' }));

    const removed = new Set<string>(); // listIds successfully cleared
    let firstError: string | null = null;
    for (const p of placements) {
      try {
        const r = await deleteWant(p.listId, p.idWant, token);
        if (r.ok) removed.add(p.listId);
        else if (!firstError) firstError = r.message;
      } catch (err) {
        if (!firstError) firstError = err instanceof Error ? err.message : String(err);
      }
      await new Promise(r => setTimeout(r, 400 + Math.random() * 400));
    }

    // Reflect the removals in the local index so the UI stays truthful without
    // a full re-sync. Drop cleared placements; delete the card if fully gone.
    const next: WantsIndex = {
      ...index,
      cards: { ...index.cards },
      lists: index.lists.map(l =>
        removed.has(l.id) ? { ...l, extracted: Math.max(0, l.extracted - 1) } : l,
      ),
    };
    const entry = next.cards[key];
    if (entry) {
      const keptPlacements = (entry.placements ?? []).filter(p => !removed.has(p.listId));
      if (keptPlacements.length === 0) {
        delete next.cards[key];
      } else {
        const keptListNames = new Set(keptPlacements.map(p => p.listName));
        next.cards[key] = {
          ...entry,
          lists: entry.lists.filter(n => keptListNames.has(n)),
          placements: keptPlacements,
        };
      }
    }
    await wantsStore.applyIndex(next);

    setRemoveState(s => ({
      ...s,
      [key]: firstError
        ? `Removed from ${removed.size}/${placements.length}. ${firstError}`
        : 'done',
    }));
  };

  /** Recon helper: copy one raw offer row so selectors can be verified/fixed. */
  const copyOfferRow = async () => {
    const row =
      document.querySelector('[id^="articleRow"], [id^="stockRow"]') ??
      document.querySelector('a[href*="/Products/Singles/"]')?.closest('.row');
    if (row) await navigator.clipboard.writeText(row.outerHTML);
  };

  // On a single want-list page (`/Wants/<id>`) we can read the per-card want rows.
  const onWantListPage = /\/Wants\/\d+/.test(location.pathname);

  /** Recon helper: copy one raw want-list row so I can write the row parser. */
  const copyWantRow = async () => {
    const row =
      document.querySelector('table tbody tr') ??
      document.querySelector('.want-name')?.closest('.card, .row, li, tr');
    if (row) await navigator.clipboard.writeText(row.outerHTML);
  };

  // Purchase-history recon. The completed-purchases list lives under
  // `/Orders/Purchases`; an individual order is `/Orders/<id>`.
  const onPurchasesListPage = /\/Orders\/(Purchases|Sales)\b/i.test(location.pathname);
  const onOrderPage = /\/Orders\/\d+/.test(location.pathname);

  /** Recon helper: copy the page's main content so I can write the parsers. */
  const copyMainHtml = async () => {
    const main = document.querySelector('main');
    if (main) await navigator.clipboard.writeText(main.outerHTML);
  };

  const metaLine = (o: ScanMatch) =>
    [o.edition, o.condition, o.language].filter(Boolean).join(' · ');

  /**
   * "In cart" tag. Solid/blue when this exact offer is in the extension cart,
   * subtle/grey when a different printing of the same card is.
   */
  const inCartTag = (exact: boolean, sameCard: boolean) => {
    if (!exact && !sameCard) return null;
    return (
      <Badge
        title={
          exact ? 'This offer is in your cart' : 'Another printing of this card is in your cart'
        }
        tone={exact ? 'accent' : 'neutral'}
      >
        in cart
      </Badge>
    );
  };
  const offerInCart = (o: ScanMatch) =>
    inCartTag(!!o.articleId && cartArticleIds.has(o.articleId), cartCardKeys.has(cardKey(o.name)));

  /**
   * "Purchased" tag: this card (any printing) is in the scanned order history.
   * Shows the most recent buy date + unit price (for tracking gains); the
   * tooltip lists every purchase.
   */
  const purchaseSummary = (name: string) => {
    const entry = purchaseLookup.get(stripVersion(cardKey(name)));
    if (!entry) return null;
    const recs = entry.purchases ?? [];
    const latest = recs.reduce<PurchaseRecord | undefined>(
      (best, r) => ((r.ts ?? 0) >= (best?.ts ?? 0) ? r : best),
      undefined,
    );
    const price = fmtEuro(latest?.price);
    return {
      count: entry.count,
      date: latest?.date,
      label: latest?.date ? `bought ${latest.date}${price ? ` · ${price}` : ''}` : 'purchased',
      tip: recs.length
        ? recs
            .slice()
            .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
            .map(
              r =>
                `${r.date ?? '?'}${r.price != null ? ` — ${fmtEuro(r.price)}` : ''} (#${r.orderId})`,
            )
            .join('\n')
        : 'You bought this card before',
    };
  };

  const purchasedTag = (name: string) => {
    const bought = purchaseSummary(name);
    if (!bought) return null;
    // Grey rather than loud: what you paid is context for the price beside it,
    // not a state you act on. The tooltip carries every purchase.
    return (
      <Badge className="max-w-full truncate" title={bought.tip} tone="neutral">
        {bought.label}
        {bought.count > 1 && <span className="ml-1 opacity-70">×{bought.count}</span>}
      </Badge>
    );
  };

  /**
   * "Owned" tag: this card (any printing) is in the user's imported collection.
   * Shows the owned quantity when more than one copy is held.
   */
  const ownedTag = (name: string) => {
    const qty = ownedLookup.get(stripVersion(cardKey(name)));
    if (!qty) return null;
    return (
      <Badge title={`In your collection${qty > 1 ? ` — ${qty} copies` : ''}`} tone="pos">
        owned
        {qty > 1 && <span className="ml-1 opacity-70">×{qty}</span>}
      </Badge>
    );
  };

  /** Foil printing. Amber everywhere, including the printings inside a group. */
  const foilTag = (isFoil?: boolean) =>
    isFoil ? (
      <Badge title="Foil printing" tone="warn">
        foil
      </Badge>
    ) : null;

  /**
   * Facts about a card, as pips that sit on top of its art in the box view.
   * Nothing here is clickable, so it costs the picture a corner instead of the
   * tile a line — and each pip keeps its meaning in a tooltip.
   */
  const artStatus = (name: string, isFoil: boolean, rep?: ScanMatch) => {
    const owned = ownedLookup.get(stripVersion(cardKey(name)));
    const exact = !!rep?.articleId && cartArticleIds.has(rep.articleId);
    const inCart = exact || cartCardKeys.has(cardKey(name));
    if (!isFoil && !owned && !inCart) return null;
    return (
      <div className="absolute left-1 top-1 flex items-center gap-1">
        {isFoil && (
          <span className={ART_CHIP} title="Foil printing">
            {/* Filled, not outlined: at 12px an outline is a few lit pixels and
                reads as a smudge. Foil should be the brightest thing here. */}
            <Sparkles aria-hidden className="text-amber-200" fill="currentColor" size={12} />
          </span>
        )}
        {!!owned && (
          <span
            className={ART_CHIP}
            title={`In your collection${owned > 1 ? ` — ${owned} copies` : ''}`}
          >
            <Library aria-hidden className="text-emerald-200" size={12} strokeWidth={2.5} />
            {owned > 1 && <span>{owned}</span>}
          </span>
        )}
        {inCart && (
          <span
            className={ART_CHIP}
            title={
              exact ? 'This offer is in your cart' : 'Another printing of this card is in your cart'
            }
          >
            <ShoppingCart
              aria-hidden
              className={exact ? 'text-sky-200' : 'text-white/70'}
              size={12}
              strokeWidth={2.5}
            />
          </span>
        )}
      </div>
    );
  };

  /** Purchase history pip: the date reads at a glance, the rest is in the tip. */
  const artPurchase = (name: string) => {
    const bought = purchaseSummary(name);
    if (!bought) return null;
    return (
      <span className={`${ART_CHIP} absolute right-1 top-1`} title={bought.tip}>
        <ReceiptEuro aria-hidden className="text-white/70" size={11} />
        {bought.date ?? 'bought'}
        {bought.count > 1 && <span className="text-white/60">×{bought.count}</span>}
      </span>
    );
  };

  /** The want lists a card is on, along the foot of its art. */
  const artLists = (lists: string[]) => (
    <div className="absolute inset-x-0 bottom-0 flex items-end gap-1 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-1 pb-1 pt-4">
      {lists.length > 0 ? (
        lists.map(list => (
          <span key={list} className={`${ART_CHIP} min-w-0 truncate`} title={list}>
            {list}
          </span>
        ))
      ) : (
        <span className={`${ART_CHIP} text-white/60`}>not on a want list</span>
      )}
    </div>
  );

  /** Price + market-price comparison (trend / from) for one offer. */
  const renderPrice = (o: ScanMatch, inline = false) => {
    const guide = o.productUrl ? prices[o.productUrl] : undefined;
    const snap = snapshotTrend(o);
    const liveTrend = parseEuro(guide?.trend);
    const trendVal = liveTrend ?? snap;
    const trendLabel = guide?.trend ?? (snap != null ? money(Math.round(snap * 100)) : undefined);
    const live = liveTrend != null;
    const ratio = trendVal && o.priceValue ? o.priceValue / trendVal : null;
    // Green when at/below trend (good deal), amber when notably above.
    const priceColor =
      ratio == null
        ? 'text-slate-100'
        : ratio <= 1.0
          ? 'text-emerald-300'
          : ratio <= 1.2
            ? 'text-slate-100'
            : 'text-amber-300';
    const loading = priceStatus === 'loading' && !guide && priceLoadingKey === cardKey(o.name);
    const canConfirm = !!o.productUrl && !guide && !loading;
    const askLive = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      void confirmOneLive(o);
    };
    const trend = trendLabel && (
      <span
        className={`whitespace-nowrap ${canConfirm ? 'cursor-pointer hover:text-slate-300' : ''}`}
        onClick={canConfirm ? askLive : undefined}
        title={
          canConfirm
            ? 'Snapshot trend — click for Cardmarket’s live From / Trend'
            : live
              ? 'Cardmarket live trend'
              : undefined
        }
      >
        trend {trendLabel}
        {!live && snap != null ? <span className="text-slate-600"> ~</span> : null}
        {ratio != null && ratio <= 1.0 && <span className="text-emerald-400"> ✓</span>}
      </span>
    );
    const from = guide?.from && <span className="whitespace-nowrap">from {guide.from}</span>;
    const price = o.price && (
      <span className={`whitespace-nowrap text-[12px] font-semibold tabular-nums ${priceColor}`}>
        {o.price}
      </span>
    );
    const spinner = loading && (
      <span className="animate-pulse text-[9px] text-sky-400">loading price…</span>
    );
    // One-line rows put the market comparison beside the price rather than under
    // it, so the bold numbers still form one column to read down. Stacked, the two
    // figures only help if they line up: labels left, amounts right, and the "good
    // deal" tick in its own gutter so it can't nudge a number out of line.
    if (inline) {
      return (
        <div className="flex items-center justify-end gap-1.5">
          {(trendLabel || guide?.from || spinner) && (
            <span className="grid grid-cols-[auto_1fr_0.6rem] items-baseline gap-x-1 text-[9px] leading-[1.3] text-slate-500">
              {trendLabel && (
                <>
                  <span
                    className={canConfirm ? 'cursor-pointer hover:text-slate-300' : undefined}
                    onClick={canConfirm ? askLive : undefined}
                    title={
                      canConfirm
                        ? 'Snapshot trend — click for Cardmarket’s live From / Trend'
                        : undefined
                    }
                  >
                    trend
                  </span>
                  <span
                    className={`text-right tabular-nums ${canConfirm ? 'cursor-pointer hover:text-slate-300' : ''}`}
                    onClick={canConfirm ? askLive : undefined}
                  >
                    {trendLabel}
                    {!live && snap != null ? <span className="text-slate-600"> ~</span> : null}
                  </span>
                  <span className="text-emerald-400">
                    {ratio != null && ratio <= 1.0 ? '✓' : ''}
                  </span>
                </>
              )}
              {guide?.from && (
                <>
                  <span>from</span>
                  <span className="text-right tabular-nums">{guide.from}</span>
                  <span />
                </>
              )}
              {spinner && <span className="col-span-3 text-right">{spinner}</span>}
            </span>
          )}
          {price}
        </div>
      );
    }
    return (
      <div className="flex flex-col items-end leading-tight">
        {price}
        {(trend || from) && (
          <span className="text-[9px] text-slate-500">
            {trend}
            {trend && from ? ' · ' : ''}
            {from}
          </span>
        )}
        {spinner}
      </div>
    );
  };

  /**
   * Hover-preview handlers shared by the list-view icon and the box-view tiles.
   * Shows the full card near the cursor and, for double-faced cards, lets a
   * click flip to the back (the edition-specific back is derived from the
   * Cardmarket product id embedded in the image URL when present).
   */
  const previewHandlers = (src: string, name?: string) => {
    const key = name ? cardKey(name) : '';
    const faces = key ? facesByKey[key] : undefined;
    const flippable = !!faces && faces.length >= 2;
    const productId = src.match(/\/(\d+)\.(?:jpg|jpeg|png|webp)(?:[?#]|$)/)?.[1];
    const editionBack = productId
      ? `https://api.scryfall.com/cards/cardmarket/${productId}?format=image&version=normal&face=back`
      : undefined;
    return {
      flippable,
      handlers: {
        onClick: (e: { preventDefault: () => void; stopPropagation: () => void }) => {
          if (!flippable) return;
          e.preventDefault();
          e.stopPropagation();
          previewStore.flip();
        },
        onMouseEnter: (e: { clientX: number; clientY: number }) => {
          previewStore.show(
            { index: 0, key, urls: flippable ? [src, editionBack ?? faces![1]] : [src] },
            e.clientX,
            e.clientY,
          );
          if (key && faces === undefined && name) loadFaces(key, name, editionBack);
        },
        onMouseLeave: () => previewStore.hide(),
        onMouseMove: (e: { clientX: number; clientY: number }) =>
          previewStore.move(e.clientX, e.clientY),
      },
    };
  };

  /**
   * Small image icon that shows a hover preview of the card. For double-faced
   * cards it becomes clickable (flip cursor) to switch the shown side.
   */
  const imageIcon = (url?: string, name?: string) => {
    const src = cardImageSrc(url, name);
    if (!src) return null;
    const { flippable, handlers } = previewHandlers(src, name);
    return (
      <span
        aria-label={flippable ? 'Preview card image — click to flip' : 'Preview card image'}
        className={`inline-flex h-4 w-4 flex-none items-center justify-center rounded hover:text-sky-300 ${
          flippable ? 'cursor-pointer text-sky-400' : 'cursor-zoom-in text-slate-400'
        }`}
        onClick={handlers.onClick}
        onMouseEnter={handlers.onMouseEnter}
        onMouseLeave={handlers.onMouseLeave}
        onMouseMove={handlers.onMouseMove}
        title={flippable ? 'Click to flip to the other side' : undefined}
      >
        {flippable ? (
          <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 3.5a6.5 6.5 0 015.9 3.8l1.2-1.2v3.9h-3.9l1.5-1.5A5 5 0 0010 5V3.5zm0 13a6.5 6.5 0 01-5.9-3.8L2.9 13.9V10h3.9l-1.5 1.5A5 5 0 0010 15v1.5z" />
          </svg>
        ) : (
          <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M4 3.5h12a1.5 1.5 0 011.5 1.5v10A1.5 1.5 0 0116 16.5H4A1.5 1.5 0 012.5 15V5A1.5 1.5 0 014 3.5zm0 1.5v6.2l3.2-3.2 3 3 3.3-3.3L16 10.4V5H4zm3 1.6a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4z" />
          </svg>
        )}
      </span>
    );
  };

  /** Info icon that toggles the "other editions / foil" breakdown for a card. */
  const editionsInfo = (key: string, name: string, productUrl?: string) => {
    const open = openEditions.has(key);
    return (
      <button
        aria-label="Other editions and foil prices"
        className={`inline-flex h-4 w-4 flex-none items-center justify-center rounded-full border text-[9px] font-bold ${
          open
            ? 'border-sky-400 bg-sky-500/20 text-sky-300'
            : 'border-slate-600 text-slate-400 hover:border-sky-400 hover:text-sky-300'
        }`}
        onClick={e => {
          e.preventDefault();
          e.stopPropagation();
          void toggleEditions(key, name, productUrl);
        }}
        title="Show From / Price Trend for other editions & foil"
        type="button"
      >
        i
      </button>
    );
  };

  /** Expanded per-edition/foil price breakdown (cheapest offer per printing). */
  const editionsPanel = (key: string) => {
    if (!openEditions.has(key)) return null;
    const state = editionsState[key];
    const eds = editions[key];
    return (
      <div className="mt-1 rounded border border-slate-800 bg-slate-900/60 p-1.5 text-[10px]">
        {state === 'loading' && <div className="text-slate-500">Loading editions…</div>}
        {state === 'error' && (
          <div className="text-red-400">Couldn't load the card's other editions.</div>
        )}
        {state === 'challenge' && (
          <div className="flex flex-wrap items-center gap-2 text-amber-400">
            <span>
              Cardmarket is asking you to verify you're human. Your seller scan is saved and will
              still be here.
            </span>
            <Button onClick={() => location.reload()} size="xs" variant="neutral">
              Reload and verify
            </Button>
          </div>
        )}
        {!state && eds && eds.length === 0 && (
          <div className="text-slate-500">No edition data found.</div>
        )}
        {!state && eds && eds.length > 0 && (
          <table className="w-full border-collapse">
            <tbody>
              {eds.map((ed, i) => (
                <tr key={`${ed.edition}|${ed.isFoil}|${i}`} className="text-slate-300">
                  <td className="py-0.5 pr-2">
                    <span className="truncate">{ed.edition}</span>
                    {ed.isFoil && (
                      <span className="ml-1 rounded bg-amber-500/20 px-1 text-[8px] font-semibold text-amber-300">
                        FOIL
                      </span>
                    )}
                  </td>
                  <td className="py-0.5 pr-2 text-right text-slate-500">
                    {ed.count} offer{ed.count === 1 ? '' : 's'}
                  </td>
                  <td className="py-0.5 text-right font-semibold text-slate-100">
                    {ed.from ? `from ${ed.from}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  };

  /**
   * For id-less rows (e.g. spoiler pages) that carry a product link: an "Add to
   * want list" button whose dropdown lists the user's want lists. Rows without a
   * product link keep the plain "no id" marker.
   */
  const renderWantListControl = (o: ScanMatch) => {
    const url = o.productUrl;
    if (!url) return <span className="text-[9px] text-slate-600">no id</span>;
    const st = wantAdd[url];
    if (st?.status === 'added') {
      return (
        <span className="text-[10px] font-semibold text-emerald-400">
          ✓ Added{st.listName ? ` to ${st.listName}` : ''}
        </span>
      );
    }
    const open = wantMenu === url;
    return (
      <div className="relative flex flex-col items-end">
        <Button
          disabled={st?.status === 'adding'}
          onClick={() => {
            setWantMenu(open ? null : url);
            if (!open) void ensureWantLists();
          }}
          size="xs"
          variant="primary"
        >
          {st?.status === 'adding' ? 'Adding…' : '+ Want ▾'}
        </Button>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setWantMenu(null)} />
            <div className="absolute right-0 top-full z-50 mt-1 max-h-48 w-44 overflow-auto rounded border border-slate-700 bg-slate-900 py-1 shadow-lg">
              {wantListOptions === null ? (
                <div className="px-2 py-1 text-[10px] text-slate-500">
                  {listsLoading ? 'Loading lists…' : 'No want lists found — sync them first.'}
                </div>
              ) : wantListOptions.length === 0 ? (
                <div className="px-2 py-1 text-[10px] text-slate-500">You have no want lists.</div>
              ) : (
                wantListOptions.map(l => (
                  <button
                    key={l.id}
                    className="block w-full truncate px-2 py-1 text-left text-[11px] text-slate-200 hover:bg-slate-800"
                    onClick={() => void addToWantList(o, l)}
                    type="button"
                  >
                    {l.name}
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>
    );
  };

  /** Add-to-cart button / status for one offer (no price). */
  const addAction = (o: ScanMatch) => {
    const state = o.articleId ? added[o.articleId] : undefined;
    if (!o.articleId) return renderWantListControl(o);
    if (state === 'added')
      return <span className="text-[10px] font-semibold text-emerald-400">✓ In cart</span>;
    return (
      <Button disabled={state === 'adding'} onClick={() => addOne(o)} size="xs" variant="primary">
        {state === 'adding' ? 'Adding…' : 'Add'}
      </Button>
    );
  };

  /** Right-hand price + market comparison + Add button / status for one offer. */
  const renderAddControl = (o: ScanMatch) => (
    <div className="flex flex-col items-end gap-1">
      {renderPrice(o)}
      {addAction(o)}
    </div>
  );

  const renderAddError = (o: ScanMatch) => {
    const cartState = o.articleId ? added[o.articleId] : undefined;
    if (cartState && cartState !== 'adding' && cartState !== 'added') {
      return <div className="mt-1 text-[10px] text-red-400">{cartState}</div>;
    }
    const wantState = o.productUrl ? wantAdd[o.productUrl] : undefined;
    if (wantState?.status === 'error') {
      return <div className="mt-1 text-[10px] text-red-400">{wantState.msg}</div>;
    }
    return null;
  };

  const listBadges = (lists: string[], inline = false) => (
    <div
      className={inline ? 'flex min-w-0 items-center gap-1' : 'mt-0.5 flex flex-wrap gap-1'}
      title={inline && lists.length > 1 ? lists.join(', ') : undefined}
    >
      {/* Grey: a list name is a label, and green is reserved for "you own it". */}
      {lists.map(list => (
        <Badge key={list} className={`px-1.5 ${inline ? 'truncate' : ''}`} tone="neutral">
          {list}
        </Badge>
      ))}
    </div>
  );

  /**
   * "Remove from all want lists" control for a card. Only rendered when we have
   * the card's per-list `idWant` placements (i.e. it's on the synced want
   * index). Destructive, so it's gated behind an inline confirmation.
   */
  const removeControl = (name: string) => {
    const key = cardKey(name);
    const placements = placementsFor(name);
    if (placements.length === 0) return null;
    const state = removeState[key];
    if (state === 'done' || state === 'removing' || confirmKey === key) {
      return removeStatus(name);
    }
    return (
      <div className="mt-0.5">
        <Button
          onClick={() => setConfirmKey(key)}
          size="xs"
          title={`Remove from ${placements.length === 1 ? 'want list' : `all ${new Set(placements.map(p => p.listName)).size} want lists`}`}
          variant="subtle"
        >
          Remove from want {placements.length === 1 ? 'list' : 'lists'}
        </Button>
        {removeStatus(name)}
      </div>
    );
  };

  /**
   * Everything about the remove flow except the button that starts it: the
   * confirmation, the progress, the outcome. One-line rows show this under the
   * row, where there's width for the question.
   */
  const removeStatus = (name: string) => {
    const key = cardKey(name);
    const placements = placementsFor(name);
    if (placements.length === 0) return null;
    const state = removeState[key];
    if (state === 'done') {
      return <span className="text-[10px] font-semibold text-slate-500">Removed from wants</span>;
    }
    if (state === 'removing') {
      return <span className="text-[10px] text-slate-400">Removing…</span>;
    }
    if (confirmKey === key) {
      const listNames = [...new Set(placements.map(p => p.listName))];
      return (
        <div className="mt-1 rounded border border-red-500/40 bg-red-500/10 p-1.5 text-[10px]">
          <div className="text-red-200">
            Remove <span className="font-semibold">{name}</span> from{' '}
            {listNames.length === 1 ? (
              <span className="font-semibold">{listNames[0]}</span>
            ) : (
              <span className="font-semibold">{listNames.length} lists</span>
            )}
            ?
            {listNames.length > 1 && (
              <span className="text-red-300/80"> ({listNames.join(', ')})</span>
            )}
          </div>
          <div className="mt-1 flex gap-1.5">
            <Button onClick={() => void removeFromAllLists(name)} size="xs" variant="danger">
              Remove
            </Button>
            <Button onClick={() => setConfirmKey(null)} size="xs" variant="neutral">
              Cancel
            </Button>
          </div>
        </div>
      );
    }
    // Anything else in `removeState` is a failure message.
    if (typeof state === 'string') {
      return <div className="mt-0.5 text-[10px] text-red-400">{state}</div>;
    }
    return null;
  };

  /** Compact trash affordance for one-line rows; appears on hover or focus. */
  const removeIcon = (name: string) => {
    const key = cardKey(name);
    const placements = placementsFor(name);
    if (placements.length === 0 || removeState[key] || confirmKey === key) return null;
    const lists = new Set(placements.map(p => p.listName)).size;
    return (
      <IconButton
        className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
        icon={Trash2}
        label={`Remove from ${lists === 1 ? 'want list' : `all ${lists} want lists`}`}
        onClick={() => setConfirmKey(key)}
        size="xs"
        tone="danger"
      />
    );
  };

  /**
   * Colour / mana / type filters. Built here rather than inline because a wide
   * panel keeps them in its sidebar while a narrow one opens them over the list.
   */
  const filterControls = (
    <div className="space-y-1.5 border-b border-slate-800/60 px-2 py-1.5 text-[10px]">
      <div className="flex items-center gap-1.5">
        <span className="font-semibold uppercase tracking-wide text-slate-400">Filters</span>
        {filtersActive && (
          <Button
            className="ml-auto"
            onClick={() => {
              setFQuery('');
              setFColors(new Set());
              setFCmc(new Set());
              setFSubtype('');
            }}
            size="xs"
            variant="subtle"
          >
            Clear
          </Button>
        )}
      </div>
      <input
        className="w-full min-w-0 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200 outline-none focus:border-sky-500"
        onChange={e => setFQuery(e.target.value)}
        placeholder="words to combine (e.g. elf legendary)"
        value={fQuery}
      />
      {fTerms.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {fTerms.map(t => (
            <Button
              key={t}
              className="font-semibold"
              onClick={() => removeTerm(t)}
              pill
              size="xs"
              title="Remove term"
              variant="primary"
            >
              {t}
              <span className="opacity-70">×</span>
            </Button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-slate-500">Color:</span>
        {FILTER_COLORS.map(c => (
          <button
            key={c.code}
            className={`h-5 w-5 rounded-full text-[10px] font-bold ${c.cls} ${
              fColors.has(c.code) ? 'ring-2 ring-sky-400' : 'opacity-60'
            }`}
            onClick={() =>
              setFColors(prev => {
                const next = new Set(prev);
                if (next.has(c.code)) next.delete(c.code);
                else next.add(c.code);
                return next;
              })
            }
            type="button"
          >
            {c.code}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-slate-500">Mana:</span>
        {MANA_VALUE_BUCKETS.map(v => (
          <button
            key={v}
            className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold ${
              fCmc.has(v)
                ? 'bg-slate-600 text-slate-100 ring-2 ring-sky-400'
                : 'bg-slate-800 text-slate-300 opacity-60 hover:opacity-100'
            }`}
            onClick={() =>
              setFCmc(prev => {
                const next = new Set(prev);
                if (next.has(v)) next.delete(v);
                else next.add(v);
                return next;
              })
            }
            title={`Mana value ${manaValueLabel(v)}`}
            type="button"
          >
            {manaValueLabel(v)}
          </button>
        ))}
      </div>
      {availableSubtypes.length > 0 && (
        <select
          className="w-full rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-slate-200 outline-none focus:border-sky-500"
          onChange={e => setFSubtype(e.target.value)}
          title="Creature type / subtype"
          value={fSubtype}
        >
          <option value="">Any subtype</option>
          {availableSubtypes.map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      )}
      <div className="text-slate-500">
        {metaState === 'loading'
          ? 'Loading card data from Scryfall…'
          : metaState === 'error'
            ? 'Couldn\u2019t load card data — try again.'
            : filtersActive
              ? `${visibleGrouped.length} of ${effectiveList ? grouped.filter(g => g.lists.includes(effectiveList)).length : grouped.length} shown`
              : 'Pick a color, subtype, or type a creature type to filter.'}
      </div>
    </div>
  );

  return (
    <div ref={panelRef} className="flex h-full flex-col">
      {/* Slim bar to collapse the management chrome so the list gets the space */}
      <div className="flex items-center gap-2 border-b border-slate-800 px-2 py-1 text-[10px] text-slate-400">
        <Button
          className="font-semibold"
          onClick={() => setToolsOpen(v => !v)}
          size="xs"
          title={toolsOpen ? 'Hide sync / scan tools' : 'Show sync / scan tools'}
          variant="subtle"
        >
          <span className="inline-block w-2">{toolsOpen ? '▾' : '▸'}</span>
          Tools
        </Button>
        {/* Keep essential progress visible even when collapsed. */}
        {!toolsOpen && activeTasks.length > 0 && (
          <span className="truncate text-sky-400">
            {activeTasks[0].label}
            {activeTasks[0].status === 'running' && activeTasks[0].progress
              ? ` ${activeTasks[0].progress.current}/${activeTasks[0].progress.total}`
              : activeTasks[0].status === 'queued'
                ? ' queued'
                : '…'}
            {activeTasks.length > 1 && ` (+${activeTasks.length - 1})`}
          </span>
        )}
        {!toolsOpen && scan.status === 'scanning' && (
          <span className="truncate text-emerald-400">
            Scanning {seller?.name}
            {scan.progress ? ` — ${scan.progress.current}` : '…'}
          </span>
        )}
        {!toolsOpen && scan.status === 'done' && seller && (
          <span className="truncate text-slate-500">
            scan saved · {scan.matches.length} matches
          </span>
        )}
      </div>

      {/* Shipping cost tiers for the seller you're browsing (always visible) */}
      {seller &&
        (() => {
          // Home country not known yet → prompt / show auto-detect progress.
          if (shipping.toCountry == null) {
            return (
              <div className="border-b border-slate-800 bg-slate-900/40 px-2 py-1 text-[10px] text-slate-500">
                {detectingCountry ? (
                  'Detecting your country from your account…'
                ) : (
                  <>
                    Set your country under{' '}
                    <span className="font-semibold text-slate-400">Tools</span> to see {seller.name}
                    's shipping.
                  </>
                )}
              </div>
            );
          }
          // Seller country couldn't be read — offer a one-time manual pick.
          if (sellerCountryIdVal == null) {
            return (
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900/40 px-2 py-1 text-[10px] text-slate-500">
                <span className="font-semibold text-amber-300">Shipping</span>
                <span>Couldn't detect {seller.name}'s country — pick it:</span>
                <select
                  className="rounded border border-slate-700 bg-slate-800 px-1 py-0.5 text-slate-200"
                  onChange={e =>
                    setSellerCountryOverride(e.target.value ? Number(e.target.value) : null)
                  }
                  value=""
                >
                  <option value="">Pick…</option>
                  {COUNTRIES.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            );
          }
          // Route not loaded yet — fetching on demand, or failed (offer retry).
          if (sellerTiers.length === 0) {
            return (
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900/40 px-2 py-1 text-[10px] text-slate-500">
                <span className="font-semibold text-amber-300">Shipping</span>
                <span>
                  {countryName(sellerCountryIdVal)} → {countryName(shipping.toCountry)}
                </span>
                {sellerShipError ? (
                  <>
                    <span className="text-red-400">couldn't load rates</span>
                    <Button
                      onClick={() => void shippingStore.ensureMatrix(sellerCountryIdVal, true)}
                      size="xs"
                      variant="neutral"
                    >
                      Retry
                    </Button>
                  </>
                ) : (
                  <span className="animate-pulse text-sky-400">fetching rates…</span>
                )}
              </div>
            );
          }
          // Highlight the tier your *current cart* for this seller falls into —
          // the first tier that can still hold `sellerCartCount` cards. Adding a
          // card that pushes past this tier's max is where shipping jumps.
          const chosenIdx = (() => {
            const i = sellerTiers.findIndex(t => sellerCartCount <= t.maxCards);
            return i === -1 ? sellerTiers.length - 1 : i;
          })();
          const chosenTier = sellerTiers[chosenIdx];
          return (
            <div className="flex flex-wrap items-center gap-x-2 border-b border-slate-800 bg-slate-900/40 px-2 py-1 text-[10px]">
              <span className="font-semibold text-amber-300">Shipping</span>
              <span className="text-slate-300">
                {countryName(sellerCountryIdVal)} → {countryName(shipping.toCountry)}
              </span>
              {chosenTier && (
                <span className="text-slate-500">
                  {sellerCartCount} in cart →{' '}
                  <span className="font-semibold text-emerald-300">
                    {fmtEuro(chosenTier.price)}
                  </span>{' '}
                  (up to {chosenTier.maxCards} card{chosenTier.maxCards === 1 ? '' : 's'})
                  {chosenTier.isTracked && (
                    <span className="ml-1 text-[8px] text-sky-400">tracked</span>
                  )}
                </span>
              )}
              {/* The other tiers are worth a look but not worth ten rows of the
                  panel, so they wait behind the icon — right where the line it
                  belongs to ends. */}
              <span className="group relative flex items-center">
                <button
                  aria-label={`All ${sellerTiers.length} shipping tiers for this route`}
                  className="flex text-slate-500 transition-colors hover:text-slate-200 group-focus-within:text-slate-200"
                  type="button"
                >
                  <Info aria-hidden size={12} />
                </button>
                <div className="invisible absolute right-0 top-full z-30 mt-1 rounded-md border border-slate-700 bg-slate-900 p-1.5 shadow-pop group-hover:visible group-focus-within:visible">
                  <table className="border-collapse whitespace-nowrap text-slate-400">
                    {/* The middle column is Cardmarket's cap on the order's value
                        for that tier, which nothing on the row itself says. */}
                    <thead>
                      <tr className="text-slate-600">
                        <th className="pr-3 text-left font-normal">tier</th>
                        <th className="pr-3 text-right font-normal">order up to</th>
                        <th className="text-right font-normal">postage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sellerTiers.map((t, i) => {
                        const isChosen = i === chosenIdx;
                        return (
                          <tr
                            key={`${t.name}|${t.maxCards}|${i}`}
                            className={isChosen ? 'text-emerald-300' : undefined}
                          >
                            <td className="py-0.5 pr-3">
                              up to {t.maxCards} card{t.maxCards === 1 ? '' : 's'}
                              {t.isTracked && (
                                <span className="ml-1 text-[8px] text-sky-400">tracked</span>
                              )}
                            </td>
                            <td className="py-0.5 pr-3 text-right text-slate-600">
                              ≤ {fmtEuro(t.maxValue)}
                            </td>
                            <td
                              className={`py-0.5 text-right font-semibold ${isChosen ? 'text-emerald-300' : 'text-slate-200'}`}
                            >
                              {fmtEuro(t.price)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </span>
            </div>
          );
        })()}

      {/* Below the two full-width lines the panel splits in two once it has the
          room: filters and tools to the left, the cards to the right. Narrow, the
          same blocks simply stack above the list as before. */}
      <div className={wide ? 'flex min-h-0 flex-1' : 'flex min-h-0 flex-1 flex-col'}>
        <div
          className={
            wide ? 'w-[18.5rem] flex-none overflow-auto border-r border-slate-800' : 'flex-none'
          }
        >
          {/* Wide, the filters live here for good — always in view, never in the
              way. Narrow, they stay under their button in the results header. */}
          {wide && filterControls}

          {/* Task queue — long actions run one at a time and survive navigation */}
          {toolsOpen && tasks.length > 0 && (
            <div className="border-b border-slate-800 bg-slate-900/60 p-2 text-[11px]">
              <div className="mb-1 flex items-center gap-2">
                <span className="font-semibold text-slate-300">Tasks</span>
                {tasks.some(t => t.status === 'queued' || t.status === 'running') && (
                  <span className="text-slate-500">
                    {tasks.filter(t => t.status === 'queued' || t.status === 'running').length}{' '}
                    active
                  </span>
                )}
                {tasks.some(t => t.status === 'done' || t.status === 'error') && (
                  <Button
                    className="ml-auto"
                    onClick={() => taskQueue.clearFinished()}
                    size="xs"
                    variant="subtle"
                  >
                    Clear finished
                  </Button>
                )}
              </div>
              <div className="max-h-32 space-y-1 overflow-auto">
                {tasks.map(t => (
                  <div key={t.id} className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        t.status === 'running'
                          ? 'animate-pulse bg-sky-400'
                          : t.status === 'queued'
                            ? 'bg-slate-500'
                            : t.status === 'done'
                              ? 'bg-emerald-500'
                              : 'bg-red-500'
                      }`}
                    />
                    <span className="shrink-0 text-slate-300">{t.label}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-500">
                      {t.status === 'running'
                        ? t.progress
                          ? taskProgress(t.progress)
                          : 'running…'
                        : t.status === 'queued'
                          ? 'queued'
                          : t.status === 'done'
                            ? (t.summary ?? 'done')
                            : (t.error ?? 'failed')}
                    </span>
                    {(t.status === 'queued' || t.status === 'running') && (
                      <Button
                        className="shrink-0"
                        onClick={() => taskQueue.cancel(t.id)}
                        size="xs"
                        title={t.status === 'queued' ? 'Cancel' : 'Stop'}
                        variant="neutral"
                      >
                        {t.status === 'queued' ? 'Cancel' : 'Stop'}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sync controls */}
          {toolsOpen && (
            <div className="border-b border-slate-800 p-2 text-[11px]">
              {status === 'syncing' || status === 'queued' ? (
                <div className="flex items-center gap-2">
                  <span className="text-slate-300">
                    {status === 'queued'
                      ? 'Queued — waiting for the current task…'
                      : `Syncing ${progress ? `${progress.current}/${progress.total}` : ''}…`}
                    {status === 'syncing' && progress && (
                      <span className="ml-1 text-slate-500">{progress.listName}</span>
                    )}
                  </span>
                  <Button
                    className="ml-auto"
                    onClick={() => wantsTask && taskQueue.cancel(wantsTask.id)}
                    variant="neutral"
                  >
                    {status === 'queued' ? 'Cancel' : 'Stop'}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => {
                      wantsStore.markQueued();
                      taskQueue.enqueue('syncWants', 'Sync want lists');
                    }}
                    size="md"
                    variant="primary"
                  >
                    {index ? 'Re-sync want lists' : 'Sync my want lists'}
                  </Button>
                  {index && (
                    <span className="text-slate-500">
                      {index.lists.length} lists · {totalWanted} cards · {timeAgo(index.syncedAt)}
                    </span>
                  )}
                  {index && (
                    <Button className="ml-auto" onClick={() => wantsStore.clear()} variant="subtle">
                      Clear
                    </Button>
                  )}
                </div>
              )}
              {status === 'syncing' && progress && (
                <div className="mt-2 h-1 w-full overflow-hidden rounded bg-slate-800">
                  <div
                    className="h-full bg-sky-500 transition-all"
                    style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  />
                </div>
              )}
              {error && <div className="mt-1 text-red-400">{error}</div>}
              {mismatches.length > 0 && (
                <div className="mt-1 text-[10px] text-amber-400">
                  {mismatches.length} list(s) came up short vs their card count — some may paginate
                  differently. Send me one want-list page's HTML to fix.
                </div>
              )}
              {index && (
                <details className="mt-1 text-[10px] text-slate-400">
                  <summary className="cursor-pointer select-none">Diagnostics</summary>
                  <div className="mt-1 space-y-0.5">
                    {index.diagnostics.map((d, i) => (
                      <div key={i} className="text-slate-400">
                        {d}
                      </div>
                    ))}
                    {index.lists.length > 0 && (
                      <div className="mt-1 border-t border-slate-800 pt-1">
                        {index.lists.map(l => (
                          <div
                            key={l.id}
                            className={
                              l.extracted < l.expected ? 'text-amber-400' : 'text-slate-500'
                            }
                          >
                            {l.name}: {l.extracted}
                            {l.expected >= 0 ? ` / ${l.expected}` : ''}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </details>
              )}
            </div>
          )}

          {/* Purchase-history sync — powers the "Purchased" tag while browsing */}
          {toolsOpen && (
            <div className="border-b border-slate-800 p-2 text-[11px]">
              {purchases.status === 'syncing' || purchases.status === 'queued' ? (
                <div className="flex items-center gap-2">
                  <span className="text-slate-300">
                    {purchases.status === 'queued'
                      ? 'Queued — waiting for the current task…'
                      : purchases.progress?.phase === 'orders'
                        ? `Scanning purchases ${purchases.progress.current}/${purchases.progress.total}…`
                        : 'Preparing purchase scan…'}
                    {purchases.status === 'syncing' && purchases.progress && (
                      <span className="ml-1 text-slate-500">{purchases.progress.listName}</span>
                    )}
                  </span>
                  <Button
                    className="ml-auto"
                    onClick={() => purchaseTask && taskQueue.cancel(purchaseTask.id)}
                    variant="neutral"
                  >
                    {purchases.status === 'queued' ? 'Cancel' : 'Stop'}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => {
                      purchaseStore.markQueued();
                      taskQueue.enqueue('syncPurchases', 'Sync purchases');
                    }}
                    size="md"
                    variant="primary"
                  >
                    {purchases.index ? 'Re-sync purchases' : 'Sync my purchases'}
                  </Button>
                  {purchases.index && (
                    <span className="text-slate-500">
                      {purchasedKeys.size} cards · {purchases.index.orderIds.length} orders ·{' '}
                      {timeAgo(purchases.index.syncedAt)}
                    </span>
                  )}
                  {purchases.index && (
                    <Button
                      className="ml-auto"
                      onClick={() => purchaseStore.clear()}
                      variant="subtle"
                    >
                      Clear
                    </Button>
                  )}
                </div>
              )}
              <label className="mt-2 flex items-start gap-2 text-slate-400">
                <input
                  checked={addPurchasesToCollection}
                  className="mt-0.5"
                  onChange={e => {
                    setAddPurchasesToCollection(e.target.checked);
                    setAddPurchasesToCollectionState(e.target.checked);
                  }}
                  type="checkbox"
                />
                <span>
                  Add purchases to my collection
                  <span className="block text-[10px] text-slate-500">
                    Folds bought cards into the Collection tab after each sync.
                  </span>
                </span>
              </label>
              {purchases.status === 'syncing' && purchases.progress && (
                <div className="mt-2 h-1 w-full overflow-hidden rounded bg-slate-800">
                  {purchases.progress.phase === 'orders' ? (
                    <div
                      className="h-full bg-violet-500 transition-all"
                      style={{
                        width: `${(purchases.progress.current / Math.max(1, purchases.progress.total)) * 100}%`,
                      }}
                    />
                  ) : (
                    // Listing phase has no meaningful total on the same scale — show an
                    // indeterminate sweep instead of a determinate width that would
                    // rewind when the order-fetch phase starts.
                    <div className="h-full w-1/3 animate-pulse rounded bg-violet-500/70" />
                  )}
                </div>
              )}
              {purchases.error && <div className="mt-1 text-red-400">{purchases.error}</div>}
              {purchases.index && (
                <details className="mt-1 text-[10px] text-slate-400">
                  <summary className="cursor-pointer select-none">
                    Purchase scan diagnostics
                  </summary>
                  <div className="mt-1 space-y-0.5">
                    {purchases.index.diagnostics.map((d, i) => (
                      <div key={i}>{d}</div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {/* Shipping — just your home country; per-seller rates load on demand */}
          {toolsOpen && (
            <div className="border-b border-slate-800 p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-400">Ship to</span>
                <select
                  className="rounded border border-slate-700 bg-slate-800 px-1 py-1 text-slate-200"
                  onChange={e =>
                    void shippingStore.setToCountry(e.target.value ? Number(e.target.value) : null)
                  }
                  title="Your country — shipping is calculated to here"
                  value={shipping.toCountry ?? ''}
                >
                  <option value="">Select your country…</option>
                  {COUNTRIES.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <Button
                  disabled={detectingCountry}
                  onClick={() => {
                    setDetectingCountry(true);
                    void shippingStore
                      .detectHomeCountry()
                      .finally(() => setDetectingCountry(false));
                  }}
                  title="Read your country from your Cardmarket account"
                  variant="neutral"
                >
                  {detectingCountry ? 'Detecting…' : 'Detect'}
                </Button>
                {Object.keys(shipping.matrices).length > 0 && (
                  <Button
                    className="ml-auto"
                    onClick={() => void shippingStore.clear()}
                    title="Forget cached shipping rates"
                    variant="subtle"
                  >
                    Clear rates
                  </Button>
                )}
              </div>
              <div className="mt-1 text-[10px] text-slate-500">
                {shipping.toCountry == null
                  ? 'Pick your country (or Detect). Each seller\u2019s rates then load automatically when you open their page.'
                  : `Shipping to ${countryName(shipping.toCountry)} · seller rates load on demand${
                      Object.keys(shipping.matrices).length
                        ? ` · ${Object.keys(shipping.matrices).length} cached`
                        : ''
                    }.`}
              </div>
            </div>
          )}

          {/* Seller scan controls */}
          {toolsOpen && index && seller && (
            <div className="border-b border-slate-800 p-2 text-[11px]">
              {scan.status === 'scanning' ? (
                <div className="flex items-center gap-2">
                  <span className="text-slate-300">
                    {scan.progress?.phase === 'wantlists' ? 'Filtering' : 'Scanning'} {seller.name}
                    {scan.progress
                      ? scan.progress.phase === 'wantlists'
                        ? ` — list ${scan.progress.current}/${scan.progress.total}`
                        : ` — page ${scan.progress.current}`
                      : '…'}
                    {scan.progress && (
                      <span className="ml-1 text-slate-500">
                        {scan.progress.label ? `${scan.progress.label} · ` : ''}
                        {scan.progress.found} match{scan.progress.found === 1 ? '' : 'es'}
                      </span>
                    )}
                  </span>
                  <Button
                    className="ml-auto"
                    onClick={() => abortRef.current?.abort()}
                    variant="neutral"
                  >
                    Stop
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={runScan} size="md" variant="success">
                    {scan.status === 'done'
                      ? `Re-scan ${seller.name}`
                      : `Scan ${seller.name}'s offers`}
                  </Button>
                  <select
                    className="rounded border border-slate-700 bg-slate-800 px-1 py-1 text-slate-300"
                    onChange={e => setForced(e.target.value as 'auto' | ScanStrategy)}
                    title="How to search the seller's stock"
                    value={forced}
                  >
                    <option value="auto">Auto (cheapest)</option>
                    <option value="wantlists">By want lists</option>
                    <option value="pages">By pages</option>
                  </select>
                  {scan.status === 'done' && (
                    <span className="text-slate-500">
                      {scan.strategy === 'wantlists' ? 'want-list filter' : 'page scan'} ·{' '}
                      {scan.requests} request{scan.requests === 1 ? '' : 's'}
                      {scan.scannedAt && ` · saved ${timeAgo(scan.scannedAt)}`}
                    </span>
                  )}
                </div>
              )}
              {scan.status === 'scanning' && scan.progress && scan.progress.total > 0 && (
                <div className="mt-2 h-1 w-full overflow-hidden rounded bg-slate-800">
                  <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{ width: `${(scan.progress.current / scan.progress.total) * 100}%` }}
                  />
                </div>
              )}
              {scan.error && <div className="mt-1 text-red-400">{scan.error}</div>}
              {scan.diagnostics.length > 0 && (
                <details className="mt-1 text-[10px] text-slate-400">
                  <summary className="cursor-pointer select-none">Scan diagnostics</summary>
                  <div className="mt-1 space-y-0.5">
                    {scan.diagnostics.map((d, i) => (
                      <div key={i}>{d}</div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>

        {/* Main column: what this page is about, then the cards themselves. */}
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Want-list page: rank sellers by coverage, priced + with missing cards */}
          {onWantListPage && wantListId && (
            <div className="border-b border-slate-800 p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={sellers.status === 'loading'}
                  onClick={loadSellers}
                  size="md"
                  variant="primary"
                >
                  {sellers.status === 'loading'
                    ? 'Finding sellers…'
                    : sellers.status === 'done'
                      ? 'Refresh best sellers'
                      : 'Find best sellers for this list'}
                </Button>
                {listCards.size > 0 && (
                  <span className="text-slate-500">
                    {listCards.size} card{listCards.size === 1 ? '' : 's'} in this list
                  </span>
                )}
                {index && listCards.size === 0 && (
                  <span className="text-amber-400">
                    Sync your want lists to price sellers &amp; find missing cards.
                  </span>
                )}
              </div>
              {sellers.error && <div className="mt-1 text-red-400">{sellers.error}</div>}

              {sellers.rows.length > 0 && (
                <div className="mt-2 space-y-1">
                  {sellers.rows.map(row => {
                    const p = priced[row.idSeller];
                    return (
                      <div
                        key={row.idSeller}
                        className="rounded border border-slate-800 bg-slate-900/40 p-1.5"
                      >
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <a
                            className="font-semibold text-sky-300 hover:underline"
                            href={`${row.url}/Offers/Singles?idWantslist=${wantListId}`}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {row.name}
                          </a>
                          <span className="text-slate-400">
                            {row.count}
                            {listCards.size > 0 ? `/${listCards.size}` : ''} · {row.pct}%
                          </span>
                          {row.sales && <span className="text-slate-600">{row.sales} sales</span>}
                          {row.location && <span className="text-slate-600">{row.location}</span>}
                          {p?.status === 'done' && p.total != null && (
                            <span className="font-semibold text-emerald-300">
                              {fmtEuro(p.total)}
                              <span className="ml-1 font-normal text-slate-500">
                                ({p.matched} card{p.matched === 1 ? '' : 's'})
                              </span>
                            </span>
                          )}
                          {p?.status === 'done' &&
                            p.total != null &&
                            (() => {
                              const est = shipEstimate(
                                countryId(row.location),
                                p.matched ?? 0,
                                p.total ?? 0,
                              );
                              if (!est) return null;
                              return (
                                <span
                                  className="text-amber-300"
                                  title={`${est.method.name} from ${row.location} · ≈${est.weight} g`}
                                >
                                  + ship ≈{fmtEuro(est.method.price)}
                                  <span className="ml-1 font-semibold text-emerald-200">
                                    = {fmtEuro((p.total ?? 0) + est.method.price)}
                                  </span>
                                </span>
                              );
                            })()}
                          <Button
                            className="ml-auto"
                            disabled={p?.status === 'loading'}
                            onClick={() => priceSeller(row)}
                            size="xs"
                            variant="neutral"
                          >
                            {p?.status === 'loading'
                              ? 'Pricing…'
                              : p?.status === 'done'
                                ? 'Re-price'
                                : 'Price it'}
                          </Button>
                        </div>
                        {p?.status === 'error' && (
                          <div className="mt-1 text-red-400">{p.error}</div>
                        )}
                        {p?.status === 'done' && p.missing && p.missing.length > 0 && (
                          <details className="mt-1 text-[10px] text-amber-300/90">
                            <summary className="cursor-pointer select-none">
                              Missing {p.missing.length} card{p.missing.length === 1 ? '' : 's'}
                            </summary>
                            <div className="mt-0.5 text-slate-400">{p.missing.join(', ')}</div>
                          </details>
                        )}
                        {p?.status === 'done' &&
                          p.missing &&
                          p.missing.length === 0 &&
                          listCards.size > 0 && (
                            <div className="mt-0.5 text-[10px] text-emerald-400">
                              Has every card in the list.
                            </div>
                          )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Order page: remove the purchase from all want lists */}
          {shipmentId && (
            <div className="border-b border-slate-800 p-2 text-[11px]">
              {cleanupTask &&
              (cleanupTask.status === 'running' || cleanupTask.status === 'queued') ? (
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-300">
                      {cleanupTask.status === 'queued'
                        ? 'Queued — clearing this purchase from want lists…'
                        : `Removing purchase from want lists — ${cleanupTask.progress?.current ?? 0}/${cleanupTask.progress?.total || '…'}`}
                      {cleanupTask.status === 'running' && cleanupTask.progress?.label && (
                        <span className="ml-1 text-slate-500">{cleanupTask.progress.label}</span>
                      )}
                    </span>
                    <Button
                      className="ml-auto"
                      onClick={() => taskQueue.cancel(cleanupTask.id)}
                      variant="neutral"
                    >
                      {cleanupTask.status === 'queued' ? 'Cancel' : 'Stop'}
                    </Button>
                  </div>
                  {cleanupTask.status === 'running' &&
                    cleanupTask.progress &&
                    cleanupTask.progress.total > 0 && (
                      <div className="mt-2 h-1 w-full overflow-hidden rounded bg-slate-800">
                        <div
                          className="h-full bg-red-500 transition-all"
                          style={{
                            width: `${(cleanupTask.progress.current / cleanupTask.progress.total) * 100}%`,
                          }}
                        />
                      </div>
                    )}
                </div>
              ) : confirmingCleanup ? (
                <div className="rounded border border-red-500/40 bg-red-500/10 p-2">
                  <div className="text-red-200">
                    Remove every card you bought in this order from{' '}
                    <span className="font-semibold">all your want lists</span>? This runs one
                    request per list at human pace and can't be undone automatically.
                  </div>
                  <div className="mt-2 flex gap-1.5">
                    <Button
                      onClick={() => {
                        setConfirmingCleanup(false);
                        // Capture the CSRF token now (the order page has one) so the
                        // task still works if it runs after you've navigated away.
                        taskQueue.enqueue('cleanupWants', 'Clean want lists', {
                          shipmentId,
                          token: findCmToken() ?? undefined,
                        });
                      }}
                      size="md"
                      variant="danger"
                    >
                      Remove from all want lists
                    </Button>
                    <Button onClick={() => setConfirmingCleanup(false)} size="md" variant="neutral">
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => setConfirmingCleanup(true)} size="md" variant="danger">
                    Remove this purchase from all want lists
                  </Button>
                  {cleanupTask?.status === 'done' && (
                    <span className="text-slate-500">{cleanupTask.summary}</span>
                  )}
                  {cleanupTask?.status === 'error' && (
                    <span className="text-red-400">{cleanupTask.error}</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Results: whole-seller scan when done, else the current page's cards */}
          <div ref={listRef} className="min-h-0 flex-1 overflow-auto">
            {
              <>
                <div className="sticky top-0 z-10 bg-slate-900">
                  <div className="flex items-center gap-2 px-2 py-1 text-[10px] text-slate-500">
                    <span>
                      {showingScan ? (
                        <>
                          {visibleGrouped.length} card{visibleGrouped.length === 1 ? '' : 's'}
                          {effectiveList ? ` in "${effectiveList}"` : ' on your want lists'}
                          {scan.strategy === 'pages' && ` (scanned ${scan.totalScanned} offers)`}
                        </>
                      ) : (
                        <>
                          {visibleGrouped.length} card{visibleGrouped.length === 1 ? '' : 's'}
                          {effectiveList ? ` in "${effectiveList}"` : ' on this page'}
                          {!effectiveList && index && ` · ${wantedCount} on your want lists`}
                        </>
                      )}
                    </span>
                    <div className="ml-auto flex items-center gap-1.5">
                      <ViewToggle onChange={setResultsView} value={resultsView} />
                      {/* Wide, the filters are permanently in the sidebar. */}
                      {!wide && (
                        <Button
                          active={showFilters || filtersActive}
                          className="font-semibold"
                          onClick={() => setShowFilters(v => !v)}
                          size="xs"
                          title="Filter matches by color / creature type / subtype"
                          variant="neutral"
                        >
                          Filters{filtersActive ? ' •' : ''}
                        </Button>
                      )}
                      {showingScan && visibleGrouped.some(g => g.offers.some(o => o.articleId)) && (
                        <Button
                          disabled={addingAll}
                          onClick={addAll}
                          size="xs"
                          title="Add the cheapest offer of each card"
                          variant="success"
                        >
                          {addingAll ? 'Adding…' : 'Add cheapest of each'}
                        </Button>
                      )}
                      {visibleGrouped.some(g => g.offers.some(o => o.productUrl)) &&
                        (priceStatus === 'loading' ? (
                          <Button
                            className="max-w-[220px] truncate"
                            onClick={() => priceAbort.current?.abort()}
                            size="xs"
                            title={priceProgress ? `Loading ${priceProgress.name}` : undefined}
                            variant="neutral"
                          >
                            Stop{' '}
                            {priceProgress ? `${priceProgress.done}/${priceProgress.total}` : ''}
                            {priceProgress?.name ? ` · ${priceProgress.name}` : ''}
                          </Button>
                        ) : (
                          (() => {
                            const close = liveTargets('close').filter(
                              t => !liveAttempted.current.has(t.url),
                            ).length;
                            const rest = liveTargets('all').filter(
                              t => !liveAttempted.current.has(t.url),
                            ).length;
                            if (close === 0 && rest === 0) return null;
                            return (
                              <Button
                                className="font-semibold"
                                onClick={() => void loadPrices(close > 0 ? 'close' : 'all')}
                                size="xs"
                                title={
                                  close > 0
                                    ? 'Snapshot already colours every row. Fetches Cardmarket’s live From/Trend only for offers near market.'
                                    : 'Fetch Cardmarket’s live From/Trend for every visible card (on demand).'
                                }
                                variant="neutral"
                              >
                                {close > 0 ? `Confirm ${close} live` : 'Check all live'}
                              </Button>
                            );
                          })()
                        ))}
                      {flags.devTools && (
                        <>
                          <Button
                            onClick={copyOfferRow}
                            size="xs"
                            title="Copy a raw offer row's HTML (for fixing parsing)"
                            variant="subtle"
                          >
                            Copy row
                          </Button>
                          {onWantListPage && (
                            <Button
                              onClick={copyWantRow}
                              size="xs"
                              title="Copy a raw want-list row's HTML (for the remove-from-wants feature)"
                              variant="subtle"
                            >
                              Copy want row
                            </Button>
                          )}
                          {onPurchasesListPage && (
                            <Button
                              onClick={copyMainHtml}
                              size="xs"
                              title="Copy this purchases list page (orders + pagination) for building the purchase scanner"
                              variant="subtle"
                            >
                              Copy purchases page
                            </Button>
                          )}
                          {onOrderPage && (
                            <Button
                              onClick={copyMainHtml}
                              size="xs"
                              title="Copy this order page (purchased items) for building the purchase scanner"
                              variant="subtle"
                            >
                              Copy order page
                            </Button>
                          )}
                          {Object.keys(prices).length > 0 && (
                            <Button
                              onClick={async () => {
                                const html = getLastGuideHtml();
                                if (html) await navigator.clipboard.writeText(html);
                              }}
                              size="xs"
                              title="Copy the last product's price-guide HTML (for foil/edition parsing)"
                              variant="subtle"
                            >
                              Copy guide
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {listTabs.length > 0 && (
                    <div className="flex flex-wrap gap-1 border-t border-slate-800/60 px-2 py-1">
                      <Button
                        active={effectiveList === null}
                        className="font-semibold"
                        onClick={() => setActiveList(null)}
                        size="xs"
                        variant="neutral"
                      >
                        All <span className="opacity-70">{grouped.length}</span>
                      </Button>
                      {listTabs.map(([name, count]) => (
                        <Button
                          key={name}
                          active={effectiveList === name}
                          className="max-w-[150px] truncate font-semibold"
                          onClick={() => setActiveList(name)}
                          size="xs"
                          title={name}
                          variant="neutral"
                        >
                          {name} <span className="opacity-70">{count}</span>
                        </Button>
                      ))}
                    </div>
                  )}
                  {!wide && showFilters && filterControls}
                  {visibleGrouped.length > 0 && (
                    <SelectionBar selection={selection}>
                      <Button
                        disabled={addingAll}
                        onClick={() => void addGroups(selectedGroups())}
                        size="xs"
                        title="Add the cheapest offer of each selected card to the cart"
                        variant="success"
                      >
                        {addingAll ? 'Adding…' : `Add ${selection.count} to cart`}
                      </Button>
                      {selectedGroups().some(g => placementsFor(g.name).length > 0) && (
                        <Button
                          onClick={() => void removeSelected()}
                          size="xs"
                          title="Remove the selected cards from every want list they're on"
                          variant="danger"
                        >
                          Remove from wants
                        </Button>
                      )}
                    </SelectionBar>
                  )}
                  {/* Column headings, so a row of numbers and codes reads as a table. */}
                  {oneLine && resultsView === 'list' && visibleGrouped.length > 0 && (
                    <div
                      className={`${ROW_COLUMNS} border-t border-slate-800/60 px-2 py-1 text-[9px] uppercase tracking-wide text-slate-600`}
                    >
                      <span>Card</span>
                      <span>Edition · condition</span>
                      <span>Want lists</span>
                      <span className="text-right">Price</span>
                      <span />
                      <span />
                    </div>
                  )}
                </div>
                {visibleGrouped.length === 0 ? (
                  <div className="p-4 text-center text-[11px] text-slate-500">
                    {showingScan
                      ? `None of ${seller?.name ?? 'this seller'}'s offers match your want lists.`
                      : 'No card offers detected on this page.'}
                  </div>
                ) : resultsView === 'box' ? (
                  <div
                    className="grid gap-2 p-2 outline-none [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]"
                    {...selection.listProps}
                  >
                    {visibleGrouped.map(g => {
                      const key = cardKey(g.name);
                      const src = cardImageSrc(g.offers.find(o => o.imageUrl)?.imageUrl, g.name);
                      const ready = !!src && loadedImages.has(src);
                      const preview = src ? previewHandlers(src, g.name) : null;
                      // Hover actions: add the cheapest offer with an article id to
                      // the cart, and remove the card from all want lists (only when
                      // we have its per-list placements from the synced index).
                      const cartOffer = g.offers.find(o => o.articleId);
                      const cartState = cartOffer?.articleId
                        ? added[cartOffer.articleId]
                        : undefined;
                      const canRemove = placementsFor(g.name).length > 0;
                      const removeListCount = new Set(placementsFor(g.name).map(p => p.listName))
                        .size;
                      const removing = removeState[key] === 'removing';
                      const rep = g.offers[0];
                      const anyFoil = g.offers.some(o => o.isFoil);
                      const guideUrl = g.offers.find(o => o.productUrl)?.productUrl;
                      const priceLoading =
                        priceStatus === 'loading' && !!guideUrl && !prices[guideUrl];
                      return (
                        <div
                          key={key}
                          {...selection.rowProps(
                            key,
                            'group relative flex h-full flex-col overflow-hidden rounded-md border border-line bg-panel',
                          )}
                        >
                          {/* The art gets the room, since that's what this view is
                          for. Everything you only ever read — foil, owned, in
                          cart, what you paid, which lists — rides on its edges.
                          Hovering still opens the full card. */}
                          <div
                            className="relative flex-none cursor-zoom-in overflow-hidden bg-canvas"
                            onClick={preview?.handlers.onClick}
                            onMouseEnter={preview?.handlers.onMouseEnter}
                            onMouseLeave={preview?.handlers.onMouseLeave}
                            onMouseMove={preview?.handlers.onMouseMove}
                            style={{ aspectRatio: `${ART_ASPECT}` }}
                          >
                            {ready ? (
                              // Blown up and pulled up-left until the art window
                              // alone fills the box. Percentages, so it holds at
                              // any tile size.
                              <img
                                alt={g.name}
                                className="absolute h-auto max-w-none"
                                src={src}
                                style={{
                                  left: `${(-ART_WINDOW.left / ART_WINDOW.width) * 100}%`,
                                  top: `${(-ART_WINDOW.top / ART_WINDOW.height) * 100}%`,
                                  width: `${(1 / ART_WINDOW.width) * 100}%`,
                                }}
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center">
                                <Loader2
                                  aria-hidden
                                  className="animate-spin text-ink-faint"
                                  size={14}
                                />
                              </div>
                            )}
                            {artStatus(g.name, anyFoil, rep)}
                            {artPurchase(g.name)}
                            {artLists(g.lists)}
                          </div>

                          <div className="flex min-w-0 flex-1 flex-col gap-1 p-2">
                            {/* Title line owns the full width; the two icons that
                            act on the card sit at its end, the destructive one
                            only once you're on the tile. */}
                            <div className="flex min-w-0 items-center gap-1">
                              <span
                                className="min-w-0 flex-1 truncate text-sm font-medium text-ink"
                                title={g.name}
                              >
                                {g.name}
                              </span>
                              {editionsInfo(key, g.name, guideUrl)}
                              {canRemove &&
                                !removing &&
                                removeState[key] !== 'done' &&
                                confirmKey !== key && (
                                  <IconButton
                                    className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                                    icon={Trash2}
                                    label={`Remove from ${
                                      removeListCount === 1
                                        ? 'want list'
                                        : `all ${removeListCount} want lists`
                                    }`}
                                    onClick={() => setConfirmKey(key)}
                                    size="xs"
                                    tone="danger"
                                  />
                                )}
                            </div>

                            <div className="truncate text-2xs text-ink-muted" title={metaLine(rep)}>
                              {metaLine(rep) || 'printing unknown'}
                            </div>

                            {removing ? (
                              <span className="text-2xs text-ink-muted">Removing…</span>
                            ) : removeState[key] === 'done' ? (
                              <span className="text-2xs font-medium text-ink-faint">
                                Removed from wants
                              </span>
                            ) : null}

                            {/* Footer: price where the eye lands last, action at
                            the far end. `mt-auto` lines it up across the row. */}
                            <div className="mt-auto flex items-center gap-2 border-t border-line pt-1.5">
                              {rep && renderPrice(rep, true)}
                              {priceLoading && !rep?.price && (
                                <span className="animate-pulse text-2xs text-accent">loading…</span>
                              )}
                              <span className="ml-auto flex-none">
                                {cartOffer &&
                                  (cartState === 'added' ? (
                                    <span className="text-2xs font-medium text-pos">✓ In cart</span>
                                  ) : (
                                    <Button
                                      disabled={cartState === 'adding'}
                                      onClick={() => addOne(cartOffer)}
                                      size="xs"
                                      title={
                                        cartState && cartState !== 'adding'
                                          ? cartState
                                          : 'Add cheapest to cart'
                                      }
                                      variant="primary"
                                    >
                                      {cartState === 'adding' ? 'Adding…' : 'Add'}
                                    </Button>
                                  ))}
                              </span>
                            </div>
                            {editionsPanel(key)}
                          </div>

                          {/* Inline confirm for the destructive remove (covers the box). */}
                          {confirmKey === key && (
                            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 bg-canvas/95 p-2 text-center">
                              <span className="text-2xs text-ink">
                                Remove from {removeListCount} list
                                {removeListCount === 1 ? '' : 's'}?
                              </span>
                              <div className="flex gap-1">
                                <Button
                                  onClick={() => void removeFromAllLists(g.name)}
                                  size="xs"
                                  variant="danger"
                                >
                                  Remove
                                </Button>
                                <Button
                                  onClick={() => setConfirmKey(null)}
                                  size="xs"
                                  variant="neutral"
                                >
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <ul
                    className="list-none divide-y divide-slate-800/60 outline-none"
                    {...selection.listProps}
                  >
                    {visibleGrouped.map(g => {
                      const key = cardKey(g.name);
                      // Single offer → flat row.
                      if (g.offers.length === 1) {
                        const o = g.offers[0];
                        const nameCell = (
                          <>
                            {imageIcon(o.imageUrl, o.name)}
                            <span className="truncate">{o.name}</span>
                            {foilTag(o.isFoil)}
                            {offerInCart(o)}
                            {purchasedTag(o.name)}
                            {ownedTag(o.name)}
                            {editionsInfo(key, o.name, o.productUrl)}
                          </>
                        );
                        // Wide: one line per card, columns aligned across rows.
                        if (oneLine) {
                          return (
                            <li key={key} {...selection.rowProps(key, 'group px-2 py-1')}>
                              <div className={ROW_COLUMNS}>
                                <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-slate-100">
                                  {nameCell}
                                </div>
                                <div
                                  className="truncate text-[10px] text-slate-400"
                                  title={metaLine(o)}
                                >
                                  {metaLine(o)}
                                </div>
                                {listBadges(g.lists, true)}
                                {renderPrice(o, true)}
                                <div className="flex justify-end">{addAction(o)}</div>
                                {removeIcon(g.name)}
                              </div>
                              {editionsPanel(key)}
                              {removeStatus(g.name)}
                              {renderAddError(o)}
                            </li>
                          );
                        }
                        return (
                          <li key={key} {...selection.rowProps(key, 'px-2 py-1.5')}>
                            <div className="flex items-start gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 text-[12px] text-slate-100">
                                  {nameCell}
                                </div>
                                {metaLine(o) && (
                                  <div className="mt-0.5 text-[10px] text-slate-400">
                                    {metaLine(o)}
                                  </div>
                                )}
                                {listBadges(g.lists)}
                                {removeControl(g.name)}
                              </div>
                              {renderAddControl(o)}
                            </div>
                            {editionsPanel(key)}
                            {renderAddError(o)}
                          </li>
                        );
                      }
                      // Multiple offers → collapsed dropdown.
                      const cheapest = g.offers[0];
                      const anyFoil = g.offers.some(o => o.isFoil);
                      const groupName = (
                        <>
                          {imageIcon(g.offers[0].imageUrl, g.name)}
                          <span className="truncate">{g.name}</span>
                          <span className="rounded bg-slate-700 px-1 text-[9px] text-slate-300">
                            {g.offers.length} editions
                          </span>
                          {foilTag(anyFoil)}
                          {inCartTag(
                            g.offers.some(o => o.articleId && cartArticleIds.has(o.articleId)),
                            cartCardKeys.has(key),
                          )}
                          {purchasedTag(g.name)}
                          {ownedTag(g.name)}
                          {editionsInfo(key, g.name, cheapest.productUrl)}
                        </>
                      );
                      const fromPrice = cheapest.price && (
                        <span className="whitespace-nowrap text-[10px] text-slate-400">
                          from{' '}
                          <span className="text-[12px] font-semibold tabular-nums text-slate-100">
                            {cheapest.price}
                          </span>
                        </span>
                      );
                      return (
                        <li key={key} {...selection.rowProps(key, 'group px-2 py-1.5')}>
                          <details className="group/rows">
                            {oneLine ? (
                              <summary
                                className={`${ROW_COLUMNS} cursor-pointer list-none px-0 py-0.5`}
                              >
                                <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-slate-100">
                                  {groupName}
                                </span>
                                <span
                                  className="truncate text-[10px] text-slate-400"
                                  title={metaLine(cheapest)}
                                >
                                  {metaLine(cheapest)}
                                </span>
                                {listBadges(g.lists, true)}
                                <span className="text-right">{fromPrice}</span>
                                <span className="flex justify-end text-slate-500">
                                  <ChevronDown
                                    aria-hidden
                                    className="transition-transform group-open/rows:rotate-180"
                                    size={13}
                                  />
                                </span>
                                {removeIcon(g.name)}
                              </summary>
                            ) : (
                              <summary className="flex cursor-pointer list-none items-center gap-2">
                                <span className="min-w-0 flex-1">
                                  <span className="flex items-center gap-1.5 text-[12px] text-slate-100">
                                    {groupName}
                                  </span>
                                  {listBadges(g.lists)}
                                </span>
                                {fromPrice}
                              </summary>
                            )}
                            {editionsPanel(key)}
                            {oneLine ? removeStatus(g.name) : removeControl(g.name)}
                            <ul
                              className={`mt-1.5 list-none border-l border-slate-800 pl-2 ${
                                oneLine ? '' : 'space-y-1.5'
                              }`}
                            >
                              {g.offers.map((o, i) => {
                                const offerTags = (
                                  <>
                                    {imageIcon(o.imageUrl, g.name)}
                                    {foilTag(o.isFoil)}
                                    {offerInCart(o)}
                                  </>
                                );
                                const offerMeta = metaLine(o) || (
                                  <span className="text-slate-600">details unavailable</span>
                                );
                                // The printings line up under the card's own columns,
                                // so comparing them is a straight vertical read.
                                if (oneLine) {
                                  return (
                                    <li key={o.articleId ?? i} className={`${ROW_COLUMNS} py-0.5`}>
                                      <span className="col-span-2 flex min-w-0 items-center gap-1.5 truncate text-[11px] text-slate-300">
                                        {offerTags}
                                        {offerMeta}
                                      </span>
                                      <span />
                                      {renderPrice(o, true)}
                                      <span className="flex justify-end">{addAction(o)}</span>
                                      <span />
                                      <span className="col-span-6 empty:hidden">
                                        {renderAddError(o)}
                                      </span>
                                    </li>
                                  );
                                }
                                return (
                                  <li key={o.articleId ?? i}>
                                    <div className="flex items-start gap-2">
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-1.5 text-[11px] text-slate-300">
                                          {offerTags}
                                          <span>{offerMeta}</span>
                                        </div>
                                      </div>
                                      {renderAddControl(o)}
                                    </div>
                                    {renderAddError(o)}
                                  </li>
                                );
                              })}
                            </ul>
                          </details>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            }
          </div>
        </div>
      </div>
    </div>
  );
};
