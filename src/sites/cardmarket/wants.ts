import { cardKey, frontFaceName, stripVersion } from '@/lib/cardName';
import { replayInPage, requestScryfall } from '@/lib/messaging';
import { isLanguageName, languageOfRow } from '@/sites/cardmarket/language';
import { parseOrderSeller, parseOrderTimeline } from '@/sites/cardmarket/order';

// ---------------------------------------------------------------------------
// Want lists: enumeration + local index building
// ---------------------------------------------------------------------------
// We read the user's want lists from /en/Magic/Wants, then fetch each list's
// contents once to build a local index (card name -> which lists want it).
// This is done from the content script, so requests are same-origin and carry
// the user's session. It's paced + abortable + cached to stay a good citizen.

export interface WantListMeta {
  /** Distinct cards in the list, per the Wants overview table (for validation). */
  cardCount: number;
  id: string;
  name: string;
}

export interface WantsIndexList {
  expected: number;
  extracted: number;
  id: string;
  name: string;
}

/** One membership of a card in a want list — enough to remove it via the API. */
export interface WantPlacement {
  /** The per-list want id (`idWant`) used by WantsList_DeleteWant. */
  idWant: string;
  listId: string;
  listName: string;
}

export interface WantsIndex {
  /**
   * cardKey -> display name, the want-list names that contain it, and the exact
   * (list, idWant) placements so a card can be removed from every list.
   */
  cards: Record<string, { lists: string[]; name: string; placements?: WantPlacement[] }>;
  /** Human-readable notes about what the sync saw, for troubleshooting. */
  diagnostics: string[];
  lists: WantsIndexList[];
  syncedAt: number;
}

const WANTS_URL = '/en/Magic/Wants';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** Human-ish pause between requests. Throws if the wait is aborted. */
export const pace = (signal?: AbortSignal) =>
  sleep(700 + Math.random() * 1000).then(() => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  });

interface FetchedDoc {
  doc: Document;
  html: string;
  status: number;
}

export const fetchDoc = async (url: string, signal?: AbortSignal): Promise<FetchedDoc> => {
  // Retry transient network failures (e.g. "TypeError: Failed to fetch" from a
  // dropped connection or a brief Cloudflare hiccup). HTTP errors and aborts are
  // NOT retried — they won't fix themselves.
  const MAX_ATTEMPTS = 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      const res = await fetch(url, { credentials: 'include', signal });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      const html = await res.text();
      return { doc: new DOMParser().parseFromString(html, 'text/html'), html, status: res.status };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      lastErr = err;
      // Only a raw network failure (TypeError) is worth retrying.
      if (!(err instanceof TypeError) || attempt === MAX_ATTEMPTS - 1) throw err;
      await sleep(600 * (attempt + 1));
    }
  }
  throw lastErr;
};

/**
 * Was this page served to someone signed in? Only then does it have the account
 * nav / logout link. Worth asking of a page that carries a `__cmtkn`, since the
 * login form has one of its own and it works for nothing else.
 */
export const looksSignedIn = (html: string): boolean => /User_Logout|account-dropdown/i.test(html);

/** Heuristic: did we get a real logged-in page, or a challenge/login shell? */
const looksWrong = (doc: Document, html: string): string | null => {
  const title = doc.querySelector('title')?.textContent?.trim() ?? '';
  if (/just a moment|attention required|access denied|cf-|cloudflare/i.test(title)) {
    return `challenge page (title: "${title}")`;
  }
  if (html.length < 2000) return `suspiciously short response (${html.length} bytes)`;
  if (!looksSignedIn(html)) {
    return 'response has no logged-in account nav (session/cookies not sent?)';
  }
  return null;
};

/**
 * Cloudflare's interstitial, recognised from a response body alone.
 *
 * {@link looksWrong} needs a page to read a title off. A POST that gets
 * challenged answers with the check where its own reply should be, so there's no
 * title and no ajax envelope — just a body carrying these, from the first byte.
 */
export const looksLikeChallenge = (body: string): boolean =>
  /just a moment|cdn-cgi\/challenge-platform|cf-chl-|attention required/i.test(body);

/** A single want row: the card name plus its per-list `idWant` (for removal). */
export interface WantRow {
  idWant: string;
  /** The list this row actually belongs to (from its delete form), if known. */
  idWantsList?: string;
  name: string;
}

/** The card name inside a row/accordion item, tried across a few selectors. */
const rowName = (root: ParentNode): string | null | undefined => {
  // Mobile puts the name in `.want-name`; both layouts also carry a product /
  // metacard link. `td.name a` is the old desktop selector — kept as a fallback
  // but no longer the only source (Cardmarket layouts drift).
  return (
    root.querySelector<HTMLElement>('.want-name')?.textContent ??
    root.querySelector<HTMLElement>('td.name a')?.textContent ??
    root.querySelector<HTMLElement>('a[href*="/Products/Singles/"], a[href*="/Magic/Cards/"]')
      ?.textContent ??
    root.querySelector<HTMLElement>('dt a')?.textContent
  );
};

/** The per-row `idWant`, from the checkbox data-attr or the delete form. */
const rowIdWant = (root: ParentNode): string | null | undefined => {
  return (
    root.querySelector<HTMLElement>('input[data-id-want]')?.getAttribute('data-id-want') ??
    root.querySelector<HTMLInputElement>('form input[name="idWant"]')?.value
  );
};

/** Rows parsed off a want-list page, with per-layout counts for diagnostics. */
export interface ParsedWantRows {
  /** Distinct rows contributed by the desktop `<table>` layout. */
  desktop: number;
  /** Distinct rows added by the mobile accordion the table didn't already have. */
  mobile: number;
  rows: WantRow[];
}

/**
 * Want rows on a want-list page (`/Wants/<id>`). The desktop table and mobile
 * accordion each render every row; whichever is present in the fetched HTML
 * (they aren't always both server-rendered) contributes. We read `data-id-want`
 * (on the row checkbox) or the row's delete-form `input[name="idWant"]`, and the
 * card name from any of a few selectors. Each row's delete form also carries
 * `idWantsList`, which we capture so callers can verify the row really belongs
 * to the requested list (an empty list can otherwise render unrelated wants).
 * Deduped by `idWant`.
 */
export const parseWantRowsDetailed = (doc: ParentNode): ParsedWantRows => {
  const out: WantRow[] = [];
  const seen = new Set<string>();
  const push = (
    idWant: string | null | undefined,
    name: string | null | undefined,
    idWantsList: string | null | undefined,
  ): boolean => {
    const id = idWant?.trim();
    const nm = name?.trim();
    if (id && nm && nm.length > 1 && !seen.has(id)) {
      seen.add(id);
      out.push({ idWant: id, idWantsList: idWantsList?.trim() || undefined, name: nm });
      return true;
    }
    return false;
  };

  const rowListId = (root: ParentNode) =>
    root.querySelector<HTMLInputElement>('form input[name="idWantsList"]')?.value;

  // Desktop table rows.
  let desktop = 0;
  const table = doc.querySelector('#WantsListTable') ?? doc;
  table.querySelectorAll<HTMLElement>('tbody tr[role="row"], tbody tr').forEach(tr => {
    if (push(rowIdWant(tr), rowName(tr), rowListId(tr))) desktop++;
  });

  // Mobile accordion (contributes any rows the table didn't already cover —
  // and is the sole source when the desktop table is JS-rendered/absent).
  let mobile = 0;
  doc.querySelectorAll<HTMLElement>('.accordion-item').forEach(item => {
    if (push(rowIdWant(item), rowName(item), rowListId(item))) mobile++;
  });

  // Marker-anchored fallback: any `.want-name` the passes above didn't cover.
  // Cardmarket's layouts drift (accordion items, plain list rows, etc.) and
  // cards without a live product page (e.g. new spoilers) carry no product
  // link — but every want row has a `.want-name`. We climb to the nearest
  // element that also holds the row's `data-id-want` / delete form so dedupe
  // against the table + accordion passes still works.
  doc.querySelectorAll<HTMLElement>('.want-name').forEach(nameEl => {
    const scope =
      nameEl.closest<HTMLElement>('.accordion-item, tr, li, h3') ?? nameEl.parentElement ?? nameEl;
    if (push(rowIdWant(scope), nameEl.textContent, rowListId(scope))) mobile++;
  });

  return { desktop, mobile, rows: out };
};

/** Convenience wrapper returning just the deduped rows. */
export const parseWantRows = (doc: ParentNode): WantRow[] => {
  return parseWantRowsDetailed(doc).rows;
};

/**
 * Parse the want-list overview into {id, name, cardCount}.
 *
 * Works from the desktop table when present, and falls back to the mobile
 * card grid (both list the same want lists via `/Wants/<id>` links). Tolerant
 * of layout drift: a list whose card count can't be read gets cardCount = -1
 * ("unknown") so it is never silently skipped.
 */
export const parseWantLists = (doc: Document): WantListMeta[] => {
  const byId = new Map<string, WantListMeta>();

  // Preferred source: the desktop table (has the card counts).
  doc.querySelectorAll('table tbody tr').forEach(tr => {
    const cells = tr.querySelectorAll('td');
    const name = cells[0]?.textContent?.trim();
    const link = tr.querySelector<HTMLAnchorElement>('a[href*="/Wants/"]');
    const idMatch = link?.getAttribute('href')?.match(/\/Wants\/(\d+)/);
    if (!name || !idMatch) return;
    const id = idMatch[1];
    // Card count is the last numeric cell in the row (Cards column).
    let cardCount = -1;
    for (let i = cells.length - 1; i >= 1; i--) {
      const raw = cells[i]?.textContent?.trim() ?? '';
      if (/^\d+$/.test(raw)) {
        cardCount = Number.parseInt(raw, 10);
        break;
      }
    }
    if (!byId.has(id)) byId.set(id, { cardCount, id, name });
  });

  // Fallback: mobile card grid (no counts, so unknown).
  doc.querySelectorAll('.card .card-title').forEach(title => {
    const card = title.closest('.card');
    const link = card?.querySelector<HTMLAnchorElement>(
      'a[href*="/Wants/"]:not([href*="ShoppingWizard"])',
    );
    const idMatch = link?.getAttribute('href')?.match(/\/Wants\/(\d+)/);
    const name = title.textContent?.trim();
    if (!name || !idMatch) return;
    if (!byId.has(idMatch[1])) byId.set(idMatch[1], { cardCount: -1, id: idMatch[1], name });
  });

  return [...byId.values()];
};

/** Safety cap on want-list pages so a bad pager value can't fan out forever. */
const MAX_WANT_PAGES = 40;

/**
 * Fetch one want list's rows across all of its pages.
 *
 * Large want lists are paginated by Cardmarket (a `site=N` pager), so fetching
 * only the first page silently truncates the list (e.g. 119 wants shown as 84).
 * We follow the pager — using both the `site=` links and the "Page X of Y"
 * counter as the page total — and dedupe rows by `idWant` across pages.
 *
 * Both the desktop `<table>` and the mobile accordion are parsed per page;
 * whichever the server rendered contributes (they aren't always both present in
 * the raw HTML we fetch, only one may be server-side rendered).
 *
 * Guards against the empty-list case: when a list has no wants, Cardmarket's
 * page can render unrelated content whose rows would be wrongly attributed to
 * this list. Each row's delete form carries its true `idWantsList`, so we drop
 * any row that doesn't belong to `id`.
 */
