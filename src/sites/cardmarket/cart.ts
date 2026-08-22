import { callStore } from '@/content/callStore';
import { replayInPage } from '@/lib/messaging';
import { sellerSlugFromHref } from '@/sites/cardmarket/order';
import { tokenFromArgs } from '@/sites/cardmarket/searchArgs';
import { countryId } from '@/sites/cardmarket/shipping';

// Cardmarket adds an offer to the cart with a single AJAX POST:
//   POST /<lang>/Magic/AjaxAction/ShoppingCart_Add_AddArticlesFromUserOffers
//   __cmtkn=<token>&idArticle={"<id>":"<id>"}&amount={"<id>":"1"}
// The `__cmtkn` is a per-session CSRF token. We reuse it from the page rather
// than mint our own, and replay the POST in the page context so it carries the
// user's session exactly like the site's own button does.

const TOKEN_HEX = /([0-9a-f]{32,})/i;
const TOKEN_IN_HTML = /__cmtkn['"\s:=]+([0-9a-f]{32,})/i;
const CART_MUTATION_RE = /ShoppingCart_[A-Za-z]/i;

const currentLang = (): string => {
  const first = location.pathname.split('/').filter(Boolean)[0] ?? '';
  return /^[a-z]{2}$/.test(first) ? first : 'en';
};

const addCartUrl = (): string =>
  `/${currentLang()}/Magic/AjaxAction/ShoppingCart_Add_AddArticlesFromUserOffers`;

const removeCartUrl = (): string =>
  `/${currentLang()}/Magic/AjaxAction/ShoppingCart_RemoveArticle`;

/** Read a session token out of a page's HTML, if it carries one. */
export const extractCmToken = (html: string): string | null => {
  const match = html.match(TOKEN_IN_HTML);
  return match ? match[1] : null;
};

const tokenFromCall = (call: { requestBody?: string; url?: string }): string | null => {
  const body = call.requestBody ?? '';
  const fromBody = body.match(/__cmtkn=([0-9a-f]{32,})/i);
  if (fromBody) return fromBody[1];
  const args = body.match(/(?:^|&)args=([^&]+)/)?.[1];
  if (args) {
    const fromArgs = tokenFromArgs(decodeURIComponent(args));
    if (fromArgs) return fromArgs;
  }
  const urlArgs = call.url?.match(/[?&]args=([^&]+)/)?.[1];
  if (urlArgs) {
    const fromArgs = tokenFromArgs(decodeURIComponent(urlArgs));
    if (fromArgs) return fromArgs;
  }
  return null;
};

/**
 * Find the session's `__cmtkn`. Prefers the live DOM (what the page would send
 * right now), then a token from a recent cart mutation (the site's own add),
 * then any captured request, then optionally a scrape of the page HTML.
 */
export const findCmToken = (opts: { allowHtmlScrape?: boolean } = {}): string | null => {
  const input = document.querySelector<HTMLInputElement>('input[name="__cmtkn"]');
  if (input?.value && TOKEN_HEX.test(input.value)) return input.value;
  const attr = document.querySelector('[data-token], [data-cmtkn]')?.getAttribute('data-token');
  if (attr && TOKEN_HEX.test(attr)) return attr;
  const calls = callStore.getSnapshot();
  for (const call of calls) {
    if (!CART_MUTATION_RE.test(call.url ?? '')) continue;
    const token = tokenFromCall(call);
    if (token) return token;
  }
  for (const call of calls) {
    const token = tokenFromCall(call);
    if (token) return token;
  }
  if (opts.allowHtmlScrape === false) return null;
  return extractCmToken(document.documentElement.innerHTML);
};

/** Decode Cardmarket's base64 ajax payload chunks (UTF-8 safe). */
const decodeB64 = (s: string): string => {
  try {
    return decodeURIComponent(escape(atob(s.trim())));
  } catch {
    try {
      return atob(s.trim());
    } catch {
      return '';
    }
  }
};

export interface AddToCartResult {
  message: string;
  ok: boolean;
}

/** Add a single article (by id) to the shopping cart via a replayed POST. */
export const addArticleToCart = async (
  articleId: string,
  token: string,
  amount = 1,
): Promise<AddToCartResult> => {
  const body =
    `__cmtkn=${encodeURIComponent(token)}` +
    `&idArticle=${encodeURIComponent(JSON.stringify({ [articleId]: articleId }))}` +
    `&amount=${encodeURIComponent(JSON.stringify({ [articleId]: String(amount) }))}`;

  const res = await replayInPage({
    body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
    },
    method: 'POST',
    url: addCartUrl(),
  });

  const resultType = decodeB64(res.body.match(/<resultType>([^<]*)<\/resultType>/)?.[1] ?? '');
  const sysHtml = decodeB64(res.body.match(/<systemMessage>([^<]*)<\/systemMessage>/)?.[1] ?? '');
  const heading =
    sysHtml.match(/alert-heading[^>]*>\s*([^<]+)</i)?.[1]?.trim() ||
    sysHtml.match(/alert-(?:danger|warning|success)[^>]*>\s*([^<]+)</i)?.[1]?.trim();
  const ok = res.ok && /success/i.test(resultType);
  return {
    message: heading || resultType || (ok ? 'Added to cart' : `Failed (HTTP ${res.status})`),
    ok,
  };
};
/**
 * Remove one cart line. Matches Cardmarket's own trash button:
 *   POST /<lang>/Magic/AjaxAction/ShoppingCart_RemoveArticle
 *   __cmtkn=…&idArticle=<id>&idSeller=<id>&amount-<id>=<n>
 * (`idArticle` is a bare id, not the JSON map used by Add.)
 */
