import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { Button } from './Button';
import { ImportReview } from './ImportReview';
import { SelectionBar } from './Selection';
import { useSequentialImages } from './useSequentialImages';

import { cardImageOverrideStore } from '@/content/cardImageOverrideStore';
import { collectionStore } from '@/content/collectionStore';
import { deckStore } from '@/content/deckStore';
import { expansionIconStore, normalizeSetName } from '@/content/expansionIconStore';
import { previewStore } from '@/content/previewStore';
import { purchaseStore } from '@/content/purchaseStore';
import { cardKey, stripVersion } from '@/lib/cardName';
import { inspectImport, type ImportDecision, type ImportInspection } from '@/lib/import';
import { requestScryfall, requestScryfallCached } from '@/lib/messaging';
import { MANA_VALUE_BUCKETS, manaValueBucket, manaValueLabel, type CardMetadata } from '@/lib/mtg';
import { fetchCardPrints, type CardPrint } from '@/lib/prints';
import {
  currentLang,
  fetchDoc,
  isNonCardName,
  type PurchaseRecord,
} from '@/sites/cardmarket/wants';
import { useRowSelection } from '@/ui/useRowSelection';

// Quick primary-type toggles that filter the collection directly.
const TYPE_TOGGLES = [
  'Creature',
  'Planeswalker',
  'Instant',
  'Sorcery',
  'Artifact',
  'Enchantment',
  'Land',
  'Battle',
] as const;

const FILTER_COLORS: { cls: string; code: string }[] = [
  { cls: 'bg-amber-100 text-amber-900', code: 'W' },
  { cls: 'bg-sky-500 text-white', code: 'U' },
  { cls: 'bg-slate-700 text-slate-100', code: 'B' },
  { cls: 'bg-red-500 text-white', code: 'R' },
  { cls: 'bg-emerald-600 text-white', code: 'G' },
  { cls: 'bg-slate-400 text-slate-900', code: 'C' },
];

const timeAgo = (ts: number): string => {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
};

const fmtEuro = (n?: number): string | undefined =>
  n == null ? undefined : `${n.toFixed(2).replace('.', ',')} €`;

/**
 * Direct Scryfall image-CDN URL for a printing id. Scryfall lays images out at
 * `/normal/front/<a>/<b>/<id>.jpg` (a/b = first two id chars). Hitting the CDN
 * directly means the browser caches the file and repeat hovers make no request
 * — unlike `api.scryfall.com/cards/...?format=image`, which is an API call
 * (redirect) every time and is what Scryfall asks us not to hammer.
 */
const cdnImageFromId = (scryfallId?: string): string | undefined => {
  if (!scryfallId || !/^[0-9a-f-]{36}$/i.test(scryfallId)) return undefined;
  return `https://cards.scryfall.io/normal/front/${scryfallId[0]}/${scryfallId[1]}/${scryfallId}.jpg`;
};

/** Last-resort image URL via the Scryfall API (only when no CDN url is known). */
const imageUrlFor = (scryfallId?: string, name?: string): string | undefined => {
  if (scryfallId) return `https://api.scryfall.com/cards/${scryfallId}?format=image&version=normal`;
  if (name)
    return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=normal`;
  return undefined;
};

/**
 * Scryfall API image URL for an *exact* printing, keyed by set code + collector
 * number (`/cards/{set}/{number}`). This is what makes the picture match the
 * printing you actually own (e.g. Core Set 2021 #279) instead of Scryfall's
 * default printing (#1), which is all a name-only lookup can return. Used when
 * the row has a set + number but no Scryfall id (plain-list / purchase imports).
 */
const imageUrlForPrinting = (setCode?: string, collectorNumber?: string): string | undefined => {
  const set = setCode?.trim().toLowerCase();
  const num = collectorNumber?.trim();
  if (!set || !num) return undefined;
  return `https://api.scryfall.com/cards/${encodeURIComponent(set)}/${encodeURIComponent(
    num,
  )}?format=image&version=normal`;
};

/**
 * Scryfall image URL for the *exact* printing identified by its Cardmarket
 * product id (`/cards/cardmarket/{id}`). Purchases carry this id, so it pins the
 * precise edition you bought — the most reliable source when we have no Scryfall
 * id or set + collector number.
 */
const imageFromProductId = (productId?: string): string | undefined => {
  if (!productId || !/^\d+$/.test(productId)) return undefined;
  return `https://api.scryfall.com/cards/cardmarket/${productId}?format=image&version=normal`;
};

/** One distinct printing owned (set + collector number + finish + quantity). */
interface OwnedPrinting {
  collectorNumber?: string;
  foil: boolean;
  /** Cardmarket image URL of this printing (captured from a purchase row). */
  imageUrl?: string;
  /** Cardmarket product id of this printing (from purchases), for its image. */
  productId?: string;
  qty: number;
  /** Scryfall id of this exact printing (ManaBox exports it), for its image. */
  scryfallId?: string;
  setCode?: string;
  setName?: string;
}

interface CollectionRow {
  collectorNumber?: string;
  /** Every distinct printing of this card the user owns (from the import). */
  editions: OwnedPrinting[];
  foil: number;
  imageUrl?: string;
  key: string;
  name: string;
  printings: number;
  productId?: string;
  scryfallId?: string;
  setCode?: string;
  total: number;
}