const fetchListWants = async (
  id: string,
  signal?: AbortSignal,
): Promise<{ diagnostics: string[]; dropped: number; rows: WantRow[] }> => {
  const diagnostics: string[] = [];
  const seen = new Set<string>();
  const all: WantRow[] = [];
  let desktopTotal = 0;
  let mobileTotal = 0;
  // Raw element counts in the fetched HTML (before name/id extraction + dedup).
  // Comparing these to the parsed totals tells us whether a shortfall is the
  // server returning fewer rows vs. the parser failing to read rows it received.
  let rawTableRows = 0;
  let rawAccordionItems = 0;
  let bytesTotal = 0;

  const collect = (doc: Document, html: string) => {
    bytesTotal += html.length;
    const table = doc.querySelector('#WantsListTable') ?? doc;
    rawTableRows += table.querySelectorAll('tbody tr[role="row"], tbody tr').length;
    rawAccordionItems += doc.querySelectorAll('.accordion-item').length;
    const { rows, desktop, mobile } = parseWantRowsDetailed(doc);
    desktopTotal += desktop;
    mobileTotal += mobile;
    let added = 0;
    for (const r of rows) {
      if (seen.has(r.idWant)) continue;
      seen.add(r.idWant);
      all.push(r);
      added++;
    }
    return added;
  };

  const first = await fetchDoc(`${WANTS_URL}/${id}`, signal);
  collect(first.doc, first.html);

  const reportedPages = Math.max(maxSite(first.doc), parsePageCount(first.doc));
  const totalPages = Math.min(reportedPages, MAX_WANT_PAGES);
  if (reportedPages > MAX_WANT_PAGES) {
    diagnostics.push(
      `List ${id}: pager shows ${reportedPages} pages — capping at ${MAX_WANT_PAGES}.`,
    );
  }

  for (let p = 2; p <= totalPages; p++) {
    await pace(signal);
    const before = all.length;
    const { doc, html } = await fetchDoc(`${WANTS_URL}/${id}?site=${p}`, signal);
    const added = collect(doc, html);
    if (added === 0 && before === all.length) {
      // The pager promised more but this page added nothing new — the `site=`
      // param probably isn't advancing the list; stop rather than loop.
      diagnostics.push(
        `List ${id}: page ${p} added no new rows (pager claimed ${totalPages}) — stopping.`,
      );
      break;
    }
  }

  if (totalPages > 1) {
    diagnostics.push(`List ${id}: fetched ${totalPages} page(s), ${all.length} row(s) total.`);
  }
  // Record which layout carried the data — makes a future selector drift obvious.
  diagnostics.push(
    `List ${id}: rows by layout — desktop table ${desktopTotal}, mobile accordion ${mobileTotal}.`,
  );
  // Raw element counts vs. parsed totals: if the raw counts are already low, the
  // server truncated the response (pagination/layout); if raw is high but parsed
  // is low, a selector failed to read rows we did receive.
  diagnostics.push(
    `List ${id}: raw HTML — ${rawTableRows} table row(s), ${rawAccordionItems} accordion item(s), ` +
      `${bytesTotal} bytes across ${totalPages} page(s).`,
  );

  const rows = all.filter(r => r.idWantsList == null || r.idWantsList === id);
  return { diagnostics, dropped: all.length - rows.length, rows };
};

/**
 * How a card name is matched between a decklist and a want row: front face only,
 * version marker dropped. Cardmarket writes a want for a two-faced card under
 * both names ("Duskwatch Recruiter // Krallenhorde Howler") and distinguishes
 * alternate art as "(V.2)", where a decklist says neither.
 */
export const wantKey = (name: string): string => cardKey(frontFaceName(stripVersion(name)));

/**
 * The cards a want list holds right now, keyed by {@link wantKey}.
 *
 * Asking the list itself, rather than trusting the last sync, is what keeps a
 * second run from asking for two of everything: adding a card a list already has
 * doesn't fail, it raises the existing want's amount.
 */
export const listWantKeys = async (id: string, signal?: AbortSignal): Promise<Set<string>> => {
  const { rows } = await fetchListWants(id, signal);
  return new Set(rows.map(r => wantKey(r.name)));
};

export interface SyncProgress {
  current: number;
  listName: string;
  /**
   * Which stage the purchase sync is in. 'listing' is a quick prep pass (enumerate
   * order ids) whose count is on a different scale than the main 'orders' fetch —
   * the UI renders it as indeterminate so the determinate bar doesn't rewind when
   * the two stages hand off. Absent for the wants sync (single stage).
   */
  phase?: 'listing' | 'orders';
  total: number;
}

/**
 * Build the local wants index. Skips empty lists. Reports progress and honors
 * an AbortSignal between requests.
 */