export const removeArticleFromCart = async (
  articleId: string,
  token: string,
  opts: { amount?: number; sellerId: string },
): Promise<AddToCartResult> => {
  const amount = opts.amount ?? 1;
  const body =
    `__cmtkn=${encodeURIComponent(token)}` +
    `&idArticle=${encodeURIComponent(articleId)}` +
    `&idSeller=${encodeURIComponent(opts.sellerId)}` +
    `&amount-${encodeURIComponent(articleId)}=${encodeURIComponent(String(amount))}`;

  const res = await replayInPage({
    body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
    },
    method: 'POST',
    url: removeCartUrl(),
  });

  // The site answers with `<resultsCode>` (base64 `"1"` on success), not the
  // `<resultType>success</resultType>` shape the add endpoint uses.
  const codeRaw =
    res.body.match(/<resultsCode>([^<]*)<\/resultsCode>/i)?.[1] ??
    res.body.match(/<resultCode>([^<]*)<\/resultCode>/i)?.[1] ??
    '';
  const resultsCode = decodeB64(codeRaw).trim() || codeRaw.trim();
  const resultType = decodeB64(res.body.match(/<resultType>([^<]*)<\/resultType>/)?.[1] ?? '');
  const sysHtml = decodeB64(res.body.match(/<systemMessage>([^<]*)<\/systemMessage>/)?.[1] ?? '');
  const heading =
    sysHtml.match(/alert-heading[^>]*>\s*([^<]+)</i)?.[1]?.trim() ||
    sysHtml.match(/alert-(?:danger|warning|success)[^>]*>\s*([^<]+)</i)?.[1]?.trim();
  const ok = res.ok && (resultsCode === '1' || /success/i.test(resultType));

  return {
    message:
      heading ||
      resultType ||
      (ok ? 'Removed from cart' : resultsCode ? `Failed (code ${resultsCode})` : `Failed (HTTP ${res.status})`),
    ok,
  };
};