export const CollectionPanel = () => {
  const { collection, loading, error } = useSyncExternalStore(
    collectionStore.subscribe,
    collectionStore.getSnapshot,
  );
  const purchases = useSyncExternalStore(purchaseStore.subscribe, purchaseStore.getSnapshot);
  const overrides = useSyncExternalStore(
    cardImageOverrideStore.subscribe,
    cardImageOverrideStore.getSnapshot,
  );
  const expIcons = useSyncExternalStore(
    expansionIconStore.subscribe,
    expansionIconStore.getSnapshot,
  );

  // One-shot: pull the full expansion catalogue so every set has an icon, not
  // just the ones seen while browsing. Cheap (one same-origin request) and only
  // runs when we don't yet have a reasonably complete map.
  const prefetchedIcons = useRef(false);
  useEffect(() => {
    if (prefetchedIcons.current || expansionIconStore.isLoading()) return;
    if (Object.keys(expIcons).length >= 200) return;
    prefetchedIcons.current = true;
    void fetchDoc(`/${currentLang()}/Magic/Expansions`)
      .then(({ doc }) => expansionIconStore.captureFrom(doc))
      .catch(() => {
        // best-effort; opportunistic capture still fills the map as you browse
      });
  }, [expIcons]);

  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  /** A file read but not yet imported: the review is open over the panel. */
  const [pending, setPending] = useState<{
    inspection: ImportInspection;
    source: string;
  } | null>(null);
  const [search, setSearch] = useState('');

  // List vs. box (grid) view, persisted independently of the wants view.
  const [resultsView, setResultsView] = useState<'list' | 'box'>(() => {
    try {
      return localStorage.getItem('lugin:collectionView') === 'box' ? 'box' : 'list';
    } catch {
      return 'list';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('lugin:collectionView', resultsView);
    } catch {
      // ignore storage failures
    }
  }, [resultsView]);

  // "Not this version" picker: the row being corrected, plus its fetched prints.
  const [pickerRow, setPickerRow] = useState<CollectionRow | null>(null);
  const [prints, setPrints] = useState<CardPrint[]>([]);
  const [printsState, setPrintsState] = useState<'idle' | 'loading' | 'error'>('idle');

  const openPicker = (row: CollectionRow) => {
    setPickerRow(row);
    setPrints([]);
    setPrintsState('loading');
    fetchCardPrints(row.name)
      .then(list => {
        setPrints(list);
        setPrintsState('idle');
      })
      .catch(() => setPrintsState('error'));
  };
  const closePicker = () => {
    setPickerRow(null);
    setPrints([]);
    setPrintsState('idle');
  };
  const choosePrint = (row: CollectionRow, p: CardPrint) => {
    void cardImageOverrideStore.set(row.key, {
      collectorNumber: p.collectorNumber,
      imageUrl: p.imageUrl,
      scryfallId: p.id,
      setCode: p.setCode,
      setName: p.setName,
    });
    closePicker();
  };

  // Uploading no longer imports: it opens the review, which is what decides
  // whether the file is a deck or cards, and which rows you already own.
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      setPending({ inspection: inspectImport(text), source: file.name });
    } catch {
      // error surfaced via the store
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const applyImport = async (decisions: ImportDecision[]) => {
    if (!pending) return;
    setImporting(true);
    try {
      for (const decision of decisions) {
        if (decision.kind === 'deck') {
          await deckStore.importCards(decision.deck, {
            name: decision.label,
            source: pending.source,
          });
        } else {
          await collectionStore.mergeImport({
            cards: decision.cards,
            duplicates: decision.duplicates,
            // 'manabox' is the label for rows that carry printing detail; a bare
            // list of names is the other kind, and that is all it distinguishes.
            format: pending.inspection.format === 'plain-list' ? 'list' : 'manabox',
            source: decision.label ?? pending.source,
          });
        }
      }
      setPending(null);
    } catch {
      // error surfaced via the store
    } finally {
      setImporting(false);
    }
  };

  // Roll up the raw rows by card name (version suffix collapsed), keeping a
  // representative printing (prefer one with a Scryfall id) so we can show the
  // exact card image.
  const rows = useMemo<CollectionRow[]>(() => {
    const map = new Map<string, CollectionRow & { pr: Map<string, OwnedPrinting> }>();
    for (const c of collection?.cards ?? []) {
      // Drop non-cards (accessories, sealed, bulk lots) that pre-date product-URL
      // capture and were folded into the collection from purchase history.
      if (isNonCardName(c.name)) continue;
      const key = stripVersion(cardKey(c.name));
      let r = map.get(key);
      if (!r) {
        r = {
          editions: [],
          foil: 0,
          key,
          name: stripVersion(c.name),
          pr: new Map(),
          printings: 0,
          total: 0,
        };
        map.set(key, r);
      }
      const qty = c.quantity || 0;
      r.total += qty;
      if (c.foil) r.foil += qty;
      // Track each distinct printing (set + number + product id + finish),
      // summing quantity. Product id keeps purchase printings distinct even
      // without a set code / collector number.
      const pkey = `${c.setCode ?? ''}|${c.collectorNumber ?? ''}|${c.productId ?? ''}|${
        c.foil ? 'f' : 'n'
      }`;
      const prev = r.pr.get(pkey);
      if (prev) {
        prev.qty += qty;
        if (!prev.scryfallId && c.scryfallId) prev.scryfallId = c.scryfallId;
        if (!prev.productId && c.productId) prev.productId = c.productId;
        if (!prev.imageUrl && c.imageUrl) prev.imageUrl = c.imageUrl;
        if (!prev.setName && c.setName) prev.setName = c.setName;
      } else
        r.pr.set(pkey, {
          collectorNumber: c.collectorNumber,
          foil: !!c.foil,
          imageUrl: c.imageUrl,
          productId: c.productId,
          qty,
          scryfallId: c.scryfallId,
          setCode: c.setCode,
          setName: c.setName,
        });
      // Representative printing for the image: first one carrying a Scryfall id,
      // else the first with a product id, else the first with a set code, else
      // whatever we saw first.
      if (!r.scryfallId && c.scryfallId) {
        r.scryfallId = c.scryfallId;
        r.setCode = c.setCode;
        r.collectorNumber = c.collectorNumber;
      } else if (!r.scryfallId && !r.productId && c.productId) {
        r.productId = c.productId;
        r.imageUrl = c.imageUrl;
      } else if (!r.scryfallId && !r.productId && !r.setCode && c.setCode) {
        r.setCode = c.setCode;
        r.collectorNumber = c.collectorNumber;
      }
    }
    return [...map.values()].map(({ pr, ...r }) => {
      // Only printings that actually name a set are worth showing as badges.
      const editions = [...pr.values()]
        .filter(p => p.setCode || p.setName)
        .sort((a, b) => (a.setCode ?? '').localeCompare(b.setCode ?? ''));
      // Keep the row's headline image in sync with the *first* edition badge
      // (prefer one that carries an exact-printing identity — Scryfall id, then
      // Cardmarket product id) so the picture matches what's shown, instead of
      // an arbitrary file-order printing.
      const repr =
        editions.find(e => e.scryfallId) ??
        editions.find(e => e.productId || e.imageUrl) ??
        editions[0];
      return {
        ...r,
        collectorNumber: repr?.collectorNumber ?? r.collectorNumber,
        editions,
        imageUrl: repr?.imageUrl ?? r.imageUrl,
        printings: pr.size,
        productId: repr?.productId ?? r.productId,
        scryfallId: repr?.scryfallId ?? r.scryfallId,
        setCode: repr?.setCode ?? r.setCode,
      };
    });
  }, [collection]);

  // ---- Purchase info (bought via Cardmarket: when + for how much) -----------
  const purchaseLookup = useMemo(() => {
    const map = new Map<string, { count: number; purchases: PurchaseRecord[] }>();
    for (const [key, entry] of Object.entries(purchases.index?.cards ?? {})) {
      const norm = stripVersion(key);
      const cur = map.get(norm);
      if (cur) {
        cur.count += entry.count;
        cur.purchases = [...cur.purchases, ...(entry.purchases ?? [])];
      } else {
        map.set(norm, { count: entry.count, purchases: [...(entry.purchases ?? [])] });
      }
    }
    return map;
  }, [purchases]);

  // Total paid across all Cardmarket orders (unit price × line quantity), with
  // shipping tracked separately. Older indexes may lack per-line qty; fall back
  // to 1 there until the next re-sync.
  const totalSpent = useMemo(() => {
    let cardsCost = 0;
    let priced = 0;
    let unpriced = 0;
    for (const card of Object.values(purchases.index?.cards ?? {})) {
      for (const r of card.purchases ?? []) {
        if (r.price != null) {
          cardsCost += r.price * (r.qty ?? 1);
          priced += r.qty ?? 1;
        } else {
          unpriced += r.qty ?? 1;
        }
      }
    }
    const shippingMap = purchases.index?.shipping ?? {};
    const shipping = Object.values(shippingMap).reduce((a, b) => a + b, 0);
    return { cardsCost, grand: cardsCost + shipping, priced, shipping, unpriced };
  }, [purchases]);

  const purchasedTag = (name: string) => {
    const entry = purchaseLookup.get(stripVersion(cardKey(name)));
    if (!entry) return null;
    const recs = entry.purchases ?? [];
    const latest = recs.reduce<PurchaseRecord | undefined>(
      (best, r) => ((r.ts ?? 0) >= (best?.ts ?? 0) ? r : best),
      undefined,
    );
    const price = fmtEuro(latest?.price);
    const label = latest?.date ? `bought ${latest.date}${price ? ` · ${price}` : ''}` : 'purchased';
    const tip = recs.length
      ? recs
          .slice()
          .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
          .map(
            r =>
              `${r.date ?? '?'}${r.price != null ? ` — ${fmtEuro(r.price)}` : ''}` +
              `${r.edition ? ` · ${r.edition}` : ''} (#${r.orderId})`,
          )
          .join('\n')
      : 'You bought this card before';
    return (
      <span
        className="rounded bg-violet-500/25 px-1 text-[9px] font-semibold text-violet-200"
        title={tip}
      >
        {label}
        {entry.count > 1 && <span className="ml-1 opacity-70">×{entry.count}</span>}
      </span>
    );
  };

  // Distinct edition names this card was bought in (from purchase history), so
  // the collection can show *which* printing you actually paid for.
  const boughtEditions = (name: string): string[] => {
    const entry = purchaseLookup.get(stripVersion(cardKey(name)));
    if (!entry) return [];
    return [...new Set(entry.purchases.map(p => p.edition).filter((e): e is string => !!e))];
  };

  // The exact edition image you bought (from purchase history) — the Cardmarket
  // thumbnail we captured at sync, or one derived from the printing's product id.
  // Used for purchase-only rows that have no ManaBox Scryfall id, so the picture
  // matches the printing you actually own (like the card tab shows).
  const purchaseImageFor = (name: string): string | undefined => {
    const entry = purchaseLookup.get(stripVersion(cardKey(name)));
    if (!entry) return undefined;
    const recs = [...entry.purchases].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
    const withImg = recs.find(r => r.image);
    if (withImg?.image) return withImg.image;
    const withPid = recs.find(r => r.productId);
    if (withPid?.productId)
      return `https://api.scryfall.com/cards/cardmarket/${withPid.productId}?format=image&version=normal`;
    return undefined;
  };

  // ---- Scryfall metadata filters (type / creature type / color) -------------
  const [metaByName, setMetaByName] = useState<Record<string, CardMetadata>>({});
  const [metaState, setMetaState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [showFilters, setShowFilters] = useState(false);
  const [fQuery, setFQuery] = useState('');
  const [fColors, setFColors] = useState<Set<string>>(new Set());
  const [fCmc, setFCmc] = useState<Set<number>>(new Set());
  const [fSubtype, setFSubtype] = useState('');
  // Quick primary-type toggle ('' = all). Single-select segmented control.
  const [fType, setFType] = useState('');

  const rowNames = useMemo(() => rows.map(r => r.name), [rows]);

  const loadMeta = async () => {
    const missing = rowNames.filter(n => !(cardKey(n) in metaByName));
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

  // Preload whatever's already cached on disk — instant + offline, no network —
  // so filters and type toggles are ready with zero spinner for cards seen
  // before. Only genuinely-new cards need a fetch (below, on demand).
  useEffect(() => {
    if (rowNames.length === 0) return;
    void requestScryfallCached(rowNames)
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
  }, [rowNames]);

  // Load metadata whenever the filter panel is open OR a type toggle is active
  // (type filtering needs Scryfall data even without the panel open).
  useEffect(() => {
    if (showFilters || fType) void loadMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFilters, fType, rowNames]);

  const availableSubtypes = useMemo(() => {
    const set = new Set<string>();
    for (const n of rowNames) metaByName[cardKey(n)]?.subtypes.forEach(s => set.add(s));
    return [...set].sort();
  }, [rowNames, metaByName]);

  // Multiple whitespace-separated terms — all must match (AND), so "elf
  // legendary" narrows to Legendary Elves. Shown as removable chips.
  const fTerms = useMemo(() => fQuery.trim().toLowerCase().split(/\s+/).filter(Boolean), [fQuery]);
  const removeTerm = (term: string) => setFQuery(fTerms.filter(t => t !== term).join(' '));

  const filtersActive =
    fTerms.length > 0 || fColors.size > 0 || fCmc.size > 0 || fSubtype !== '' || fType !== '';

  const metaMatch = (name: string): boolean => {
    if (!filtersActive) return true;
    const meta = metaByName[cardKey(name)];
    if (fType && !meta?.types.includes(fType)) return false;
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

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter(r => (!q || r.name.toLowerCase().includes(q)) && metaMatch(r.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    // metaMatch reads the filter state; list it so the memo stays correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, metaByName, fQuery, fColors, fCmc, fSubtype, fType]);

  // ---- Multi-select ---------------------------------------------------------
  // Both views show the same rows in the same order, so one selection serves
  // them: send a batch of cards to a deck, copy their names, or drop them from
  // the collection.
  const selection = useRowSelection(visibleRows.map(r => r.key));
  const { decks } = useSyncExternalStore(deckStore.subscribe, deckStore.getSnapshot);
  const [deckTarget, setDeckTarget] = useState('');
  const nameByKey = useMemo(
    () => new Map(visibleRows.map(r => [r.key, r.name] as const)),
    [visibleRows],
  );
  const selectedNames = (): string[] =>
    selection.ids.map(id => nameByKey.get(id) ?? '').filter(Boolean);

  // Removing takes two clicks: there's no undo, and the only way back is
  // re-importing the file. Changing the selection puts the guard back up.
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => setConfirmRemove(false), [selection.count]);

  const bulkActions = (
    <>
      <select
        className="max-w-[120px] rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[10px] text-slate-200 outline-none focus:border-sky-500"
        onChange={e => setDeckTarget(e.target.value)}
        title="Which deck the selected cards go to"
        value={deckTarget}
      >
        <option value="">choose a deck…</option>
        {decks.map(d => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      <Button
        disabled={!deckTarget}
        onClick={() => {
          if (!deckTarget) return;
          void deckStore.addCards(deckTarget, selectedNames(), 'main');
          selection.clear();
        }}
        size="xs"
        title={deckTarget ? 'Add the selected cards to that deck' : 'Pick a deck first'}
        variant="primary"
      >
        + Add {selection.count}
      </Button>
      <Button
        onClick={() => void navigator.clipboard?.writeText(selectedNames().join('\n'))}
        size="xs"
        title="Copy the selected card names, one per line"
        variant="subtle"
      >
        Copy names
      </Button>
      {confirmRemove ? (
        <>
          <Button
            onClick={() => {
              void collectionStore.removeCards(selection.ids);
              setConfirmRemove(false);
              selection.clear();
            }}
            size="xs"
            title="This can't be undone"
            variant="danger"
          >
            Really remove {selection.count}?
          </Button>
          <Button onClick={() => setConfirmRemove(false)} size="xs" variant="subtle">
            Cancel
          </Button>
        </>
      ) : (
        <Button
          onClick={() => setConfirmRemove(true)}
          size="xs"
          title="Remove the selected cards from your collection, every printing of them"
          variant="danger"
        >
          Remove {selection.count}
        </Button>
      )}
    </>
  );

  // ---- Hover preview (with double-faced flip) -------------------------------
  // Images come from the Scryfall image CDN (cached by the browser), and card
  // metadata is fetched at most once per card then reused — so repeat hovers
  // make no network requests. We fetch metadata on first hover only to learn
  // whether a card is double-faced (so the preview can flip).
  const metaRequested = useRef<Set<string>>(new Set());
  // `previewKey` is the hovered element's key: the live preview is stored under
  // it, so it's what setFaces has to match to hand the popup its back face
  // (the card key wouldn't, and the first hover would stay unflippable).
  const ensureMeta = (name: string, previewKey: string) => {
    const key = cardKey(name);
    if (key in metaByName || metaRequested.current.has(key)) return;
    metaRequested.current.add(key);
    void requestScryfall([name])
      .then(cards => {
        setMetaByName(prev => {
          const next = { ...prev };
          for (const c of cards) next[cardKey(c.name)] = c;
          return next;
        });
        const faces = cards[0]?.faceImages;
        if (faces && faces.length >= 2) previewStore.setFaces(previewKey, faces);
      })
      .catch(() => metaRequested.current.delete(key));
  };

  // Show a card image in the hover preview. `previewKey` scopes the flip state
  // (so per-edition badges don't clash with the row's main icon).
  const openPreview =
    (previewKey: string, url: string, name: string, flippable: boolean, faces?: string[]) =>
    (e: { clientX: number; clientY: number }) => {
      previewStore.show(
        {
          index: 0,
          key: previewKey,
          // Keep the edition-specific front and borrow only the back face.
          urls: flippable && faces ? [url, ...faces.slice(1)] : [url],
        },
        e.clientX,
        e.clientY,
      );
      ensureMeta(name, previewKey);
    };

  // Exact-printing image URL for one owned edition, most-reliable first: the
  // ManaBox Scryfall id (direct CDN, browser-cached), then the Cardmarket
  // product id (from purchases), then the image captured off the purchase row,
  // then a set + collector number lookup.
  const printingImageUrl = (e: OwnedPrinting): string | undefined =>
    cdnImageFromId(e.scryfallId) ??
    imageFromProductId(e.productId) ??
    e.imageUrl ??
    imageUrlForPrinting(e.setCode, e.collectorNumber);

  // The Cardmarket set symbol for an edition, rendered from its sprite sheet.
  // The set name shows only on hover (tooltip). Falls back to null when we
  // haven't captured that set's icon yet (caller shows text instead).
  const expansionIcon = (setName?: string) => {
    const icon = setName ? expIcons[normalizeSetName(setName)] : undefined;
    if (!icon) return null;
    return (
      <span
        aria-label={setName}
        className="inline-block flex-none align-middle"
        style={{
          backgroundImage: `url("${icon.url}")`,
          backgroundPosition: icon.pos,
          backgroundRepeat: 'no-repeat',
          height: icon.size,
          width: icon.size,
        }}
        title={setName}
      />
    );
  };

  // A small zoomable image icon for one specific printing, used when a card is
  // expanded into a line per edition (multiple printings owned).
  const editionImageIcon = (row: CollectionRow, e: OwnedPrinting, i: number) => {
    const url = printingImageUrl(e);
    const previewKey = `${row.key}|edimg|${i}`;
    if (!url) return <span aria-hidden className="inline-flex h-3.5 w-3.5 flex-none" />;
    return (
      <span
        aria-label="Preview this edition's image"
        className="inline-flex h-3.5 w-3.5 flex-none cursor-zoom-in items-center justify-center rounded text-slate-500 hover:text-sky-300"
        onMouseEnter={openPreview(previewKey, url, row.name, false)}
        onMouseLeave={() => previewStore.hide()}
        onMouseMove={ev => previewStore.move(ev.clientX, ev.clientY)}
      >
        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
          <path d="M4 3.5h12a1.5 1.5 0 011.5 1.5v10A1.5 1.5 0 0116 16.5H4A1.5 1.5 0 012.5 15V5A1.5 1.5 0 014 3.5zm0 1.5v6.2l3.2-3.2 3 3 3.3-3.3L16 10.4V5H4zm3 1.6a1.2 1.2 0 100 2.4 1.2 1.2 0 000-2.4z" />
        </svg>
      </span>
    );
  };

  // A set badge that previews *that exact edition's* image on hover (using the
  // printing's own Scryfall id), so the picture always matches the edition. When
  // we have Cardmarket's set symbol we show the icon (name on hover) instead of
  // the set code text.
  const editionBadge = (row: CollectionRow, e: OwnedPrinting, i: number) => {
    const url = printingImageUrl(e);
    const previewKey = `${row.key}|ed|${i}`;
    const sprite = expansionIcon(e.setName ?? e.setCode);
    return (
      <span
        key={`${e.setCode ?? e.setName ?? '?'}|${e.collectorNumber ?? ''}|${e.foil ? 'f' : 'n'}|${i}`}
        {...(url
          ? {
              onMouseEnter: openPreview(previewKey, url, row.name, false),
              onMouseLeave: () => previewStore.hide(),
              onMouseMove: (ev: { clientX: number; clientY: number }) =>
                previewStore.move(ev.clientX, ev.clientY),
            }
          : {})}
        className={`inline-flex items-center gap-0.5 rounded px-1 text-[9px] font-medium uppercase text-slate-300 ${
          sprite ? '' : 'bg-slate-800'
        } ${url ? 'cursor-zoom-in hover:text-sky-300' : ''}`}
        title={`${e.setName ?? e.setCode ?? 'Unknown set'}${
          e.collectorNumber ? ` #${e.collectorNumber}` : ''
        }${e.foil ? ' · foil' : ''} · ×${e.qty}${url ? ' — hover to preview' : ''}`}
      >
        {sprite ?? e.setCode ?? e.setName ?? '?'}
        {e.foil && <span className="ml-0.5 text-amber-300">f</span>}
      </span>
    );
  };

  // The best image URL for a row's representative printing. A user-picked "the
  // version I own" override always wins. Otherwise prefer the exact printing's
  // CDN image (ManaBox gives a Scryfall id), then the exact printing by
  // Cardmarket product id / captured image (purchases), then by set + collector
  // number (so #279 shows #279, not the default #1), then the edition you
  // actually bought (from purchase history), then the cached metadata image, and
  // only fall back to a name-only lookup last.
  const rowImageUrl = (row: CollectionRow): string | undefined => {
    const override = overrides[row.key];
    return (
      cdnImageFromId(override?.scryfallId) ??
      override?.imageUrl ??
      cdnImageFromId(row.scryfallId) ??
      imageFromProductId(row.productId) ??
      row.imageUrl ??
      imageUrlForPrinting(row.setCode, row.collectorNumber) ??
      purchaseImageFor(row.name) ??
      metaByName[cardKey(row.name)]?.imageUrl ??
      imageUrlFor(undefined, row.name)
    );
  };

  const imageIcon = (row: CollectionRow) => {
    const meta = metaByName[cardKey(row.name)];
    const faces = meta?.faceImages;
    const flippable = !!faces && faces.length >= 2;
    const url = rowImageUrl(row);
    if (!url) return null;
    const show = openPreview(row.key, url, row.name, flippable, faces);
    return (
      <span
        aria-label={flippable ? 'Preview card image — click to flip' : 'Preview card image'}
        className={`inline-flex h-4 w-4 flex-none items-center justify-center rounded hover:text-sky-300 ${
          flippable ? 'cursor-pointer text-sky-400' : 'cursor-zoom-in text-slate-400'
        }`}
        onClick={e => {
          if (!flippable) return;
          e.preventDefault();
          e.stopPropagation();
          previewStore.flip();
        }}
        onMouseEnter={show}
        onMouseLeave={() => previewStore.hide()}
        onMouseMove={e => previewStore.move(e.clientX, e.clientY)}
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

  // Box view: resolve each visible row's image and load them one at a time so
  // the grid fills in progressively instead of firing every request at once.
  const boxSrcs = useMemo(
    () =>
      resultsView === 'box'
        ? visibleRows.map(r => rowImageUrl(r)).filter((u): u is string => !!u)
        : [],
    // rowImageUrl reads overrides + metaByName; list them so newly-resolved
    // images enqueue as they become available.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resultsView, visibleRows, overrides, metaByName],
  );
  const loadedImages = useSequentialImages(boxSrcs);

  // In box view, prefer real Scryfall metadata images (direct CDN, browser
  // cached) over the name-only API redirect, so load metadata for the rows.
  useEffect(() => {
    if (resultsView === 'box') void loadMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultsView, rowNames]);

  const toggleColor = (code: string) =>
    setFColors(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  return (
    <div className="relative flex h-full flex-col">
      <div className="border-b border-slate-800 p-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            accept=".csv,.txt,text/csv,text/plain"
            className="hidden"
            onChange={e => void onFile(e.target.files?.[0])}
            type="file"
          />
          <Button
            disabled={importing}
            onClick={() => fileRef.current?.click()}
            size="md"
            variant="primary"
          >
            {importing ? 'Reading…' : collection ? 'Add cards' : 'Upload collection'}
          </Button>
          {collection && (
            <span className="text-slate-500">
              {collection.totalCards} cards · {collection.uniqueCards} unique ·{' '}
              {timeAgo(collection.importedAt)}
            </span>
          )}
          {collection && (
            <Button
              className="ml-auto"
              onClick={() => void collectionStore.clear()}
              variant="subtle"
            >
              Clear
            </Button>
          )}
        </div>
        {totalSpent.grand > 0 && (
          <div className="mt-1 text-[10px] text-slate-400">
            <span className="font-semibold text-emerald-300">
              Total: {fmtEuro(totalSpent.grand)}
            </span>
            <span className="ml-1 text-slate-500">
              = {fmtEuro(totalSpent.cardsCost)} cards
              {totalSpent.shipping > 0 && ` + ${fmtEuro(totalSpent.shipping)} shipping`}
            </span>
            <span className="ml-1 text-slate-500">
              · {totalSpent.priced} card{totalSpent.priced === 1 ? '' : 's'}
              {totalSpent.unpriced > 0 && ` · ${totalSpent.unpriced} without a price`}
            </span>
          </div>
        )}
        <div className="mt-1 text-[10px] text-slate-500">
          Export from ManaBox (Collection → Export → CSV) and upload it here — a whole collection,
          one binder, or a deck; it works out which. A plain deck list (one card per line, optional
          leading quantity) also works. You get to check what it found before anything is added.
        </div>
        {collection && (
          <div className="mt-1 text-[10px] text-slate-600">
            Imported from <span className="text-slate-400">{collection.source}</span> (
            {collection.format})
          </div>
        )}
        {error && <div className="mt-1 text-red-400">{error}</div>}
      </div>

      {collection && (
        <div className="border-b border-slate-800 p-2">
          <div className="flex items-center gap-2">
            <input
              className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-sky-500"
              onChange={e => setSearch(e.target.value)}
              placeholder="Search your collection…"
              value={search}
            />
            <Button
              active={filtersActive}
              className="flex-none"
              onClick={() => setShowFilters(v => !v)}
              variant="subtle"
            >
              Filters{filtersActive ? ' •' : ''}
            </Button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1">
            <Button
              active={fType === ''}
              className="font-semibold"
              onClick={() => setFType('')}
              pill
              size="xs"
              variant="neutral"
            >
              All
            </Button>
            {TYPE_TOGGLES.map(t => (
              <Button
                key={t}
                active={fType === t}
                className="font-semibold"
                onClick={() => setFType(cur => (cur === t ? '' : t))}
                pill
                size="xs"
                variant="neutral"
              >
                {t}
              </Button>
            ))}
            {fType && metaState === 'loading' && (
              <span className="text-[10px] text-slate-500">loading card data…</span>
            )}
          </div>

          {showFilters && (
            <div className="mt-2 space-y-2 rounded border border-slate-800 bg-slate-950/60 p-2">
              <input
                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-sky-500"
                onChange={e => setFQuery(e.target.value)}
                placeholder="Combine words, e.g. elf legendary black…"
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
                {FILTER_COLORS.map(({ code, cls }) => (
                  <button
                    key={code}
                    className={`h-5 w-5 rounded-full text-[10px] font-bold ${cls} ${
                      fColors.has(code) ? 'ring-2 ring-sky-400' : 'opacity-60 hover:opacity-100'
                    }`}
                    onClick={() => toggleColor(code)}
                    title={code === 'C' ? 'Colorless' : code}
                    type="button"
                  >
                    {code}
                  </button>
                ))}
                {availableSubtypes.length > 0 && (
                  <select
                    className="ml-1 rounded border border-slate-700 bg-slate-950 px-1 py-0.5 text-[11px] text-slate-200 outline-none focus:border-sky-500"
                    onChange={e => setFSubtype(e.target.value)}
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
                {filtersActive && (
                  <Button
                    className="ml-auto"
                    onClick={() => {
                      setFQuery('');
                      setFColors(new Set());
                      setFCmc(new Set());
                      setFSubtype('');
                      setFType('');
                    }}
                    size="xs"
                    variant="subtle"
                  >
                    Clear filters
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[10px] text-slate-500">Mana:</span>
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
              <div className="text-[10px] text-slate-500">
                {metaState === 'loading'
                  ? 'Loading card data from Scryfall…'
                  : metaState === 'error'
                    ? 'Could not load card data — try reopening filters.'
                    : 'Filters cross-reference Scryfall by card name.'}
              </div>
            </div>
          )}
        </div>
      )}

      {!loading && collection && visibleRows.length > 0 && (
        <SelectionBar selection={selection}>{bulkActions}</SelectionBar>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-500">
            Loading…
          </div>
        ) : !collection ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-xs text-slate-500">
            No collection imported yet. Upload a ManaBox CSV to get started.
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="p-4 text-center text-[11px] text-slate-500">
            No cards match your search or filters.
          </div>
        ) : (
          <>
            <div className="sticky top-0 z-10 flex items-center gap-2 bg-slate-900 px-2 py-1 text-[10px] text-slate-500">
              <span>
                {visibleRows.length} card{visibleRows.length === 1 ? '' : 's'}
              </span>
              <div
                className="ml-auto flex overflow-hidden rounded border border-slate-700"
                role="group"
                title="Switch between list and box view"
              >
                <button
                  aria-label="List view"
                  aria-pressed={resultsView === 'list'}
                  className={`flex h-6 w-7 items-center justify-center ${
                    resultsView === 'list'
                      ? 'bg-slate-700 text-slate-100'
                      : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                  onClick={() => setResultsView('list')}
                  type="button"
                >
                  <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M3 4.5h14v2H3v-2Zm0 4.5h14v2H3v-2Zm0 4.5h14v2H3v-2Z" />
                  </svg>
                </button>
                <button
                  aria-label="Box view"
                  aria-pressed={resultsView === 'box'}
                  className={`flex h-6 w-7 items-center justify-center ${
                    resultsView === 'box'
                      ? 'bg-slate-700 text-slate-100'
                      : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                  onClick={() => setResultsView('box')}
                  type="button"
                >
                  <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M3 3.5h6v6H3v-6Zm8 0h6v6h-6v-6ZM3 11.5h6v6H3v-6Zm8 0h6v6h-6v-6Z" />
                  </svg>
                </button>
              </div>
            </div>
            {resultsView === 'box' ? (
              <div
                className="grid gap-2 p-2 outline-none [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]"
                {...selection.listProps}
              >
                {visibleRows.map(r => {
                  const boughtEds = boughtEditions(r.name);
                  const override = overrides[r.key];
                  const meta = metaByName[cardKey(r.name)];
                  const faces = meta?.faceImages;
                  const flippable = !!faces && faces.length >= 2;
                  const src = rowImageUrl(r);
                  const ready = !!src && loadedImages.has(src);
                  const show = src ? openPreview(r.key, src, r.name, flippable, faces) : undefined;
                  return (
                    <div
                      key={r.key}
                      {...selection.rowProps(
                        r.key,
                        'flex gap-2 overflow-hidden rounded-md border border-slate-700 bg-slate-800 p-1.5',
                      )}
                    >
                      {/* Left column: always-visible cropped art (hover for the
                          full card / flip), quantity and the printing actions. */}
                      <div className="flex w-28 flex-none flex-col gap-1">
                        <div
                          className="group relative h-14 w-full cursor-zoom-in overflow-hidden rounded bg-slate-900"
                          onClick={e => {
                            if (!flippable) return;
                            e.preventDefault();
                            e.stopPropagation();
                            previewStore.flip();
                          }}
                          onMouseEnter={show}
                          onMouseLeave={() => previewStore.hide()}
                          onMouseMove={e => previewStore.move(e.clientX, e.clientY)}
                        >
                          {ready ? (
                            <img
                              alt={r.name}
                              className="h-full w-full object-cover"
                              src={src}
                              style={{ objectPosition: '50% 17%' }}
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-sky-400" />
                            </div>
                          )}
                        </div>
                        <span className="text-center text-[11px] font-semibold tabular-nums text-slate-300">
                          ×{r.total}
                        </span>
                        <Button
                          className="w-full"
                          onClick={() => openPicker(r)}
                          size="xs"
                          title="Pick the exact printing you own"
                          variant="subtle"
                        >
                          not this version?
                        </Button>
                        {override && (
                          <Button
                            className="w-full"
                            onClick={() => void cardImageOverrideStore.clear(r.key)}
                            size="xs"
                            title="Reset to the automatic version"
                            variant="subtle"
                          >
                            reset
                          </Button>
                        )}
                      </div>

                      {/* Right column: same detail as the list view. */}
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-100">
                          <span className="min-w-0 truncate font-medium" title={r.name}>
                            {r.name}
                          </span>
                          {r.foil > 0 && (
                            <span className="rounded bg-amber-500/20 px-1 text-[9px] font-semibold text-amber-300">
                              {r.foil} foil
                            </span>
                          )}
                          {purchasedTag(r.name)}
                          {override && (
                            <span
                              className="rounded bg-sky-500/20 px-1 text-[9px] font-semibold text-sky-200"
                              title={`Version set to ${override.setName ?? override.setCode ?? 'a chosen printing'}${
                                override.collectorNumber ? ` #${override.collectorNumber}` : ''
                              }`}
                            >
                              {override.setCode?.toUpperCase() ?? 'custom'}
                              {override.collectorNumber ? ` #${override.collectorNumber}` : ''}
                            </span>
                          )}
                        </div>
                        {r.editions.length > 1 ? (
                          <ul className="list-none space-y-0.5">
                            {r.editions.map((e, i) => (
                              <li
                                key={`${e.setCode ?? e.setName ?? '?'}|${e.collectorNumber ?? ''}|${
                                  e.foil ? 'f' : 'n'
                                }|${i}`}
                                className="flex items-center gap-1.5 text-[10px] text-slate-400"
                              >
                                {editionImageIcon(r, e, i)}
                                {expansionIcon(e.setName ?? e.setCode) ?? (
                                  <span className="truncate">
                                    {e.setName ?? e.setCode ?? 'Unknown set'}
                                  </span>
                                )}
                                {e.collectorNumber && (
                                  <span className="flex-none text-slate-500">
                                    #{e.collectorNumber}
                                  </span>
                                )}
                                {e.foil && (
                                  <span className="rounded bg-amber-500/20 px-1 text-[9px] font-semibold text-amber-300">
                                    foil
                                  </span>
                                )}
                                <span className="ml-auto flex-none tabular-nums text-slate-400">
                                  ×{e.qty}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          r.editions.length === 1 && (
                            <div className="flex flex-wrap items-center gap-1">
                              {editionBadge(r, r.editions[0], 0)}
                            </div>
                          )
                        )}
                        {boughtEds.length > 0 && (
                          <div className="text-[10px] text-violet-300/80">
                            bought: <span className="text-violet-200">{boughtEds.join(', ')}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <ul
                className="list-none divide-y divide-slate-800/60 outline-none"
                {...selection.listProps}
              >
                {visibleRows.map(r => {
                  const boughtEds = boughtEditions(r.name);
                  const override = overrides[r.key];
                  return (
                    <li
                      key={r.key}
                      {...selection.rowProps(
                        r.key,
                        'flex items-center gap-2 px-2 py-1.5 text-[12px]',
                      )}
                    >
                      {imageIcon(r)}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-slate-100">{r.name}</span>
                          {r.foil > 0 && (
                            <span className="rounded bg-amber-500/20 px-1 text-[9px] font-semibold text-amber-300">
                              {r.foil} foil
                            </span>
                          )}
                          {purchasedTag(r.name)}
                          {override && (
                            <span
                              className="rounded bg-sky-500/20 px-1 text-[9px] font-semibold text-sky-200"
                              title={`Version set to ${override.setName ?? override.setCode ?? 'a chosen printing'}${
                                override.collectorNumber ? ` #${override.collectorNumber}` : ''
                              }`}
                            >
                              {override.setCode?.toUpperCase() ?? 'custom'}
                              {override.collectorNumber ? ` #${override.collectorNumber}` : ''}
                            </span>
                          )}
                          <Button
                            className="ml-auto flex-none"
                            onClick={() => openPicker(r)}
                            size="xs"
                            title="Pick the exact printing you own"
                            variant="subtle"
                          >
                            not this version?
                          </Button>
                          {override && (
                            <Button
                              className="flex-none"
                              onClick={() => void cardImageOverrideStore.clear(r.key)}
                              size="xs"
                              title="Reset to the automatic version"
                              variant="subtle"
                            >
                              reset
                            </Button>
                          )}
                        </div>
                        {r.editions.length > 1 ? (
                          // Multiple printings owned — give each edition its own line
                          // with its exact image, set + number, finish and quantity.
                          <ul className="mt-0.5 list-none space-y-0.5">
                            {r.editions.map((e, i) => (
                              <li
                                key={`${e.setCode ?? e.setName ?? '?'}|${e.collectorNumber ?? ''}|${
                                  e.foil ? 'f' : 'n'
                                }|${i}`}
                                className="flex items-center gap-1.5 text-[10px] text-slate-400"
                              >
                                {editionImageIcon(r, e, i)}
                                {expansionIcon(e.setName ?? e.setCode) ?? (
                                  <span className="truncate">
                                    {e.setName ?? e.setCode ?? 'Unknown set'}
                                  </span>
                                )}
                                {e.collectorNumber && (
                                  <span className="flex-none text-slate-500">
                                    #{e.collectorNumber}
                                  </span>
                                )}
                                {e.foil && (
                                  <span className="rounded bg-amber-500/20 px-1 text-[9px] font-semibold text-amber-300">
                                    foil
                                  </span>
                                )}
                                <span className="ml-auto flex-none tabular-nums text-slate-400">
                                  ×{e.qty}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          r.editions.length === 1 && (
                            <div className="mt-0.5 flex flex-wrap items-center gap-1">
                              {editionBadge(r, r.editions[0], 0)}
                            </div>
                          )
                        )}
                        {boughtEds.length > 0 && (
                          <div className="mt-0.5 text-[10px] text-violet-300/80">
                            bought: <span className="text-violet-200">{boughtEds.join(', ')}</span>
                          </div>
                        )}
                      </div>
                      <span className="w-8 flex-none text-right font-semibold tabular-nums text-slate-300">
                        ×{r.total}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>

      {pending && (
        <div className="absolute inset-0 z-20 flex flex-col bg-canvas/95 p-2 backdrop-blur">
          <ImportReview
            busy={importing}
            existing={collection?.cards ?? []}
            inspection={pending.inspection}
            onCancel={() => setPending(null)}
            onConfirm={decisions => void applyImport(decisions)}
            source={pending.source}
          />
        </div>
      )}

      {pickerRow && (
        <div
          className="absolute inset-0 z-10 flex flex-col bg-slate-950/95 backdrop-blur"
          onMouseLeave={() => previewStore.hide()}
        >
          <div className="flex items-center gap-2 border-b border-slate-800 p-2">
            <div className="min-w-0">
              <div className="truncate text-[12px] font-semibold text-slate-100">
                {pickerRow.name}
              </div>
              <div className="text-[10px] text-slate-500">
                Pick the printing you own — click a card to save it.
              </div>
            </div>
            <Button className="ml-auto flex-none" onClick={closePicker} variant="subtle">
              Close
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-2">
            {printsState === 'loading' ? (
              <div className="flex h-full items-center justify-center text-[11px] text-slate-500">
                Loading printings from Scryfall…
              </div>
            ) : printsState === 'error' ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-[11px] text-red-400">
                Could not load printings.
                <Button onClick={() => openPicker(pickerRow)} variant="neutral">
                  Retry
                </Button>
              </div>
            ) : prints.length === 0 ? (
              <div className="flex h-full items-center justify-center text-[11px] text-slate-500">
                No printings found for this card.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {prints.map(p => {
                  const isCurrent = overrides[pickerRow.key]?.scryfallId === p.id;
                  return (
                    <button
                      key={p.id}
                      className={`group flex flex-col overflow-hidden rounded border text-left ${
                        isCurrent
                          ? 'border-sky-400 ring-1 ring-sky-400'
                          : 'border-slate-700 hover:border-sky-500'
                      }`}
                      onClick={() => choosePrint(pickerRow, p)}
                      type="button"
                    >
                      {p.imageUrl ? (
                        <img
                          alt={`${p.setName} #${p.collectorNumber}`}
                          className="aspect-[63/88] w-full object-cover"
                          loading="lazy"
                          src={p.imageUrl}
                        />
                      ) : (
                        <div className="flex aspect-[63/88] w-full items-center justify-center bg-slate-800 text-[9px] text-slate-500">
                          no image
                        </div>
                      )}
                      <div className="p-1">
                        <div className="truncate text-[9px] font-medium text-slate-200">
                          {p.setName}
                        </div>
                        <div className="flex items-center gap-1 text-[9px] text-slate-500">
                          <span className="uppercase">{p.setCode}</span>
                          <span>#{p.collectorNumber}</span>
                          {p.finishes?.includes('foil') && (
                            <span className="text-amber-300">foil</span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