export const syncWants = async (
  onProgress: (p: SyncProgress) => void,
  signal?: AbortSignal,
): Promise<WantsIndex> => {
  const diagnostics: string[] = [];
  const { doc: overview, html } = await fetchDoc(WANTS_URL, signal);

  const wrong = looksWrong(overview, html);
  if (wrong) diagnostics.push(`Overview fetch looks off: ${wrong}`);

  const all = parseWantLists(overview);
  // Skip only lists we're sure are empty (cardCount === 0). Unknown (-1) kept.
  const metas = all.filter(l => l.cardCount !== 0);
  diagnostics.push(
    `Overview: title="${overview.querySelector('title')?.textContent?.trim() ?? ''}", ` +
      `${html.length} bytes, parsed ${all.length} lists, ${metas.length} to fetch.`,
  );

  const cards: WantsIndex['cards'] = {};
  const lists: WantsIndexList[] = [];

  for (let i = 0; i < metas.length; i++) {
    const meta = metas[i];
    onProgress({ current: i + 1, listName: meta.name, total: metas.length });
    await pace(signal);

    try {
      const { rows, dropped, diagnostics: listDiags } = await fetchListWants(meta.id, signal);
      diagnostics.push(...listDiags);
      if (dropped > 0) {
        diagnostics.push(
          `List "${meta.name}" (${meta.id}): ignored ${dropped} row(s) belonging to other lists ` +
            '(likely an empty list rendering unrelated wants).',
        );
      }
      // The overview's card count is the ground truth; flag any shortfall so a
      // truncated fetch (missed page / changed layout) is visible, not silent.
      if (meta.cardCount >= 0 && rows.length < meta.cardCount) {
        diagnostics.push(
          `List "${meta.name}" (${meta.id}): extracted ${rows.length} of ${meta.cardCount} ` +
            'expected card(s) — some wants may be missing.',
        );
      }
      for (const row of rows) {
        const key = cardKey(row.name);
        // Display the version-stripped name so "(V.n)" printings collapse into
        // one want entry — they're the same card.
        const entry =
          cards[key] ?? (cards[key] = { lists: [], name: stripVersion(row.name), placements: [] });
        if (!entry.lists.includes(meta.name)) entry.lists.push(meta.name);
        (entry.placements ??= []).push({
          idWant: row.idWant,
          listId: meta.id,
          listName: meta.name,
        });
      }
      lists.push({
        expected: meta.cardCount,
        extracted: rows.length,
        id: meta.id,
        name: meta.name,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      diagnostics.push(
        `List "${meta.name}" (${meta.id}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      lists.push({ expected: meta.cardCount, extracted: 0, id: meta.id, name: meta.name });
    }
  }

  return { cards, diagnostics, lists, syncedAt: Date.now() };
};

// ---------------------------------------------------------------------------
// Seller scan: find everything a seller has that's on my want lists
// ---------------------------------------------------------------------------
// The on-page match only sees the ~20 cards currently rendered. To answer
// "does this seller have anything on my want lists?" across their whole stock
// we have two strategies, and pick the cheaper one:
//
//   'pages'     — walk every page of the seller's offers, match names locally
//                 against the wants index. Cost = number of offer pages.
//   'wantlists' — hit Cardmarket's own filter (?idWantslist=<id>) once per
//                 want list; the server returns only the seller's matches.
//                 Cost = number of non-empty want lists, independent of how
//                 many cards the seller has.
//
// The visible page count is only a lower bound (the site hides the last page),
// so any pagination at all routes us to the bounded want-list filter. Both
// strategies are paced + abortable, and both parse the full offer rows so we
// can show price / foil / edition and add each article to the cart.

// Anchored: the whole (trimmed) text must be just a price. Scanning the row's
// flattened textContent is unreliable because adjacent cells merge (e.g. the
// quantity "1" + "0,50 €" becomes "10,50 €"), so we look for the tightest
// element whose entire text is a price.
const PRICE_ONLY_RE = /^(\d{1,3}(?:[.\s]\d{3})*,\d{2})\s*€$/;

const toValue = (raw: string): number | undefined => {
  const v = Number.parseFloat(raw.replace(/[.\s]/g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : undefined;
};

/** Find the offer's price by locating the smallest element that is only a price. */
const findPrice = (row: Element): { price?: string; value?: number } => {
  let bestText = '';
  let bestRaw = '';
  row.querySelectorAll('*').forEach(el => {
    const t = el.textContent?.trim() ?? '';
    const m = t.match(PRICE_ONLY_RE);
    if (m && (bestRaw === '' || t.length < bestText.length)) {
      bestText = t;
      bestRaw = m[1];
    }
  });
  if (!bestRaw) return {};
  return { price: `${bestRaw} €`, value: toValue(bestRaw) };
};

export interface ParsedOffer {
  /** Cardmarket article id, needed to add the offer to the cart. */
  articleId?: string;
  condition?: string;
  edition?: string;
  /** Product image URL (S3), if we can find one in the row. */
  imageUrl?: string;
  isFoil: boolean;
  language?: string;
  name: string;
  price?: string;
  priceValue?: number;
  /** Absolute URL of the product page (for market price lookups). */
  productUrl?: string;
}

const IMAGE_RE =
  /https?:(?:\/\/|\\\/\\\/)[\w.\-\\/]*product-images\.s3\.cardmarket\.com[\w.\-\\/]+\.(?:jpg|png|webp)/i;
/** Path portion (used when the row carries only a relative image path). */
const IMAGE_PATH_RE = /\/(\d+\/[A-Za-z0-9]+\/\d+\/\d+)\.(?:jpg|png|webp)/;

const normalizeImageUrl = (raw: string): string => {
  const cleaned = raw.replace(/\\\//g, '/').replace(/&amp;/g, '&');
  if (/^https?:\/\//i.test(cleaned)) return cleaned;
  const path = cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
  return `https://product-images.s3.cardmarket.com${path}`;
};

/** Find the product image URL anywhere in the row (img src, data attr, popover). */
export const findImageUrl = (row: Element): string | undefined => {
  const img = row.querySelector<HTMLImageElement>(
    'img[src*="product-images"], img[data-src*="product-images"], img[data-echo*="product-images"]',
  );
  const direct =
    img?.getAttribute('src') || img?.getAttribute('data-src') || img?.getAttribute('data-echo');
  if (direct && /product-images/.test(direct)) return normalizeImageUrl(direct);

  // Cardmarket usually stashes the image inside a popover/tooltip attribute as
  // raw (often escaped) HTML — regex the whole row markup as a catch-all.
  const full = row.innerHTML.match(IMAGE_RE);
  if (full) return normalizeImageUrl(full[0]);

  // Last resort: a bare `/1/CODE/id/id.jpg` path embedded anywhere.
  const path = row.innerHTML.match(IMAGE_PATH_RE);
  return path ? normalizeImageUrl(path[0]) : undefined;
};

/** Debug: dump one raw offer row so image/edition/language selectors can be fixed. */
export const sampleOfferRowHtml = (root: ParentNode = document): string | null => {
  return root.querySelector('[id^="articleRow"], [id^="stockRow"]')?.outerHTML ?? null;
};

// ---------------------------------------------------------------------------
// Market price guide (per product page): From / Price Trend / averages
// ---------------------------------------------------------------------------

export interface PriceGuide {
  available?: number;
  avg30?: string;
  from?: string;
  trend?: string;
}

const ANY_PRICE_RE = /(\d{1,3}(?:[.\s]\d{3})*,\d{2})\s*€/;

/**
 * Parse the product page's price-guide block. Cardmarket renders it as a
 * definition list (`<dt>Price Trend</dt><dd>0,50 €</dd>`), so we match by the
 * English label text and read the adjacent value. Best-effort + label-based to
 * survive layout tweaks.
 */
export const parsePriceGuide = (doc: ParentNode): PriceGuide => {
  const guide: PriceGuide = {};
  doc.querySelectorAll('dt').forEach(dt => {
    const label = dt.textContent?.trim().toLowerCase() ?? '';
    const value = dt.nextElementSibling?.textContent?.trim() ?? '';
    const price = value.match(ANY_PRICE_RE)?.[0];
    if (label.includes('price trend')) guide.trend = price;
    else if (label.includes('30-day') || label.includes('30 day')) guide.avg30 = price;
    else if (label.startsWith('from') || label.includes('available from')) guide.from = price;
    else if (label.includes('available')) {
      const n = Number.parseInt(value.replace(/\D/g, ''), 10);
      if (Number.isFinite(n)) guide.available = n;
    }
  });
  // "From" is sometimes shown outside the list as "N available from X €".
  if (!guide.from) {
    const m = doc.textContent?.match(/available\s+from\s+(\d{1,3}(?:[.\s]\d{3})*,\d{2})\s*€/i);
    if (m) guide.from = `${m[1]} €`;
  }
  return guide;
};

const priceCache = new Map<string, PriceGuide>();

// Debug: the raw price-guide markup of the last fetched product page, so we can
// finalize foil / edition parsing without hunting in devtools.
let lastGuideHtml: string | null = null;
export const getLastGuideHtml = (): string | null => {
  return lastGuideHtml;
};

/** Capture a reasonably sized block around the "Price Trend" label. */
const captureGuideHtml = (doc: Document): void => {
  const dts = Array.from(doc.querySelectorAll('dt'));
  const dt = dts.find(d => /price trend|available|from/i.test(d.textContent ?? ''));
  let el: Element | null | undefined = dt?.parentElement;
  for (let i = 0; i < 3 && el?.parentElement; i++) el = el.parentElement;
  lastGuideHtml = el?.outerHTML ?? doc.querySelector('main')?.outerHTML?.slice(0, 6000) ?? null;
};

/** Fetch (and cache) a product's market price guide. */
export const fetchPriceGuide = async (
  productUrl: string,
  signal?: AbortSignal,
): Promise<PriceGuide> => {
  const cached = priceCache.get(productUrl);
  if (cached) return cached;
  const { doc } = await fetchDoc(productUrl, signal);
  captureGuideHtml(doc);
  const guide = parsePriceGuide(doc);
  priceCache.set(productUrl, guide);
  return guide;
};

// ---------------------------------------------------------------------------
// Other editions / foil: the metacard ("Show Offers") page aggregates every
// printing of a card in one response. We parse its offer rows and collapse
// them to the cheapest price per (edition, foil) so the UI can show a card's
// alternative printings + foil vs non-foil without a request per product.
// ---------------------------------------------------------------------------

export interface EditionPrice {
  /** How many offers of this edition+foil were seen (first ~300 offers). */
  count: number;
  edition: string;
  /** Cheapest offer price string for this edition+foil (e.g. "0,10 €"). */
  from?: string;
  fromValue?: number;
  isFoil: boolean;
}

/**
 * The metacard "all offers" URL for a specific product page. Cardmarket reuses
 * the same trailing slug for the product (`/Products/Singles/<set>/<slug>`) and
 * its aggregate card page (`/Magic/Cards/<slug>`), so we can derive it directly
 * — no extra fetch to discover the "Show Offers" link.
 */
export const metacardUrlFromProduct = (productUrl: string): string | undefined => {
  try {
    const u = new URL(productUrl, location.origin);
    const segments = u.pathname.split('/').filter(Boolean);
    const slug = segments.pop();
    if (!slug) return undefined;
    const lang = /^[a-z]{2}$/.test(segments[0] ?? '') ? segments[0] : 'en';
    return `${u.origin}/${lang}/Magic/Cards/${slug}`;
  } catch {
    return undefined;
  }
};

/** Site language segment (e.g. "en") from the current path, defaulting to "en". */
export const currentLang = (): string => {
  const first = location.pathname.split('/').filter(Boolean)[0] ?? '';
  return /^[a-z]{2}$/.test(first) ? first : 'en';
};

/**
 * Build the metacard "all offers" URL from a card *name* — used when an offer
 * row carries no product link (e.g. rows parsed off a metacard page itself).
 * Cardmarket slugs drop apostrophes/punctuation and hyphenate the rest, e.g.
 * "Urza's Saga" → "Urzas-Saga", "Abundant Growth" → "Abundant-Growth".
 */
export const metacardUrlFromName = (name: string, lang = currentLang()): string | undefined => {
  const slug = frontFaceName(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/['’.,:!?"()]/g, '') // punctuation Cardmarket omits entirely
    .replace(/[^A-Za-z0-9]+/g, '-') // everything else → hyphen
    .replace(/^-+|-+$/g, '');
  if (!slug) return undefined;
  return `${location.origin}/${lang}/Magic/Cards/${slug}`;
};

/** Collapse a metacard page's offer rows to the cheapest price per edition+foil. */
export const parseCardEditions = (root: ParentNode): EditionPrice[] => {
  const groups = new Map<string, EditionPrice>();
  for (const o of parseOffers(root)) {
    const edition = o.edition ?? 'Unknown';
    const key = `${edition}|${o.isFoil ? 'foil' : 'nonfoil'}`;
    const g = groups.get(key) ?? { count: 0, edition, isFoil: o.isFoil };
    g.count++;
    if (o.priceValue != null && (g.fromValue == null || o.priceValue < g.fromValue)) {
      g.fromValue = o.priceValue;
      g.from = o.price;
    }
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => (a.fromValue ?? Infinity) - (b.fromValue ?? Infinity));
};

const editionsCache = new Map<string, EditionPrice[]>();

/** Fetch (and cache) the edition/foil breakdown from a metacard "all offers" URL. */
export const fetchEditionsFromMetacardUrl = async (
  metaUrl: string,
  signal?: AbortSignal,
): Promise<EditionPrice[]> => {
  const cached = editionsCache.get(metaUrl);
  if (cached) return cached;
  const { doc, html } = await fetchDoc(metaUrl, signal);
  // A Cloudflare "verify you're human" interstitial returns HTTP 200 with no
  // offer rows; surface it distinctly so the UI can tell the user to solve it.
  const wrong = looksWrong(doc, html);
  if (wrong) throw new Error(`CHALLENGE: ${wrong}`);
  const editions = parseCardEditions(doc);
  editionsCache.set(metaUrl, editions);
  return editions;
};

/**
 * Fetch (and cache) the edition/foil breakdown for a card. Prefer deriving the
 * metacard URL from a product page URL; fall back to the card *name* when the
 * offer row has no product link (metacard-page rows). Returns cheapest offer
 * per (edition, foil).
 */
export const fetchCardEditions = async (
  opts: { name?: string; productUrl?: string },
  signal?: AbortSignal,
): Promise<EditionPrice[]> => {
  const metaUrl =
    (opts.productUrl ? metacardUrlFromProduct(opts.productUrl) : undefined) ??
    (opts.name ? metacardUrlFromName(opts.name) : undefined);
  if (!metaUrl) return [];
  return fetchEditionsFromMetacardUrl(metaUrl, signal);
};

// ---------------------------------------------------------------------------
// Removing a want (Feature 1: "remove from all want lists")
// ---------------------------------------------------------------------------
// The site's own delete button submits a plain form POST:
//   POST /en/Magic/PostGetAction/WantsList_DeleteWant
//   __cmtkn=<token>&idWantsList=<listId>&idWant=<perListWantId>
// We replay it in the page context (same cookies/session) exactly like the
// site does. The response is the wants page (302 → 200), so we treat HTTP 2xx
// as success and surface obvious error banners if present.

const DELETE_WANT_URL = '/Magic/PostGetAction/WantsList_DeleteWant';

export interface DeleteWantResult {
  message: string;
  ok: boolean;
}

/**
 * POST one of the site's want-list actions the way the site does: form-encoded,
 * in the page context, so cookies and session match.
 *
 * Fields are pairs rather than an object because the order they go over the wire
 * in is the order the site sends them, and the whole point is to be
 * indistinguishable from the site.
 *
 * They all answer with a redirect back to the page you were on (302 → 200), so
 * there's no result code to read: a 2xx carrying no error banner is the only
 * success signal on offer.
 */
const postWantsAction = async (
  action: string,
  fields: Array<[name: string, value: string]>,
  done: string,
): Promise<DeleteWantResult> => {
  const res = await replayInPage({
    body: new URLSearchParams(fields).toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
    },
    method: 'POST',
    url: `/${currentLang()}${action}`,
  });

  if (looksLikeChallenge(res.body)) throw new Error(`CHALLENGE: asked on ${action}`);
  if (!res.ok) return { message: `Failed (HTTP ${res.status})`, ok: false };
  // A returned page with a danger banner means the server rejected it.
  const err = res.body.match(/alert-danger[^>]*>\s*([^<]+)</i)?.[1]?.trim();
  if (err) return { message: err, ok: false };
  return { message: done, ok: true };
};

/** Remove one want (a specific card membership in one list) via a replayed POST. */
export const deleteWant = (
  idWantsList: string,
  idWant: string,
  token: string,
): Promise<DeleteWantResult> =>
  postWantsAction(
    DELETE_WANT_URL,
    [
      ['__cmtkn', token],
      ['idWantsList', idWantsList],
      ['idWant', idWant],
    ],
    'Removed',
  );

// The site's bulk controls on a want list page, both taking the wants as a JSON
// array of `idWant` and both answering 302 back to the list:
//   POST /en/Magic/PostGetAction/WantsList_MassDeleteWants
//   __cmtkn=<token>&idWants=["<id>",…]&idWantsList=<listId>
//
//   POST /en/Magic/PostGetAction/WantsList_MassEditWants
//   __cmtkn=<token>&idWants=["<id>",…]&idWantsList=<listId>&wishPrice=
//     &idLanguagesTempInput=&minCondition=2&isFoil=&isSigned=&isAltered=&amount=
//     &mailAlert=N&move=<listId|0>&copy=<listId|0>
//
// The edit POST carries every field of the site's dialog: the blank ones leave
// the wants as they are, `idWantsList` is the list you're looking at, and
// `move`/`copy` name where the wants should end up — 0 for the one you don't
// mean. Moving and copying are the same request bar which of those is set.
const MASS_DELETE_URL = '/Magic/PostGetAction/WantsList_MassDeleteWants';
const MASS_EDIT_URL = '/Magic/PostGetAction/WantsList_MassEditWants';

/** Remove several wants from one list in a single POST. */
export const massDeleteWants = (
  idWantsList: string,
  idWants: readonly string[],
  token: string,
): Promise<DeleteWantResult> =>
  postWantsAction(
    MASS_DELETE_URL,
    [
      ['__cmtkn', token],
      ['idWants', JSON.stringify([...idWants])],
      ['idWantsList', idWantsList],
    ],
    `Removed ${idWants.length}`,
  );

export interface MassMoveParams {
  /** The wants to move or copy, by `idWant`. */
  idWants: readonly string[];
  /** The list they're on now — the one being looked at. */
  idWantsList: string;
  /** Leave the originals where they are (copy) or not (move). */
  keepOriginals: boolean;
  /**
   * Cardmarket's 1–7 condition scale, applied to the wants as they land. Its own
   * dialog sends 2, so that's the default here; the field isn't optional.
   */
  minCondition?: number;
  /** The list they should end up on. */
  target: string;
}

/** Move or copy several wants to another list in a single POST. */
export const massMoveWants = (
  { idWants, idWantsList, keepOriginals, minCondition = 2, target }: MassMoveParams,
  token: string,
): Promise<DeleteWantResult> =>
  postWantsAction(
    MASS_EDIT_URL,
    [
      ['__cmtkn', token],
      ['idWants', JSON.stringify([...idWants])],
      ['idWantsList', idWantsList],
      ['wishPrice', ''],
      ['idLanguagesTempInput', ''],
      ['minCondition', String(minCondition)],
      ['isFoil', ''],
      ['isSigned', ''],
      ['isAltered', ''],
      ['amount', ''],
      ['mailAlert', 'N'],
      ['move', keepOriginals ? '0' : target],
      ['copy', keepOriginals ? target : '0'],
    ],
    `${keepOriginals ? 'Copied' : 'Moved'} ${idWants.length}`,
  );

/** The wants a list holds right now, with the ids needed to act on them. */
export const listWantRows = async (id: string, signal?: AbortSignal): Promise<WantRow[]> =>
  (await fetchListWants(id, signal)).rows;

// On an order/shipment page, the site can remove every card bought in that
// order from a single want list in one POST:
//   POST /en/Magic/PostGetAction/WantsList_RemoveShipment
//   __cmtkn=<token>&idShipment=<idShipment>&idWantsList=<listId>
// Looping this over every want list clears the purchase from all of them.
const REMOVE_SHIPMENT_URL = '/Magic/PostGetAction/WantsList_RemoveShipment';

/** Remove all of an order's purchased cards from one want list (replayed POST). */
export const removeShipmentFromWantList = (
  idShipment: string,
  idWantsList: string,
  token: string,
): Promise<DeleteWantResult> =>
  postWantsAction(
    REMOVE_SHIPMENT_URL,
    [
      ['__cmtkn', token],
      ['idShipment', idShipment],
      ['idWantsList', idWantsList],
    ],
    'Removed',
  );

// Adding a card to a want list. The site's own control — the search box on
// /Wants/<id>/AddCards — POSTs:
//   POST /en/Magic/AjaxAction/Wantslist_AddWant
//   __cmtkn=<token>&idWantsList=<listId>&idGame=1&idMetacard=<id>&amount=1
//     &idProduct=[]&idLanguage=[]&minCondition=5&isFoil=0&isSigned=0&isAltered=0
//
// A want is for a card, not a printing: `idMetacard` names it, and the empty
// `idProduct` / `idLanguage` arrays are "any printing, any language". Asking by
// product instead — the neighbouring `Wantslist_AddWantByProduct`, which we used
// to call with both ids — is what put two of everything on the list.
//
// The reply is an <ajaxResponse> whose <resultType> is base64("success") on
// success, with a base64 HTML alert in <systemMessage>. We replay it in the
// page context so cookies/session match, exactly like deleteWant.
const ADD_WANT_URL = '/Magic/AjaxAction/Wantslist_AddWant';

/** Magic. The endpoint is shared with the site's other games. */
const ID_GAME_MAGIC = '1';

/** minCondition is Cardmarket's 1–7 scale; 5 is what the site's own form sends. */
export interface AddWantParams {
  amount?: number;
  /** Identifies the card. Without it the site has nothing to add. */
  idMetacard: string;
  idWantsList: string;
  isAltered?: boolean;
  isFoil?: boolean;
  isSigned?: boolean;
  /**
   * Cardmarket language ids to restrict the want to. Empty or omitted sends the
   * literal `[]` the site uses for "any language".
   */
  languages?: readonly number[];
  minCondition?: number;
  /** Most you'd pay per copy. Omitted means no cap, as before. */
  wishPrice?: number;
}

/** Add one card to a want list via a replayed AjaxAction POST. */
export const addWant = async (params: AddWantParams, token: string): Promise<DeleteWantResult> => {
  const flag = (on?: boolean): string => (on ? '1' : '0');
  // Field order is the site's. Empty arrays are sent as the literal "[]" the
  // site's own request carries, not omitted.
  //
  // `idLanguage` and `wishPrice` were pinned to "any" and "no cap" here for a long
  // time, which meant the overlay could not express two of the three preferences
  // the site's own form offers. They pass through now; the defaults are unchanged
  // when a caller says nothing.
  const languages = [...(params.languages ?? [])].filter(id => Number.isInteger(id) && id > 0);
  const body = new URLSearchParams([
    ['__cmtkn', token],
    ['idWantsList', params.idWantsList],
    ['idGame', ID_GAME_MAGIC],
    ['idMetacard', params.idMetacard],
    ['amount', String(params.amount ?? 1)],
    ['idProduct', '[]'],
    ['idLanguage', languages.length ? JSON.stringify(languages) : '[]'],
    ['minCondition', String(params.minCondition ?? 5)],
    ['isFoil', flag(params.isFoil)],
    ['isSigned', flag(params.isSigned)],
    ['isAltered', flag(params.isAltered)],
    // Sent as a plain decimal point regardless of the display locale — the site's
    // own request does the same, and a comma is read as a thousands separator.
    ['wishPrice', params.wishPrice != null && params.wishPrice > 0 ? params.wishPrice.toFixed(2) : ''],
  ]).toString();

  const res = await replayInPage({
    body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
    },
    method: 'POST',
    url: `/${currentLang()}${ADD_WANT_URL}`,
  });

  // Told to prove we're human: that's for the caller to put to the user, not a
  // card to mark as refused.
  if (looksLikeChallenge(res.body)) throw new Error('CHALLENGE: asked on adding a want');
  if (!res.ok) return { message: `Failed (HTTP ${res.status})`, ok: false };
  return addWantReply(res.body);
};

/**
 * Did an `Wantslist_AddWant` reply put the card on the list?
 *
 * Only a refusal is read as one. Cardmarket answers an add in several shapes:
 * `resultType: success`; "added successfully, but some information might have
 * been lost" as a warning, which is a want that's there with a condition or
 * language adjusted; and shapes we don't recognise at all. None of those are
 * evidence of failure, and treating them as such reported whole runs as skipped
 * when every card had landed. The tone is what's judged, not the wording, which
 * is translated — and the caller checks the list afterwards either way, which is
 * the only reading that can't be wrong.
 */
export const addWantReply = (body: string): DeleteWantResult => {
  const part = (tag: string): string => {
    const b64 = body.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1];
    return b64 ? decodeAjaxHtml(b64) : '';
  };
  const result = part('resultType').trim().toLowerCase();
  const messageHtml = part('systemMessage');
  const heading =
    messageHtml.match(/alert-heading[^>]*>\s*([^<]+)</i)?.[1]?.trim() ??
    messageHtml
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  if (/^error$/.test(result) || /alert-danger/i.test(messageHtml)) {
    return { message: heading || 'Add refused', ok: false };
  }
  if (result === 'success') return { message: 'Added', ok: true };
  return { message: heading || 'Added', ok: true };
};

export interface ProductIds {
  idMetacard?: string;
  idProduct: string;
}

/**
 * Read a product's `idProduct` (+ `idMetacard`) from a product page. Prefers
 * explicit hidden inputs / data attributes the add-to-want-list control uses,
 * then falls back to the first occurrence in the page's inline JS. Both ids are
 * needed for {@link addWantByProduct}; id-less pages return null.
 */
export const parseProductIds = (root: ParentNode): ProductIds | null => {
  const el = root as ParentNode & { querySelector: ParentNode['querySelector'] };
  const attr = (sel: string, ...names: string[]): string | undefined => {
    const node = el.querySelector(sel);
    for (const n of names) {
      const v = node?.getAttribute(n)?.trim();
      if (v && /^\d+$/.test(v)) return v;
    }
    return undefined;
  };
  const html = (root as Document).documentElement?.innerHTML ?? (root as Element).innerHTML ?? '';
  const rx = (name: string): string | undefined =>
    html.match(new RegExp(`${name}["']?\\s*[:=]\\s*["']?(\\d+)`, 'i'))?.[1];

  const idProduct =
    attr('input[name="idProduct"]', 'value') ??
    attr('[data-id-product]', 'data-id-product') ??
    attr('[data-product-id]', 'data-product-id') ??
    rx('idProduct');
  if (!idProduct) return null;

  const idMetacard =
    attr('input[name="idMetacard"]', 'value') ??
    attr('[data-id-metacard]', 'data-id-metacard') ??
    attr('[data-metacard-id]', 'data-metacard-id') ??
    rx('idMetacard');

  return { idMetacard, idProduct };
};

const productIdsCache = new Map<string, ProductIds | null>();

/** Fetch (and cache) a product's ids from its product-page URL. */
export const fetchProductIds = async (
  productUrl: string,
  signal?: AbortSignal,
): Promise<ProductIds | null> => {
  const cached = productIdsCache.get(productUrl);
  if (cached !== undefined) return cached;
  const { doc } = await fetchDoc(productUrl, signal);
  const ids = parseProductIds(doc);
  productIdsCache.set(productUrl, ids);
  return ids;
};

/** Enumerate all of the user's want lists (id + name) from the /Wants overview. */
export const fetchAllWantLists = async (signal?: AbortSignal): Promise<WantListMeta[]> => {
  const { doc } = await fetchDoc(WANTS_URL, signal);
  return parseWantLists(doc);
};

// ---------------------------------------------------------------------------
// Finding a card's product, from its name alone
// ---------------------------------------------------------------------------
// Adding to a want list needs an `idMetacard`, and a deck only knows names.
//
// Scryfall records Cardmarket's own id for every printing, so the first move is
// to ask it and go straight to `/Magic/Products?idProduct=<id>`, which is the
// card we meant by definition. What we still need from the page is `idMetacard`,
// which the want form sends alongside.
//
// Failing that (a card Scryfall has no id for), we guess the slug of the card's
// own page and, if that misses, search. Both are guesses, so what comes back is
// checked against the name we asked for. Cardmarket answers an unknown name with
// the nearest one it knows — search "Witchstalker" and the first hit is
// "Witchstalker Frenzy" — and a want list quietly holding the wrong card is
// worse than one that's missing a row.
//
// Resolutions are cached in storage, keyed by card name: they never change, and
// re-running a deck against a second list shouldn't re-walk the whole site.

/**
 * Bumped to 2 when the name check came in (entries written before it can name
 * the wrong card, and there's no telling which from the ids alone), and to 3
 * when `idMetacard` became the thing we add by: entries lacking one are of no
 * use now.
 */
const PRODUCT_IDS_KEY = 'lugin:productIdsByCard:3';
const PRODUCT_IDS_KEY_OLD = ['lugin:productIdsByCard', 'lugin:productIdsByCard:2'];

/** A card resolved far enough to be added to a want list. */
export type Resolved = ProductIds & { idMetacard: string };

let productsByCard: Record<string, Resolved> | null = null;

const productCache = async (): Promise<Record<string, Resolved>> => {
  if (!productsByCard) {
    const stored = (await chrome.storage.local.get(PRODUCT_IDS_KEY))[PRODUCT_IDS_KEY];
    productsByCard = (stored as Record<string, Resolved> | undefined) ?? {};
    void chrome.storage.local.remove(PRODUCT_IDS_KEY_OLD);
  }
  return productsByCard;
};

const rememberProduct = async (name: string, ids: Resolved) => {
  const cache = await productCache();
  cache[cardKey(name)] = ids;
  await chrome.storage.local.set({ [PRODUCT_IDS_KEY]: cache });
};

/** The trailing slug of a card or product URL, lowercased, query dropped. */
const urlSlug = (href: string): string =>
  (href.split(/[?#]/)[0]?.split('/').filter(Boolean).pop() ?? '').toLowerCase();

/**
 * The card a product or card page is about, as the page titles itself.
 *
 * The heading holds the set name in a nested span — `<h1>Witchstalker<span>Magic
 * 2014</span></h1>` — so only its own text will do; all of it reads
 * "WitchstalkerMagic 2014" and matches nothing. Failing that, the document title
 * ("Witchstalker | Magic 2014 | Cardmarket") says the same thing.
 */
export const parseProductName = (doc: ParentNode): string => {
  const el = doc as ParentNode & { querySelector: ParentNode['querySelector'] };
  const heading = el.querySelector('h1');
  const TEXT_NODE = 3;
  const own = [...(heading?.childNodes ?? [])]
    .filter(n => n.nodeType === TEXT_NODE)
    .map(n => n.textContent ?? '')
    .join(' ');
  const title = el.querySelector('title')?.textContent?.split('|')[0] ?? '';
  const clean = (s: string): string => stripVersion(s.replace(/\s+/g, ' ').trim());
  return clean(own) || clean(title) || clean(heading?.textContent ?? '');
};

/**
 * Is this page about the card we asked for?
 *
 * Compared by front face, since Cardmarket titles a two-faced card with both
 * ("Duskwatch Recruiter // Krallenhorde Howler") where a decklist names one. A
 * page we can't read a name off is taken on trust — the callers only reach it by
 * an id or a slug that already identifies the card.
 */
const isCard = (doc: ParentNode, name: string): boolean => {
  const found = parseProductName(doc);
  if (!found) return true;
  return cardKey(frontFaceName(found)) === cardKey(frontFaceName(name));
};

/**
 * Resolve a card name to the ids the want-list API needs, or null if Cardmarket
 * has no single by that name. Throws `CHALLENGE: …` when the site answers with a
 * human-verification page, so a caller adding a hundred cards stops rather than
 * recording a hundred phantom misses.
 */
export const findProductForCard = async (
  name: string,
  signal?: AbortSignal,
): Promise<Resolved | null> => {
  const cached = (await productCache())[cardKey(name)];
  if (cached?.idMetacard) return cached;

  const read = async (url: string): Promise<Document> => {
    const { doc, html } = await fetchDoc(url, signal);
    const wrong = looksWrong(doc, html);
    if (wrong) throw new Error(`CHALLENGE: ${wrong}`);
    return doc;
  };

  const keep = async (ids: ProductIds | null): Promise<Resolved | null> => {
    // Without `idMetacard` there's nothing to add — a want names a card, not a
    // printing — so an id-less resolution is no resolution at all.
    if (!ids?.idMetacard) return null;
    const resolved = { idMetacard: ids.idMetacard, idProduct: ids.idProduct };
    await rememberProduct(name, resolved);
    return resolved;
  };

  // Cardmarket's own id for the card, by way of Scryfall. `?idProduct=` lands on
  // the product page, which is where `idMetacard` lives; no name check is needed
  // or wanted here, since the id names the printing outright.
  const [meta] = await requestScryfall([name]);
  if (meta?.cardmarketId) {
    const idProduct = String(meta.cardmarketId);
    try {
      const doc = await read(`/${currentLang()}/Magic/Products?idProduct=${idProduct}`);
      const found = await keep({ ...parseProductIds(doc), idProduct });
      if (found) return found;
    } catch (err) {
      // An id Cardmarket no longer serves leaves the name to go on, same as a
      // card Scryfall knows no id for. Challenges and network trouble belong to
      // the caller.
      const message = err instanceof Error ? err.message : String(err);
      if (!/\b404\b/.test(message)) throw err;
    }
    await pace(signal);
  }

  const cardUrl = metacardUrlFromName(name);
  const slug = cardUrl ? urlSlug(cardUrl) : '';

  /**
   * The ids a page carries, or those of the printing it links to.
   *
   * A card page lists every printing but is not itself a product, so it holds no
   * `idProduct` — and the printing it links to is exactly where a search for the
   * name would have sent us. Following the link we already have in hand saves
   * asking the search page the same question. Prefer a printing of the card we
   * asked for: these pages link to others too, and the first link needn't be
   * ours. Whatever we land on has to be the right card.
   */
  const idsFrom = async (doc: Document): Promise<ProductIds | null> => {
    const own = parseProductIds(doc);
    if (own) return isCard(doc, name) ? own : null;
    const links = [...doc.querySelectorAll<HTMLAnchorElement>('a[href*="/Products/Singles/"]')]
      .map(a => a.getAttribute('href'))
      .filter((h): h is string => !!h);
    const href = links.find(h => urlSlug(h) === slug) ?? links[0];
    if (!href) return null;
    await pace(signal);
    const product = await read(new URL(href, location.origin).toString());
    return isCard(product, name) ? parseProductIds(product) : null;
  };

  // The card's own page, straight from its name.
  if (cardUrl) {
    try {
      const ids = await idsFrom(await read(cardUrl));
      if (ids) return keep(ids);
    } catch (err) {
      // A 404 only means our slug guess was wrong, and the search below is the
      // answer. Aborts, challenges and network trouble belong to the caller.
      const message = err instanceof Error ? err.message : String(err);
      if (!/\b404\b/.test(message)) throw err;
    }
    await pace(signal);
  }

  // Last resort: the search page, which either is the product (an exact match
  // redirects to it) or links to it.
  const search = `/${currentLang()}/Magic/Products/Search?searchString=${encodeURIComponent(
    frontFaceName(name),
  )}`;
  return keep(await idsFrom(await read(search)));
};

// ---------------------------------------------------------------------------
// Creating a want list
// ---------------------------------------------------------------------------
// The site's "new want list" control POSTs:
//   POST /en/Magic/PostGetAction/WantsList_CreateWantsList
//   __cmtkn=<token>&wlName=<name>
// and answers by sending you to the list it just made, so the new id is right
// there in the URL we land on — no need to go looking for it.
const CREATE_WANTS_LIST_URL = '/Magic/PostGetAction/WantsList_CreateWantsList';

/**
 * What Cardmarket's new-list form accepts: letters, digits, spaces and hyphens,
 * 30 characters at most (`pattern="^[a-zA-Z0-9 \-]{1,30}$"` on the input).
 */
export const WANT_LIST_NAME = /^[a-zA-Z0-9 -]{1,30}$/;

/**
 * Fold a name into one the site will take.
 *
 * Worth doing rather than hoping: Cardmarket validates on the server too, and
 * answers a name it doesn't like with "Max. 30 alphanumeric characters" and no
 * list — so a single comma in "Atraxa, Praetors' Voice" would otherwise cost you
 * the whole thing. Accents fold to their letter, everything else becomes a
 * space, and an over-long name loses whole words rather than being cut mid-word.
 */
export const wantListName = (raw: string): string => {
  const clean = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= 30) return clean.replace(/[\s-]+$/, '');
  const cut = clean.slice(0, 30);
  const whole = cut.replace(/\s+\S*$/, '');
  return (whole || cut).replace(/[\s-]+$/, '');
};

/**
 * The id of the want list a response *is*, from the URL it settled on or the
 * page's own view of itself.
 *
 * Deliberately narrow. A want list page links to every other list in the
 * sidebar, so "the first /Wants/<id> in the HTML" would be a coin flip, and the
 * cost of guessing wrong is a hundred cards in somebody else's list. Only the
 * landing URL, the page's canonical link, and the id its own rows carry count.
 */
export const createdListId = (res: { body: string; url?: string }): string | undefined =>
  res.url?.match(/\/Wants\/(\d+)(?:[/?#]|$)/)?.[1] ??
  res.body.match(/<link[^>]+rel="canonical"[^>]+\/Wants\/(\d+)/i)?.[1] ??
  res.body.match(/name="idWantsList"[^>]*value="(\d+)"/i)?.[1];

/**
 * Look a list up by name on the Wants overview.
 *
 * The overview is written by the same request that made the list, but not always
 * before the redirect we're reading, so a miss is worth a second look rather
 * than an error. Newest first: with two lists of one name, the one just made is
 * the higher id.
 */
const findListByName = async (
  name: string,
  attempts: number,
  signal?: AbortSignal,
): Promise<WantListMeta | undefined> => {
  const wanted = name.trim().toLowerCase();
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await pace(signal);
    const lists = await fetchAllWantLists(signal);
    const found = lists
      .filter(l => l.name.trim().toLowerCase() === wanted)
      .sort((a, b) => Number(b.id) - Number(a.id));
    if (found[0]) return found[0];
  }
  return undefined;
};

/**
 * Create a want list and return its id and name.
 *
 * The id matters — every card added afterwards is addressed to it — so if the
 * redirect doesn't carry one, we go looking for the list by name before giving
 * up. Better to spend two page reads than to stop with the list already made.
 */
export const createWantList = async (
  name: string,
  token: string,
  signal?: AbortSignal,
): Promise<WantListMeta> => {
  const wlName = wantListName(name);
  if (!wlName) throw new Error('A want list name needs a letter or a digit in it.');

  const res = await replayInPage({
    body: new URLSearchParams({ __cmtkn: token, wlName }).toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
    },
    method: 'POST',
    url: `/${currentLang()}${CREATE_WANTS_LIST_URL}`,
  });
  if (!res.ok) throw new Error(`Cardmarket refused the new list (HTTP ${res.status}).`);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const id = createdListId(res) ?? (await findListByName(wlName, 2, signal))?.id;
  if (id) return { cardCount: 0, id, name: wlName };

  // No list anywhere means the form turned it down — it answers with the wants
  // page carrying its complaint (a name with a comma in it, say). Its words are
  // more use than ours, so pass them on.
  const refused = res.body
    .match(/alert-danger[\s\S]{0,500}?alert-heading[^>]*>\s*([^<]+)</i)?.[1]
    ?.trim();
  throw new Error(
    refused
      ? `Cardmarket wouldn’t take “${wlName}”: ${refused}`
      : 'Cardmarket didn’t say which list it made — check your want lists.',
  );
};

// The rest of a want list's lifecycle. Nothing calls these yet — they're here
// because we've seen what the site sends, and that's the expensive half of
// knowing how to do it:
//   POST /en/Magic/PostGetAction/WantsList_EditWantsListName
//   __cmtkn=<token>&idWantsList=<listId>&newName=<name>
//   POST /en/Magic/PostGetAction/WantsList_DeleteWantsList
//   __cmtkn=<token>&idWantsList=<listId>
// Both answer 302 back to the wants page.
const RENAME_WANTS_LIST_URL = '/Magic/PostGetAction/WantsList_EditWantsListName';
const DELETE_WANTS_LIST_URL = '/Magic/PostGetAction/WantsList_DeleteWantsList';

/** Rename a want list. */
export const renameWantList = (
  idWantsList: string,
  newName: string,
  token: string,
): Promise<DeleteWantResult> =>
  postWantsAction(
    RENAME_WANTS_LIST_URL,
    [
      ['__cmtkn', token],
      ['idWantsList', idWantsList],
      ['newName', newName],
    ],
    'Renamed',
  );

/** Delete a want list, and with it every want on it. */
export const deleteWantList = (idWantsList: string, token: string): Promise<DeleteWantResult> =>
  postWantsAction(
    DELETE_WANTS_LIST_URL,
    [
      ['__cmtkn', token],
      ['idWantsList', idWantsList],
    ],
    'Deleted',
  );

/**
 * Parse individual offer rows on a seller's offers page. Article rows carry an
 * id like `articleRow<id>` / `stockRow<id>` (the `<id>` is the article id used
 * by the add-to-cart endpoint). Falls back to bare product links (names only)
 * if the row markup isn't recognized.
 */
// Language names live in ./language.ts, shared with the page adapter.

/**
 * Normalize a card name read from a link's text. Some listing pages (e.g. the
 * Weekly Top Cards data page) inline extra text into the product link — a
 * duplicated printing marker and/or a "From 0,22 €" price — which corrupts the
 * name and breaks Scryfall lookups (e.g. "Arcane Signet (V.2) (V.2)From 0,22 €").
 * Drop any trailing price / "From …" and collapse repeated "(V.n)" markers.
 */
export const cleanOfferName = (raw: string): string => {
  let s = raw.replace(/\s+/g, ' ').trim();
  // Cut a trailing inline price ("From 0,22 €", "0,22 €", …) and anything after.
  s = s.replace(/\s*(?:from\b\s*)?\d[\d.,\s]*\s*€.*$/i, '').trim();
  // Collapse duplicated printing markers: "(V.2) (V.2)" → "(V.2)".
  s = s.replace(/(\(v\.?\s*\d+\))(?:\s*\1)+/gi, '$1').trim();
  return s;
};

export const parseOffers = (root: ParentNode): ParsedOffer[] => {
  const offers: ParsedOffer[] = [];
  const rows = root.querySelectorAll<HTMLElement>('[id^="articleRow"], [id^="stockRow"]');
  rows.forEach(row => {
    // Name: prefer a product link, but offer rows on the metacard page carry the
    // name only in the camera icon's tooltip (`data-bs-title="<img ... alt="X">"`).
    const linkName = row
      .querySelector<HTMLElement>('a[href*="/Products/Singles/"], a[href*="/Magic/Cards/"]')
      ?.textContent?.trim();
    let name = linkName ? cleanOfferName(linkName) : undefined;
    if (!name) {
      const tip = row
        .querySelector<HTMLElement>('.thumbnail-icon[data-bs-title], [data-bs-title*="alt="]')
        ?.getAttribute('data-bs-title');
      name = tip?.match(/alt="([^"]+)"/)?.[1]?.trim();
    }
    if (!name || name.length < 2 || isLanguageName(name)) return;

    const articleId = row.id.match(/(\d+)/)?.[1];

    // Edition: the expansion anchor carries it as aria-label / tooltip.
    const expA = row.querySelector<HTMLElement>('a[href*="/Expansions/"]');
    const edition =
      expA?.getAttribute('aria-label') ??
      expA?.getAttribute('data-bs-original-title') ??
      expA?.getAttribute('title') ??
      undefined;

    const isFoil = !!row.querySelector(
      '.st_SpecialIcon, [data-original-title="Foil" i], [aria-label="Foil" i]',
    );

    // Condition badge (e.g. "NM"). Scope to `.article-condition` so we don't grab
    // the seller's sell-count badge that appears earlier in the row.
    const condEl = row.querySelector<HTMLElement>('.article-condition .badge, .article-condition');
    const condition =
      condEl?.textContent?.trim() ||
      row.querySelector('.article-condition')?.getAttribute('data-bs-original-title') ||
      undefined;

    const language = languageOfRow(row);

    const { price, value } = findPrice(row);
    const imageUrl = findImageUrl(row);
    const prodHref = row
      .querySelector<HTMLAnchorElement>('a[href*="/Products/Singles/"]')
      ?.getAttribute('href');
    let productUrl: string | undefined;
    if (prodHref) {
      try {
        productUrl = new URL(prodHref, location.origin).href;
      } catch {
        productUrl = undefined;
      }
    }
    offers.push({
      articleId,
      condition,
      edition,
      imageUrl,
      isFoil,
      language,
      name,
      price,
      priceValue: value,
      productUrl,
    });
  });

  if (offers.length === 0) {
    // Name-only fallback (e.g. spoiler pages, which have no article/stock rows).
    // Keep the product link so we can look up editions and add to a want list.
    const seen = new Set<string>();
    root.querySelectorAll<HTMLAnchorElement>('a[href*="/Products/Singles/"]').forEach(a => {
      // Prefer the gallery image's `alt` (a clean name) over the link text, which
      // on gallery/search pages folds in the expansion symbol, a duplicated
      // "(V.n)" and the "From X €" price.
      const altName = a.querySelector<HTMLImageElement>('img[alt]')?.getAttribute('alt')?.trim();
      const name = cleanOfferName(altName || a.textContent || '');
      if (!name || name.length < 2 || isLanguageName(name)) return;
      const href = a.getAttribute('href');
      let productUrl: string | undefined;
      if (href) {
        try {
          productUrl = new URL(href, location.origin).href;
        } catch {
          productUrl = undefined;
        }
      }
      const dedupeKey = `${cardKey(name)}|${productUrl ?? ''}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      // Reuse the product image already on the page (direct `src` or lazy
      // `data-echo`) so we don't hit Scryfall for something the gallery shows.
      offers.push({ imageUrl: findImageUrl(a), isFoil: false, name, productUrl });
    });
  }
  return offers;
};

/** Highest `site=N` referenced by pagination links (1 if not paginated). */
const maxSite = (doc: ParentNode): number => {
  let max = 1;
  doc.querySelectorAll<HTMLAnchorElement>('a[href*="site="]').forEach(a => {
    const m = a.getAttribute('href')?.match(/[?&]site=(\d+)/);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (n > max) max = n;
    }
  });
  return max;
};

export type ScanStrategy = 'pages' | 'wantlists';

export interface ScanProgress {
  current: number;
  found: number;
  label?: string;
  phase: ScanStrategy;
  total: number;
}

export interface ScanMatch extends ParsedOffer {
  lists: string[];
}

export interface SellerScanResult {
  diagnostics: string[];
  matches: ScanMatch[];
  requests: number;
  strategy: ScanStrategy;
  /** Cards seen (page strategy: all offers scanned; wantlist strategy: matches). */
  totalScanned: number;
}

/** Cap so a pathological pagination value can't fan out into thousands of hits. */
const MAX_SELLER_PAGES = 100;
/** Cap for the (small) result of a single filtered want-list query. */
const MAX_FILTER_PAGES = 20;

interface WantListRef {
  id: string;
  name: string;
}

/** List names that contain at least one card, per the local index (ground truth). */
const listNamesWithCards = (index: WantsIndex): Set<string> => {
  const names = new Set<string>();
  for (const key of Object.keys(index.cards ?? {})) {
    for (const name of index.cards[key]?.lists ?? []) names.add(name);
  }
  return names;
};

/**
 * Non-empty want lists from the index, as {id, name} refs.
 *
 * Empty want lists MUST be skipped: Cardmarket treats `?idWantslist=<emptyId>`
 * as "no filter" and returns the seller's ENTIRE stock, so an empty list would
 * otherwise appear to match every card. We decide emptiness from the actual
 * per-card membership (ground truth), not the possibly-stale `extracted` count.
 */
const nonEmptyLists = (index: WantsIndex): WantListRef[] => {
  const withCards = listNamesWithCards(index);
  return (index.lists ?? [])
    .filter(l => withCards.has(l.name))
    .map(l => ({ id: l.id, name: l.name }));
};

/**
 * Strategy 'pages': walk offer pages until one comes back empty. The real page
 * count isn't reliably discoverable (the pagination bar hides the last page),
 * so we follow `site=N` incrementally and stop when a page has no offers or
 * repeats the previous one (site param ignored). Capped at MAX_SELLER_PAGES.
 */
const scanByPages = async (
  baseUrl: string,
  firstDoc: Document,
  onProgress: (p: ScanProgress) => void,
  signal?: AbortSignal,
): Promise<{ diagnostics: string[]; offers: Map<string, ParsedOffer>; requests: number }> => {
  const diagnostics: string[] = [];
  const offers = new Map<string, ParsedOffer>();
  const addAll = (list: ParsedOffer[]) => {
    for (const o of list) offers.set(o.articleId ?? `${cardKey(o.name)}|${o.price ?? ''}`, o);
  };
  addAll(parseOffers(firstDoc));
  let requests = 1;
  // total unknown up front → 0 tells the UI to show an open-ended count.
  onProgress({ current: 1, found: offers.size, phase: 'pages', total: 0 });

  const sep = baseUrl.includes('?') ? '&' : '?';
  for (let p = 2; p <= MAX_SELLER_PAGES; p++) {
    await pace(signal);
    const { doc } = await fetchDoc(`${baseUrl}${sep}site=${p}`, signal);
    requests++;
    const pageOffers = parseOffers(doc);
    if (pageOffers.length === 0) {
      diagnostics.push(`Page ${p} had no offers — stopping (${p - 1} page(s) scanned).`);
      break;
    }
    const before = offers.size;
    addAll(pageOffers);
    if (offers.size === before) {
      diagnostics.push(`Page ${p} repeated the previous page — site param ignored, stopping.`);
      break;
    }
    onProgress({ current: p, found: offers.size, phase: 'pages', total: 0 });
    if (p === MAX_SELLER_PAGES)
      diagnostics.push(`Hit page cap (${MAX_SELLER_PAGES}) — results may be partial.`);
  }
  return { diagnostics, offers, requests };
};

/** Strategy 'wantlists': query Cardmarket's ?idWantslist filter per list. */
const scanByWantLists = async (
  baseUrl: string,
  lists: WantListRef[],
  onProgress: (p: ScanProgress) => void,
  signal?: AbortSignal,
): Promise<{ diagnostics: string[]; matches: Map<string, ScanMatch>; requests: number }> => {
  const diagnostics: string[] = [];
  const matches = new Map<string, ScanMatch>();
  const sep = baseUrl.includes('?') ? '&' : '?';
  let requests = 0;

  for (let i = 0; i < lists.length; i++) {
    const list = lists[i];
    onProgress({
      current: i + 1,
      found: matches.size,
      label: list.name,
      phase: 'wantlists',
      total: lists.length,
    });
    await pace(signal);

    let page = 1;
    for (;;) {
      const url = `${baseUrl}${sep}idWantslist=${list.id}${page > 1 ? `&site=${page}` : ''}`;
      const { doc, html } = await fetchDoc(url, signal);
      requests++;
      if (page === 1) {
        const wrong = looksWrong(doc, html);
        if (wrong) diagnostics.push(`List "${list.name}" filter looks off: ${wrong}`);
      }
      const found = parseOffers(doc);
      for (const offer of found) {
        const key = offer.articleId ?? `${cardKey(offer.name)}|${offer.price ?? ''}`;
        const m = matches.get(key) ?? { ...offer, lists: [] };
        if (!m.lists.includes(list.name)) m.lists.push(list.name);
        matches.set(key, m);
      }
      const pages = Math.min(maxSite(doc), MAX_FILTER_PAGES);
      if (page >= pages || found.length === 0) break;
      page++;
      await pace(signal);
    }
  }
  return { diagnostics, matches, requests };
};

/**
 * Find everything a seller has that's on my want lists. Picks the cheaper of
 * the two strategies unless `forced` is given. `baseUrl` is the offers path
 * without query (e.g. `https://…/Magic/Users/<seller>/Offers/Singles`).
 */
export const scanSeller = async (
  baseUrl: string,
  index: WantsIndex,
  onProgress: (p: ScanProgress) => void,
  signal?: AbortSignal,
  forced?: ScanStrategy,
): Promise<SellerScanResult> => {
  const diagnostics: string[] = [];
  const lists = nonEmptyLists(index);
  const skipped = (index.lists ?? []).length - lists.length;
  if (skipped > 0) {
    diagnostics.push(
      `Skipped ${skipped} empty want list(s) — an empty filter would match the seller's whole stock.`,
    );
  }

  // Forcing the want-list filter skips the detection fetch entirely.
  if (forced === 'wantlists') {
    diagnostics.push(`Forced want-list filter across ${lists.length} list(s).`);
    const {
      matches,
      requests,
      diagnostics: d,
    } = await scanByWantLists(baseUrl, lists, onProgress, signal);
    const arr = [...matches.values()].sort((a, b) => a.name.localeCompare(b.name));
    return {
      diagnostics: [...diagnostics, ...d],
      matches: arr,
      requests,
      strategy: 'wantlists',
      totalScanned: arr.length,
    };
  }

  // Otherwise we need page 1 to know how many pages the seller has.
  const first = await fetchDoc(baseUrl, signal);
  const wrong = looksWrong(first.doc, first.html);
  if (wrong) diagnostics.push(`First page looks off: ${wrong}`);
  const detected = maxSite(first.doc);

  // The pagination bar only ever exposes a `site=2` link (Cardmarket hides the
  // real last page), so `detected` is just a lower bound: >=2 means "multi-page,
  // true size unknowable". Single page (detected<=1) → cheap page scan; any
  // pagination → bounded want-list filter regardless of how big the seller is.
  let strategy: ScanStrategy;
  if (forced) {
    strategy = forced;
  } else {
    strategy = detected <= 1 ? 'pages' : 'wantlists';
  }
  diagnostics.push(
    detected <= 1
      ? `No pagination detected (single page) → ${strategy} strategy.`
      : `Pagination present (real page count is hidden by the site) → ${strategy} strategy ` +
          `across ${lists.length} non-empty list(s).`,
  );

  if (strategy === 'pages') {
    const {
      offers,
      requests,
      diagnostics: d,
    } = await scanByPages(baseUrl, first.doc, onProgress, signal);
    const matches: ScanMatch[] = [];
    for (const offer of offers.values()) {
      const entry = index.cards[cardKey(offer.name)];
      if (entry) matches.push({ ...offer, lists: entry.lists });
    }
    matches.sort((a, b) => a.name.localeCompare(b.name));
    return {
      diagnostics: [...diagnostics, ...d],
      matches,
      requests,
      strategy,
      totalScanned: offers.size,
    };
  }

  // want-list filter (the detection fetch above counts as 1 request)
  const {
    matches,
    requests,
    diagnostics: d,
  } = await scanByWantLists(baseUrl, lists, onProgress, signal);
  const arr = [...matches.values()].sort((a, b) => a.name.localeCompare(b.name));
  return {
    diagnostics: [...diagnostics, ...d],
    matches: arr,
    requests: requests + 1,
    strategy: 'wantlists',
    totalScanned: arr.length,
  };
};

// ---------------------------------------------------------------------------
// Purchase history: index every card previously bought
// ---------------------------------------------------------------------------
// Cardmarket's own "search my purchases" caps at 24 months and isn't handy for
// answering "have I bought this before?" while browsing. Instead we walk the
// completed-purchase lists once (paid / sent / arrived / not-arrived), fold
// every order's articles into a name-keyed index, and cache it. Matching is by
// card name (front face), so any printing counts as purchased. The scan is
// incremental: orders already folded in are skipped on a re-sync, and an
// aborted scan still saves partial progress so re-syncing resumes cheaply.

/**
 * Cardmarket's own state for a completed purchase.
 *
 * These are route segments (`/Orders/Purchases/Arrived`), not display text, so
 * they read the same whatever language the account is in.
 */
export type PurchaseState = 'Paid' | 'Sent' | 'Arrived' | 'NotArrived';

/**
 * Completed-purchase states to scan (excludes Unpaid + Cancelled).
 *
 * Ordered weakest-to-strongest on purpose: an order can only be in one state, but
 * if the lists shift under us mid-sync and we see one twice, the later reading
 * wins — and later here means further along, or disputed.
 */
const PURCHASE_STATES: PurchaseState[] = ['Paid', 'Sent', 'Arrived', 'NotArrived'];
const MAX_LIST_PAGES = 40; // safety cap per state.

/** One purchase of a card: which order, when it was paid, and the unit price. */
export interface PurchaseRecord {
  /** Display date "DD.MM.YYYY" the order was paid, if found. */
  date?: string;
  /** Expansion/edition this exact printing came from (e.g. "Commander 2017"). */
  edition?: string;
  /** Whether this bought article was a foil printing. */
  foil?: boolean;
  /** Cardmarket image URL of the bought printing, if the order row carried one. */
  image?: string;
  orderId: string;
  /** Unit price paid for this article, in the order's currency. */
  price?: number;
  /** Cardmarket product id of the bought printing (for its edition image). */
  productId?: string;
  /** Product-page URL of the bought item, to tell singles from non-cards. */
  productUrl?: string;
  /** Quantity bought on this line (so total spend = price × qty). */
  qty?: number;
  /** Sortable timestamp (ms) derived from the paid date. */
  ts?: number;
}

export interface PurchaseCard {
  /** Total quantity bought across all orders. */
  count: number;
  name: string;
  /** Every time this card was bought (order id, date, price). */
  purchases: PurchaseRecord[];
}

/**
 * What an order is, as opposed to what was in it.
 *
 * The seller, the dispatch date and the shipping cost are properties of the order,
 * and the card-keyed index has nowhere to put them — `shipping` was already a
 * side-table keyed by order id, which was the shape asking to exist.
 *
 * Optional throughout: this arrived after people had already synced, so an index
 * without it is normal and the backfill in `syncPurchases` fills it in.
 */
export interface PurchaseOrder {
  /** Paid timestamp (ms), duplicated here so an order stands on its own. */
  paidTs?: number;
  /** Display name of the seller. */
  seller?: string;
  /** Stable seller identity, independent of the locale in the URL. */
  sellerSlug?: string;
  /** Seller profile path, for linking. */
  sellerUrl?: string;
  /** When the seller dispatched it (ms) — with `paidTs`, their handling time. */
  sentTs?: number;
  /**
   * Where the order has got to, from the list it was enumerated under.
   *
   * Read from the state lists rather than the order page, because those are
   * re-walked on every sync: an order that was in the post last week is on the
   * Arrived list this week without us refetching anything.
   */
  state?: PurchaseState;
}

export interface PurchaseIndex {
  /** cardKey -> purchase history for that card. */
  cards: Record<string, PurchaseCard>;
  diagnostics: string[];
  /** Order ids already folded in (so a re-sync only fetches new orders). */
  orderIds: string[];
  /** Per-order facts: seller, dispatch date. Absent on indexes synced before it. */
  orders?: Record<string, PurchaseOrder>;
  /** Shipping paid per order (order id -> amount), for a separate shipping total. */
  shipping?: Record<string, number>;
  syncedAt: number;
}

/** Order-detail ids referenced by a purchases list page. */
const parseOrderIds = (doc: ParentNode): string[] => {
  const ids = new Set<string>();
  // Each list row is a `.set-as-link` with `data-url="/en/Magic/Orders/<id>"`.
  doc.querySelectorAll<HTMLElement>('[data-url]').forEach(el => {
    const m = el.getAttribute('data-url')?.match(/\/Orders\/(\d+)/);
    if (m) ids.add(m[1]);
  });
  doc.querySelectorAll<HTMLAnchorElement>('a[href*="/Orders/"]').forEach(a => {
    const m = a.getAttribute('href')?.match(/\/Orders\/(\d+)(?:$|[?#])/);
    if (m) ids.add(m[1]);
  });
  return [...ids];
};

/** Total list pages from the "Page X of Y" pager (defaults to 1). */
const parsePageCount = (doc: ParentNode): number => {
  const txt = [...doc.querySelectorAll('.pagination .mx-1')]
    .map(s => s.textContent ?? '')
    .find(t => /Page\s+\d+\s+of\s+\d+/i.test(t));
  return Math.max(1, Number.parseInt(txt?.match(/of\s+(\d+)/i)?.[1] ?? '1', 10) || 1);
};

interface OrderArticle {
  amount: number;
  edition?: string;
  foil?: boolean;
  image?: string;
  name: string;
  price?: number;
  productId?: string;
  /** Absolute product-page URL, used to tell singles from sealed/accessories. */
  productUrl?: string;
}

/**
 * True when a Cardmarket product URL points at an actual Magic single (a card),
 * as opposed to sealed product, accessories (sleeves, deck boxes…) or bulk lots,
 * which live under other product categories. Singles are `/Products/Singles/…`
 * (older layouts: `/Magic/Cards/…`).
 */
export const isCardProductUrl = (url?: string): boolean =>
  !!url && /\/(?:Products\/Singles|Cards)\//i.test(url);

// Conservative fallback for rows/records with no product URL (e.g. collections
// synced before URLs were captured). Only phrases with negligible chance of
// being an actual card name — accessory brands/types and bulk-lot wording.
const NON_CARD_NAME_RE =
  /\b(?:sleeves?|deck\s*box(?:es)?|play[-\s]?mat|top[-\s]?loaders?|binder|portfolio|dragon\s*shield|ultra[-\s]?pro|gamegenic|card\s*sleeves?|bulk\s*lot|random\s+(?:commons?|uncommons?|rares?|mythics?|cards?))\b/i;

/** Heuristic "this isn't a Magic card" check for name-only rows. */
export const isNonCardName = (name: string): boolean => NON_CARD_NAME_RE.test(name);

/**
 * Whether a purchased entry is an actual Magic card. Prefers the hard signal —
 * the product URL's category — when any purchase carried one; otherwise falls
 * back to the conservative name heuristic (so pre-URL synced data is still
 * filtered without dropping real cards).
 */
export const isCardPurchase = (card: PurchaseCard): boolean => {
  const urls = card.purchases.map(p => p.productUrl).filter((u): u is string => !!u);
  if (urls.length > 0) return urls.some(isCardProductUrl);
  return !isNonCardName(card.name);
};

const FOIL_ATTRS = [
  'data-original-title',
  'data-bs-original-title',
  'data-bs-title',
  'aria-label',
  'title',
];
const FOIL_RE = /(^|[^a-z])foil([^a-z]|$)/i;

/** True if a card row is a foil printing (special-icon / a "Foil" label). */
const rowIsFoil = (row: ParentNode): boolean => {
  const el = row as Element;
  if (el.querySelector?.('.st_SpecialIcon')) return true;
  // Cardmarket marks foil with an icon whose tooltip/label reads "Foil"
  // (localized variants still contain the word). Scan the row's labelled nodes.
  return [...(el.querySelectorAll?.(`[${FOIL_ATTRS.join('], [')}]`) ?? [])].some(node =>
    FOIL_ATTRS.some(a => FOIL_RE.test(node.getAttribute(a) ?? '')),
  );
};

/** Purchased article rows (name, qty, unit price, edition, image) from an order. */
const parseOrderArticles = (doc: ParentNode): OrderArticle[] => {
  const seen = new Set<string>();
  const out: OrderArticle[] = [];
  doc.querySelectorAll<HTMLElement>('tr[data-article-id][data-name]').forEach(tr => {
    const id = tr.getAttribute('data-article-id') ?? '';
    if (id && seen.has(id)) return;
    if (id) seen.add(id);
    const name = tr.getAttribute('data-name')?.trim();
    if (!name) return;
    const price = Number.parseFloat(tr.getAttribute('data-price') ?? '');
    // The expansion is on the row as `data-expansion-name`; fall back to the
    // expansion icon's tooltip/aria-label if that attribute isn't present.
    const edition =
      tr.getAttribute('data-expansion-name')?.trim() ||
      tr
        .querySelector('.expansion-symbol[aria-label], [aria-label][class*="expansion"]')
        ?.getAttribute('aria-label')
        ?.trim() ||
      undefined;
    // The exact printing's image: the thumbnail tooltip embeds an <img src>
    // (same component as the cart); fall back to a plain <img> in the row.
    const tip =
      tr.querySelector('.thumbnail-icon[data-bs-title]')?.getAttribute('data-bs-title') ??
      tr.querySelector('[data-original-title]')?.getAttribute('data-original-title') ??
      undefined;
    const image =
      tip?.match(/src="([^"]+)"/)?.[1] ?? tr.querySelector('img')?.getAttribute('src') ?? undefined;
    const href = tr
      .querySelector<HTMLAnchorElement>('a[href*="/Products/"], a[href*="/Cards/"]')
      ?.getAttribute('href');
    let productUrl: string | undefined;
    if (href) {
      try {
        productUrl = new URL(href, location.origin).href;
      } catch {
        productUrl = undefined;
      }
    }
    out.push({
      amount: Number.parseInt(tr.getAttribute('data-amount') ?? '1', 10) || 1,
      edition,
      foil: rowIsFoil(tr),
      image: image && !/blank|placeholder|spacer/i.test(image) ? image : undefined,
      name,
      price: Number.isFinite(price) ? price : undefined,
      productId: tr.getAttribute('data-product-id')?.trim() || undefined,
      productUrl,
    });
  });
  return out;
};

// Shipping-cost label as it appears in the order summary, across a few locales.
const SHIPPING_LABEL_RE =
  /(shipping|postage|versand|frais\s*d[’']?envoi|spedizione|env[íi]o|verzend)/i;

/**
 * Shipping cost from an order-detail page's cost summary. The summary is a
 * label/value list (dt/dd) or a small table; we match the shipping label and
 * read the euro amount next to it. Best-effort — returns undefined if not found
 * (e.g. free shipping or an unrecognized layout).
 */
const parseOrderShipping = (doc: ParentNode): number | undefined => {
  for (const dt of doc.querySelectorAll('dt')) {
    if (!SHIPPING_LABEL_RE.test(dt.textContent ?? '')) continue;
    const raw = dt.nextElementSibling?.textContent?.match(ANY_PRICE_RE)?.[1];
    const v = raw ? toValue(raw) : undefined;
    if (v != null) return v;
  }
  for (const tr of doc.querySelectorAll('tr')) {
    const cells = [...tr.querySelectorAll('th, td')];
    if (cells.length < 2 || !SHIPPING_LABEL_RE.test(cells[0].textContent ?? '')) continue;
    const raw = cells[cells.length - 1].textContent?.match(ANY_PRICE_RE)?.[1];
    const v = raw ? toValue(raw) : undefined;
    if (v != null) return v;
  }
  return undefined;
};

// The paid/sent timeline reader lives in ./order.ts, with the seller.

export const syncPurchases = async (
  onProgress: (p: SyncProgress) => void,
  signal?: AbortSignal,
  previous?: PurchaseIndex,
): Promise<PurchaseIndex> => {
  const diagnostics: string[] = [];
  const cards: Record<string, PurchaseCard> = {};
  for (const [k, v] of Object.entries(previous?.cards ?? {})) {
    cards[k] = { count: v.count, name: v.name, purchases: [...(v.purchases ?? [])] };
  }
  const shipping: Record<string, number> = { ...(previous?.shipping ?? {}) };
  const orders: Record<string, PurchaseOrder> = { ...(previous?.orders ?? {}) };
  const known = new Set(previous?.orderIds ?? []);
  const base = `/${currentLang()}/Magic/Orders/Purchases`;

  const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';
  const incremental = known.size > 0;
  let aborted = false;
  let firstFetch = true;
  if (incremental) diagnostics.push(`Incremental re-sync: ${known.size} order(s) already indexed.`);

  try {
    // Phase 1: enumerate order ids across the completed-purchase states. Lists
    // are sorted newest-first, so on an incremental re-sync we stop paginating a
    // state as soon as a page has no unseen orders — no need to walk old history.
    const orderIds = new Set<string>();
    // Which list each order turned up under. Cheap — we walk these pages anyway —
    // and it is the only reading of "has it arrived yet" that refreshes without
    // refetching the order itself.
    const seenState = new Map<string, PurchaseState>();
    const hasUnseen = (ids: string[]) => ids.some(id => !known.has(id));
    for (let s = 0; s < PURCHASE_STATES.length; s++) {
      const state = PURCHASE_STATES[s];
      onProgress({
        current: s,
        listName: `Listing ${state}…`,
        phase: 'listing',
        total: PURCHASE_STATES.length,
      });
      const listUrl = `${base}/${state}`;
      try {
        if (!firstFetch) await pace(signal);
        firstFetch = false;
        const { doc, html } = await fetchDoc(listUrl, signal);
        if (s === 0) {
          const wrong = looksWrong(doc, html);
          if (wrong) diagnostics.push(`Purchases page looks off: ${wrong}`);
        }
        const before = orderIds.size;
        let pageIds = parseOrderIds(doc);
        pageIds.forEach(id => {
          orderIds.add(id);
          seenState.set(id, state);
        });
        const reportedPages = parsePageCount(doc);
        const totalPages = Math.min(reportedPages, MAX_LIST_PAGES);
        if (reportedPages > MAX_LIST_PAGES) {
          diagnostics.push(
            `${state}: has ${reportedPages} pages — capping at ${MAX_LIST_PAGES} (oldest orders skipped). Tell me if you need the cap raised.`,
          );
        }
        let pagesFetched = 1;
        // Stop early on a re-sync once the newest page is already fully known.
        let stop = incremental && !hasUnseen(pageIds);
        for (let p = 2; p <= totalPages && !stop; p++) {
          await pace(signal);
          const pre = orderIds.size;
          const { doc: pd } = await fetchDoc(`${listUrl}?site=${p}`, signal);
          pagesFetched++;
          pageIds = parseOrderIds(pd);
          const pageHadUnseen = hasUnseen(pageIds);
          pageIds.forEach(id => {
            orderIds.add(id);
            seenState.set(id, state);
          });
          if (orderIds.size === pre) {
            // Page p returned only ids we already have this run. If the pager
            // claims more pages, `?site=` likely isn't advancing the list.
            if (p < totalPages) {
              diagnostics.push(
                `${state}: page ${p} returned no new orders though the pager shows ${totalPages} ` +
                  '— pagination param may be unsupported (older orders may be missed).',
              );
            }
            break;
          }
          if (incremental && !pageHadUnseen) stop = true; // reached known history
        }
        diagnostics.push(
          `${state}: +${orderIds.size - before} order(s) over ${pagesFetched}/${totalPages} page(s)` +
            `${stop && totalPages > pagesFetched ? ' (stopped early — rest already indexed)' : ''}.`,
        );
      } catch (err) {
        if (isAbort(err)) throw err;
        diagnostics.push(`${state}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Record the states now, before any order is fetched: an order whose state
    // moved on is worth knowing about even if the run is aborted halfway through
    // phase 2, and it costs nothing since the lists have just been read.
    for (const [id, state] of seenState) orders[id] = { ...orders[id], state };

    // Backfill: older orders indexed before we captured edition/image/product-id
    // won't show the right picture. Detect those (a record missing *both* a
    // product id and an image) and refetch them so history heals itself without
    // a full clear. We drop their stale records first so refetch replaces them.
    const needBackfill = new Set<string>();
    // Orders indexed before we read the seller off the page. Counted separately
    // because this is the one backfill that can flag *every* past order at once,
    // and a re-sync that suddenly refetches two hundred pages should say why.
    let needSeller = 0;
    if (incremental) {
      for (const c of Object.values(cards)) {
        for (const r of c.purchases) {
          // Missing image/product-id (wrong picture) or missing foil knowledge
          // (indexed before we captured it) — refetch once so history heals.
          if ((!r.productId && !r.image) || r.foil === undefined) needBackfill.add(r.orderId);
        }
      }
      for (const id of known) {
        if (orders[id]?.sellerSlug) continue;
        if (!needBackfill.has(id)) needSeller += 1;
        needBackfill.add(id);
      }
    }
    if (needBackfill.size > 0) {
      for (const [k, c] of Object.entries(cards)) {
        const removedQty = c.purchases
          .filter(r => needBackfill.has(r.orderId))
          .reduce((n, r) => n + (r.qty ?? 1), 0);
        c.purchases = c.purchases.filter(r => !needBackfill.has(r.orderId));
        c.count -= removedQty;
        if (c.purchases.length === 0) delete cards[k];
      }
      for (const id of needBackfill) {
        delete shipping[id];
        known.delete(id);
      }
      diagnostics.push(
        `Backfilling ${needBackfill.size} older order(s) for edition/image data.` +
          (needSeller > 0 ? ` ${needSeller} of them to learn who sold them.` : ''),
      );
    }

    // Phase 2: fetch orders we haven't folded in before, plus any flagged for
    // backfill (their old records were just dropped above).
    const toFetch = [...new Set([...orderIds, ...needBackfill])].filter(id => !known.has(id));
    diagnostics.push(`${orderIds.size} completed order(s); fetching ${toFetch.length} new.`);
    let done = 0;
    for (const id of toFetch) {
      onProgress({
        current: ++done,
        listName: `Order #${id}`,
        phase: 'orders',
        total: toFetch.length,
      });
      try {
        await pace(signal);
        const { doc } = await fetchDoc(`/${currentLang()}/Magic/Orders/${id}`, signal);
        const { date, sentTs, ts } = parseOrderTimeline(doc);
        const seller = parseOrderSeller(doc);
        // Merged, not replaced: the state was recorded from the list pages above
        // and the order page has nothing better to say about it.
        orders[id] = {
          ...orders[id],
          ...(ts == null ? {} : { paidTs: ts }),
          ...(seller
            ? { seller: seller.name, sellerSlug: seller.slug, sellerUrl: seller.url }
            : {}),
          ...(sentTs == null ? {} : { sentTs }),
        };
        for (const art of parseOrderArticles(doc)) {
          const key = cardKey(art.name);
          if (!key) continue;
          const entry =
            cards[key] ?? (cards[key] = { count: 0, name: frontFaceName(art.name), purchases: [] });
          entry.count += art.amount;
          entry.purchases.push({
            date,
            edition: art.edition,
            foil: art.foil,
            image: art.image,
            orderId: id,
            price: art.price,
            productId: art.productId,
            productUrl: art.productUrl,
            qty: art.amount,
            ts,
          });
        }
        const ship = parseOrderShipping(doc);
        if (ship != null) shipping[id] = ship;
        known.add(id);
      } catch (err) {
        if (isAbort(err)) throw err;
        diagnostics.push(`Order ${id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    if (!isAbort(err)) throw err;
    aborted = true;
  }

  const shipTotal = Object.values(shipping).reduce((a, b) => a + b, 0);
  if (shipTotal > 0) {
    diagnostics.push(
      `Shipping captured for ${Object.keys(shipping).length} order(s), total ${shipTotal.toFixed(2)} €.`,
    );
  }
  diagnostics.push(
    aborted ? 'Stopped early — partial index saved; re-sync resumes.' : 'Scan complete.',
  );
  const named = Object.values(orders).filter(o => o.sellerSlug).length;
  if (named > 0) {
    const distinct = new Set(Object.values(orders).map(o => o.sellerSlug).filter(Boolean)).size;
    diagnostics.push(`Seller known for ${named} order(s), across ${distinct} seller(s).`);
  }
  return { cards, diagnostics, orderIds: [...known], orders, shipping, syncedAt: Date.now() };
};

// ---------------------------------------------------------------------------
// "Sellers with the most wants" for a single want list
// ---------------------------------------------------------------------------
// A want-list page exposes a button that POSTs to Wantslist_SellersWithMostWants
// and gets back the top sellers ranked by how many of the list's cards they
// stock (+ a % and an "add all to cart" form). The native table shows only the
// count/% — it can't tell you *which* cards a seller is missing or the *total*
// price. We fetch that same ranking, then price each candidate by scanning their
// want-list-filtered offers, so sellers can be compared on real cost + coverage.

const SELLERS_WITH_MOST_WANTS_URL = '/Magic/AjaxAction/Wantslist_SellersWithMostWants';

export interface SellerWants {
  /** How many of the list's cards this seller stocks (per Cardmarket). */
  count: number;
  /** Cardmarket seller id (from the row's add-all-to-cart form). */
  idSeller: string;
  /** Item location country, if present. */
  location?: string;
  name: string;
  /** Coverage percentage Cardmarket reports for the list. */
  pct: number;
  /** Approximate sell count shown on the row (e.g. "331K"), for context. */
  sales?: string;
  /** Seller profile path, e.g. "/en/Magic/Users/FKTRD". */
  url: string;
}

/** Decode the base64 (UTF-8) HTML fragment Cardmarket wraps its ajax reply in. */
const decodeAjaxHtml = (b64: string): string => {
  const clean = b64.replace(/\s+/g, '');
  try {
    return decodeURIComponent(escape(atob(clean)));
  } catch {
    try {
      return atob(clean);
    } catch {
      return '';
    }
  }
};

/** Parse the decoded sellers table into ranked seller rows. */
const parseSellersWithMostWants = (doc: ParentNode): SellerWants[] => {
  const out: SellerWants[] = [];
  doc.querySelectorAll<HTMLElement>('tbody tr').forEach(tr => {
    const link = tr.querySelector<HTMLAnchorElement>('.seller-name a[href*="/Users/"]');
    const idSeller = tr.querySelector<HTMLInputElement>('input[name="idSeller"]')?.value?.trim();
    if (!link || !idSeller) return;
    const name = link.textContent?.trim() ?? '';
    const url = link.getAttribute('href') ?? '';

    // The 2nd cell reads like "21 (100%)".
    const cells = tr.querySelectorAll('td');
    const countText = cells[1]?.textContent ?? '';
    const count = Number.parseInt(countText.match(/\d+/)?.[0] ?? '0', 10) || 0;
    const pct = Number.parseInt(countText.match(/\((\d+)%\)/)?.[1] ?? '0', 10) || 0;

    const sales = tr.querySelector('.sell-count')?.textContent?.replace(/\s+/g, '') || undefined;
    const location =
      tr
        .querySelector('[title^="Item location"]')
        ?.getAttribute('title')
        ?.replace(/^Item location:\s*/i, '')
        .trim() || undefined;

    out.push({ count, idSeller, location, name, pct, sales, url });
  });
  return out;
};

/**
 * Fetch the ranked list of sellers who stock the most cards from a want list.
 * `token` is the page CSRF token (`__cmtkn`); `idGame` defaults to Magic (1).
 */
export const fetchSellersWithMostWants = async (
  idWantsList: string,
  token: string,
  idGame = 1,
): Promise<SellerWants[]> => {
  const body =
    `__cmtkn=${encodeURIComponent(token)}` +
    `&idWantsList=${encodeURIComponent(idWantsList)}` +
    `&idGame=${encodeURIComponent(String(idGame))}`;

  const res = await replayInPage({
    body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
    },
    method: 'POST',
    url: `/${currentLang()}${SELLERS_WITH_MOST_WANTS_URL}`,
  });

  if (!res.ok) throw new Error(`Sellers lookup failed (HTTP ${res.status})`);
  const b64 = res.body.match(
    /<sellersWithMostWantsContent>([\s\S]*?)<\/sellersWithMostWantsContent>/,
  )?.[1];
  if (!b64) throw new Error('Unexpected response (no sellers content).');
  const html = decodeAjaxHtml(b64);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return parseSellersWithMostWants(doc);
};

export interface SellerListOffers {
  diagnostics: string[];
  offers: ParsedOffer[];
  requests: number;
}

/**
 * Fetch every offer a seller has for one specific want list, using Cardmarket's
 * own `?idWantslist=` filter (so the page already only shows the list's cards).
 * `sellerUrl` is the profile path from the ranking (e.g. "/en/Magic/Users/X").
 */
export const fetchSellerListOffers = async (
  sellerUrl: string,
  idWantsList: string,
  onProgress: (p: ScanProgress) => void,
  signal?: AbortSignal,
): Promise<SellerListOffers> => {
  const baseUrl = `${sellerUrl}/Offers/Singles?idWantslist=${encodeURIComponent(idWantsList)}`;
  const first = await fetchDoc(baseUrl, signal);
  const { offers, requests, diagnostics } = await scanByPages(
    baseUrl,
    first.doc,
    onProgress,
    signal,
  );
  return { diagnostics, offers: [...offers.values()], requests };
};