// ---------------------------------------------------------------------------
// Server cart mirror
// ---------------------------------------------------------------------------
// Every Cardmarket page's header carries the live cart total + item count
// (`#cart`), and the full /ShoppingCart page lists every article. We read the
// header for a cheap total and fetch the cart page for the authoritative
// contents — that's how we mirror the real cart even after silent adds.

const EURO_RE = /(\d[\d.\s]*,\d{2})\s*€/;

const euroValue = (raw: string): number | undefined => {
  const v = Number.parseFloat(raw.replace(/[.\s]/g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : undefined;
};

const formatEuro = (n: number): string => `${n.toFixed(2).replace('.', ',')} €`;

export interface CartItem {
  amount: number;
  articleId: string;
  expansion?: string;
  imageUrl?: string;
  name: string;
  price?: string;
  priceValue?: number;
  productId?: string;
  /** Seller username slug (from the seller header this row sits under). */
  seller?: string;
  /** Seller's country (flag / item location), for shipping estimates. */
  sellerCountry?: string;
  /** Numeric seller id — required by ShoppingCart_RemoveArticle. */
  sellerId?: string;
}

const COUNTRY_ATTRS = [
  'aria-label',
  'title',
  'data-bs-original-title',
  'data-bs-title',
  'data-original-title',
] as const;

/** Country name from a flag / "Item location: …" tip under `root`, if any. */
const countryHintFrom = (root: Element | null | undefined): string | undefined => {
  if (!root) return undefined;
  const nodes: Element[] = [root, ...root.querySelectorAll('*')];
  for (const el of nodes) {
    for (const attr of COUNTRY_ATTRS) {
      const raw = el.getAttribute(attr)?.trim();
      if (!raw) continue;
      const cleaned = raw.replace(/^Item location:\s*/i, '').replace(/\s+/g, ' ').trim();
      if (cleaned && countryId(cleaned) != null) return cleaned;
    }
  }
  return undefined;
};

export interface ServerCart {
  count: number;
  items: CartItem[];
  total?: string;
  totalValue?: number;
}

/** Read the cart total + count from any page's header (`#cart`). */
export const parseCartHeader = (
  doc: ParentNode,
): {
  count: number;
  total?: string;
  totalValue?: number;
} => {
  const cart = doc.querySelector('#cart');
  const m = (cart?.querySelector('.text-success')?.textContent ?? '').match(EURO_RE);
  const total = m ? `${m[1].replace(/\s/g, '')} €` : undefined;
  const totalValue = m ? euroValue(m[1]) : undefined;
  const count =
    Number.parseInt(cart?.querySelector('.main-nav-badge')?.textContent?.trim() ?? '', 10) || 0;
  return { count, total, totalValue };
};

/** Parse the /ShoppingCart article rows (deduped — the page renders them twice). */
export const parseCartItems = (doc: ParentNode): CartItem[] => {
  // The cart groups articles by seller. Walk seller markers and article rows in
  // document order; each row inherits the last seller name + id seen before it.
  //
  // Important: `#seller<digits>` anchors on the cart page are reservation block
  // ids, *not* the numeric `idSeller` that ShoppingCart_RemoveArticle expects.
  // Prefer hidden `input[name="idSeller"]` and explicit data attributes / the
  // trash control's own payload.
  const rowSeller = new Map<Element, { country?: string; id?: string; name?: string }>();
  let current: { country?: string; id?: string; name?: string } = {};

  const sellerIdOf = (el: Element): string | undefined => {
    if (el instanceof HTMLInputElement && el.name === 'idSeller') {
      const v = el.value.trim();
      return /^\d+$/.test(v) ? v : undefined;
    }
    for (const attr of ['data-seller-id', 'data-id-seller', 'data-idseller'] as const) {
      const v = el.getAttribute(attr)?.trim();
      if (v && /^\d+$/.test(v)) return v;
    }
    const onclick = el.getAttribute('onclick') ?? '';
    const fromClick = onclick.match(/idSeller['"\s:=]+(\d+)/i)?.[1];
    if (fromClick) return fromClick;
    return undefined;
  };

  doc
    .querySelectorAll(
      'a[href*="/Users/"], input[name="idSeller"], [data-seller-id], [data-id-seller], [data-idseller], [onclick*="idSeller"], tr[data-article-id]',
    )
    .forEach(node => {
      if (node.matches('tr[data-article-id]')) {
        rowSeller.set(node, { ...current });
        return;
      }
      // Inputs / data attrs inside a row belong to that row, not the running seller.
      if (node.closest('tr[data-article-id]')) return;

      const id = sellerIdOf(node);
      if (id) current = { ...current, id };

      if (node.matches('a[href*="/Users/"]')) {
        const slug = sellerSlugFromHref(node.getAttribute('href'));
        if (slug) {
          // Flag / country tip usually sits next to the username in the seller header.
          const country =
            countryHintFrom(node.parentElement) ||
            countryHintFrom(node.closest('div, section, header, h2, h3, td, th'));
          current = {
            ...current,
            name: slug,
            ...(country ? { country } : {}),
          };
        }
      }
    });

  const seen = new Set<string>();
  const items: CartItem[] = [];
  doc.querySelectorAll<HTMLElement>('tr[data-article-id]').forEach(tr => {
    const articleId = tr.getAttribute('data-article-id');
    const name = tr.getAttribute('data-name');
    if (!articleId || !name || seen.has(articleId)) return;
    seen.add(articleId);
    const priceAttr = tr.getAttribute('data-price');
    const priceValue = priceAttr ? Number.parseFloat(priceAttr) : undefined;
    const tip =
      tr.querySelector('.thumbnail-icon[data-bs-title]')?.getAttribute('data-bs-title') ??
      tr.querySelector('.thumbnail-icon[data-bs-original-title]')?.getAttribute(
        'data-bs-original-title',
      );
    const inherited = rowSeller.get(tr);
    const sellerId =
      sellerIdOf(tr) ||
      [...tr.querySelectorAll('input[name="idSeller"], [data-seller-id], [data-id-seller], [data-idseller], [onclick*="idSeller"]')]
        .map(sellerIdOf)
        .find(Boolean) ||
      inherited?.id ||
      undefined;
    const sellerCountry = inherited?.country || countryHintFrom(tr);
    items.push({
      amount: Number.parseInt(tr.getAttribute('data-amount') ?? '1', 10) || 1,
      articleId,
      expansion: tr.getAttribute('data-expansion-name') ?? undefined,
      imageUrl: tip?.match(/src="([^"]+)"/)?.[1],
      name,
      price: priceValue != null && Number.isFinite(priceValue) ? formatEuro(priceValue) : undefined,
      priceValue: priceValue != null && Number.isFinite(priceValue) ? priceValue : undefined,
      productId: tr.getAttribute('data-product-id') ?? undefined,
      seller: inherited?.name,
      sellerCountry,
      sellerId,
    });
  });
  return items;
};

/** Fetch the live shopping cart (total, count, and every article). */
export const fetchServerCart = async (signal?: AbortSignal): Promise<ServerCart> => {
  const res = await fetch(`/${currentLang()}/Magic/ShoppingCart`, {
    credentials: 'include',
    signal,
  });
  if (!res.ok) throw new Error(`Cart fetch failed (HTTP ${res.status})`);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  const header = parseCartHeader(doc);
  const items = parseCartItems(doc);
  const count = header.count || items.reduce((n, i) => n + i.amount, 0);
  // Fall back to summing item prices if the header total wasn't found.
  const totalValue =
    header.totalValue ??
    (items.length ? items.reduce((s, i) => s + (i.priceValue ?? 0) * i.amount, 0) : undefined);
  return {
    count,
    items,
    total: header.total ?? (totalValue != null ? formatEuro(totalValue) : undefined),
    totalValue,
  };
};
