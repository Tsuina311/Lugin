/**
 * Cardmarket Shopping Wizard — run → poll → parse Results → Add All to cart.
 *
 * Captured flow (want list → wizard):
 *   1. GET  /Wants/ShoppingWizard?idWantsList=<id>
 *   2. POST /AjaxAction  args=obfuscate(Wantslist_ShoppingWizard_StartCalculation***token)
 *                        ***base64({ __cmtkn, idWantsList, sellerCountry, … })
 *   3. Poll #ProgressForm (data-ajax-action) until progress=100 → redirectTo
 *   4. GET  /Wants/ShoppingWizard/Results/<idCalculation>
 *   5. POST /AjaxAction/Wantslist_ShoppingWizard_AddArticlesToCart
 *      (idCalculation + idArticle[id]/amount[id])
 */

import { expansionIconStore } from '@/content/expansionIconStore';
import { replayInPage } from '@/lib/messaging';
import { ajaxBox } from '@/sites/cardmarket/ajax';
import { isChallengeResponse, looksLikeChallenge } from '@/sites/cardmarket/challenge';
import { languageOfRow } from '@/sites/cardmarket/language';
import {
  ADD_ALL_ACTION,
  DEFAULT_MAX_SHIPPING_TIME,
  DEFAULT_SELLER_REPUTATION,
  DEFAULT_WIZARD_STRATEGY,
  buildStartCalculationArgs,
  extractWizardAddAllPayload,
  type WizardArticle,
} from '@/sites/cardmarket/shoppingWizardParse';
import { currentLang, fetchDoc, findImageUrl } from '@/sites/cardmarket/wants';

export {
  ADD_ALL_ACTION,
  DEFAULT_MAX_SHIPPING_TIME,
  DEFAULT_SELLER_REPUTATION,
  DEFAULT_WIZARD_STRATEGY,
  START_ACTION,
  buildStartCalculationArgs,
  extractWizardAddAllPayload,
  type WizardArticle,
} from '@/sites/cardmarket/shoppingWizardParse';

const PROGRESS_POLL_MS = 3000;
const PROGRESS_MAX_WAITS = 40;

const EURO_RE = /(\d[\d.\s]*,\d{2})\s*€/;

const euroValue = (raw: string): number | undefined => {
  const m = raw.match(EURO_RE);
  if (!m) return undefined;
  const v = Number.parseFloat(m[1].replace(/[.\s]/g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : undefined;
};

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

export interface WizardRunOptions {
  idWantsList: string;
  token: string;
  /** Country filter ids; empty = any. */
  sellerCountry?: string[];
  sellerReputation?: string;
  maxShippingTime?: string;
  /** Shopping Wizard strategy radio value (capture used "4"). */
  strategy?: string;
  signal?: AbortSignal;
  onProgress?: (pct: number) => void;
}

export interface WizardSellerBlock {
  name: string;
  url?: string;
  articles: WizardArticle[];
  articlesValue?: number;
  shippingCost?: number;
  total?: number;
}

export interface WizardResults {
  idCalculation: string;
  token: string;
  articles: WizardArticle[];
  sellers: WizardSellerBlock[];
  wantedArticles?: number;
  articlesValue?: number;
  shippingCost?: number;
  shipments?: number;
  total?: number;
  resultsUrl: string;
}

export interface WizardAddResult {
  message: string;
  ok: boolean;
}

export interface WizardIntoCartResult {
  add: WizardAddResult;
  results: WizardResults;
}

/** Pull articles from a Results form node (DOM path). */
export const parseWizardArticlesFromForm = (form: ParentNode): WizardArticle[] => {
  const amounts = new Map<string, number>();
  form.querySelectorAll<HTMLInputElement>('input[name^="amount["]').forEach(input => {
    const id = input.name.match(/^amount\[(\d+)\]$/)?.[1];
    if (!id) return;
    const n = Number.parseInt(input.value || '1', 10);
    amounts.set(id, Number.isFinite(n) && n > 0 ? n : 1);
  });
  const out: WizardArticle[] = [];
  form.querySelectorAll<HTMLInputElement>('input[name^="idArticle["]').forEach(input => {
    const id = input.name.match(/^idArticle\[(\d+)\]$/)?.[1] ?? input.value?.trim();
    if (!id || !/^\d+$/.test(id)) return;
    if (out.some(a => a.articleId === id)) return;
    out.push({ articleId: id, amount: amounts.get(id) ?? 1 });
  });
  return out;
};

/** Condition badge (NM / EX / …) from a Results article row. */
const conditionOfRow = (row: Element): string | undefined => {
  const condEl = row.querySelector<HTMLElement>('.article-condition .badge, .article-condition');
  return (
    condEl?.textContent?.replace(/\s+/g, ' ').trim() ||
    row.querySelector('.article-condition')?.getAttribute('data-bs-original-title') ||
    row.querySelector('.article-condition')?.getAttribute('data-original-title') ||
    undefined
  );
};

/** Expansion / set name for icon lookup. */
const editionOfRow = (row: Element): string | undefined => {
  const exp =
    row.querySelector<HTMLElement>('a[href*="/Expansions/"]') ??
    row.querySelector<HTMLElement>('.expansion-symbol');
  return (
    exp?.getAttribute('aria-label')?.trim() ||
    exp?.getAttribute('data-bs-original-title')?.trim() ||
    exp?.getAttribute('data-original-title')?.trim() ||
    exp?.getAttribute('title')?.trim() ||
    undefined
  );
};

const foilOfRow = (row: Element): boolean =>
  !!row.querySelector(
    '.st_SpecialIcon, [data-original-title="Foil" i], [data-bs-original-title="Foil" i], [aria-label="Foil" i]',
  );

const metaOfRow = (
  row: Element,
): Pick<WizardArticle, 'condition' | 'edition' | 'foil' | 'imageUrl' | 'language'> => ({
  condition: conditionOfRow(row),
  edition: editionOfRow(row),
  foil: foilOfRow(row) || undefined,
  imageUrl: findImageUrl(row),
  language: languageOfRow(row),
});

/** Card lines from one detailed-result-card (desktop table or mobile rows). */
export const parseWizardSellerLines = (card: ParentNode): WizardArticle[] => {
  const byId = new Map<string, WizardArticle>();

  card.querySelectorAll<HTMLTableRowElement>('table tbody tr').forEach(tr => {
    const id =
      tr.querySelector<HTMLInputElement>('input[data-id-article]')?.dataset.idArticle?.trim() ||
      tr
        .querySelector<HTMLInputElement>('input[name^="checkboxArticle["]')
        ?.name.match(/checkboxArticle\[(\d+)\]/)?.[1];
    if (!id) return;
    const name =
      tr.querySelector('.card-name')?.textContent?.replace(/\s+/g, ' ').trim() ||
      tr.querySelector('a[href*="/Products/"]')?.textContent?.replace(/\s+/g, ' ').trim() ||
      undefined;
    let unitPrice: number | undefined;
    for (const td of tr.querySelectorAll('td')) {
      const v = euroValue(td.textContent ?? '');
      if (v != null && v > 0) {
        unitPrice = v;
        break;
      }
    }
    const qtyText = tr.querySelectorAll('td')[2]?.textContent?.trim() ?? '1';
    const amount = Number.parseInt(qtyText.replace(/[^\d]/g, ''), 10);
    byId.set(id, {
      articleId: id,
      amount: Number.isFinite(amount) && amount > 0 ? amount : 1,
      name,
      unitPrice,
      ...metaOfRow(tr),
    });
  });

  // Mobile rows: name="articleRowMobile[id]"
  card.querySelectorAll<HTMLElement>('[name^="articleRowMobile["]').forEach(row => {
    const id = row.getAttribute('name')?.match(/articleRowMobile\[(\d+)\]/)?.[1];
    if (!id || byId.has(id)) return;
    // Layout: checkbox | 1x | name | price
    const texts = [...row.querySelectorAll('span')].map(s =>
      (s.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
    const qty = texts.find(t => /^\d+x$/i.test(t));
    const price = texts.find(t => EURO_RE.test(t));
    const name = texts.find(
      t => t && t !== qty && t !== price && !/^toggle/i.test(t) && t.length > 2,
    );
    byId.set(id, {
      articleId: id,
      amount: qty ? Number.parseInt(qty, 10) || 1 : 1,
      name,
      unitPrice: price ? euroValue(price) : undefined,
      ...metaOfRow(row),
    });
  });

  if (byId.size > 0) return [...byId.values()];

  const form = card.querySelector(`form[data-ajax-action="${ADD_ALL_ACTION}"]`);
  return form ? parseWizardArticlesFromForm(form) : [];
};

const dlEuro = (root: ParentNode, label: RegExp): number | undefined => {
  for (const dt of root.querySelectorAll('dt')) {
    if (!label.test(dt.textContent ?? '')) continue;
    const dd = dt.nextElementSibling;
    if (dd?.tagName === 'DD') return euroValue(dd.textContent ?? '');
  }
  return undefined;
};

const dlInt = (root: ParentNode, label: RegExp): number | undefined => {
  for (const dt of root.querySelectorAll('dt')) {
    if (!label.test(dt.textContent ?? '')) continue;
    const dd = dt.nextElementSibling;
    if (dd?.tagName !== 'DD') continue;
    const n = Number.parseInt((dd.textContent ?? '').replace(/[^\d]/g, ''), 10);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};

/** Parse a Shopping Wizard Results Summary HTML document. */
export const parseWizardResultsHtml = (html: string, resultsUrl: string): WizardResults | null => {
  const payload = extractWizardAddAllPayload(html);
  if (!payload || payload.articles.length === 0) return null;

  const sellers: WizardSellerBlock[] = [];
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('.detailed-result-card').forEach(card => {
      const link = card.querySelector<HTMLAnchorElement>('a[href*="/Users/"]');
      sellers.push({
        name: link?.textContent?.trim() ?? 'Seller',
        url: link?.getAttribute('href') ?? undefined,
        articles: parseWizardSellerLines(card),
        articlesValue: dlEuro(card, /Articles Value/i),
        shippingCost: dlEuro(card, /Shipping Cost/i),
        total: dlEuro(card, /^Total$/i),
      });
    });
    // Opportunistically capture set sprites so grid cells can show edition icons.
    expansionIconStore.captureFrom(doc);
    const summary = doc.querySelector('#ShoppingWizardResult');
    if (summary) {
      return {
        ...payload,
        sellers,
        wantedArticles: dlInt(summary, /Wanted Articles/i),
        articlesValue: dlEuro(summary, /Articles Value/i),
        shippingCost: dlEuro(summary, /Shipping Cost/i),
        shipments: dlInt(summary, /Shipments/i),
        total: dlEuro(summary, /^Total$/i),
        resultsUrl,
      };
    }
  }

  const wantedArticles = Number.parseInt(
    html.match(/Wanted Articles[\s\S]*?<dd[^>]*>\s*(\d+)/i)?.[1] ?? '',
    10,
  );
  const shipments = Number.parseInt(
    html.match(/>\s*Shipments\s*<[\s\S]*?<dd[^>]*>\s*(\d+)/i)?.[1] ?? '',
    10,
  );
  return {
    ...payload,
    sellers,
    wantedArticles: Number.isFinite(wantedArticles) ? wantedArticles : undefined,
    articlesValue: euroValue(html.match(/Articles Value[\s\S]*?<dd[^>]*>\s*([^<]+)/i)?.[1] ?? ''),
    shippingCost: euroValue(html.match(/Shipping Cost[\s\S]*?<dd[^>]*>\s*([^<]+)/i)?.[1] ?? ''),
    shipments: Number.isFinite(shipments) ? shipments : undefined,
    total: euroValue(
      html.match(/<dt[^>]*>[\s\S]*?>\s*Total\s*<[\s\S]*?<dd[^>]*>\s*([^<]+)/i)?.[1] ?? '',
    ),
    resultsUrl,
  };
};

interface WizardPageMeta {
  progressAction: string | null;
  progressFields: Array<[string, string]>;
  token: string | null;
  strategy: string;
  sellerReputation: string;
  maxShippingTime: string;
}

/** Read ProgressForm + filter defaults from the Shopping Wizard setup page. */
export const parseWizardSetupHtml = (html: string): WizardPageMeta => {
  if (typeof DOMParser === 'undefined') {
    return {
      progressAction:
        html.match(/id=["']ProgressForm["'][^>]*data-ajax-action=["']([^"']+)["']/i)?.[1] ??
        html.match(/data-ajax-action=["']([^"']+)["'][^>]*id=["']ProgressForm["']/i)?.[1] ??
        null,
      progressFields: [],
      token: html.match(/name=["']__cmtkn["'][^>]*value=["']([^"']+)["']/i)?.[1] ?? null,
      strategy: DEFAULT_WIZARD_STRATEGY,
      sellerReputation: DEFAULT_SELLER_REPUTATION,
      maxShippingTime: DEFAULT_MAX_SHIPPING_TIME,
    };
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const token =
    doc.querySelector<HTMLInputElement>('input[name="__cmtkn"]')?.value?.trim() || null;
  const progress = doc.querySelector<HTMLFormElement>('#ProgressForm');
  const progressAction = progress?.dataset.ajaxAction?.trim() || null;
  const progressFields: Array<[string, string]> = [];
  progress?.querySelectorAll<HTMLInputElement>('input[name]').forEach(input => {
    if (input.type === 'submit' || input.type === 'button') return;
    progressFields.push([input.name, input.value ?? '']);
  });

  const checkedStrategy =
    doc.querySelector<HTMLInputElement>('input[name="strategy"]:checked')?.value ??
    doc.querySelector<HTMLInputElement>('input[name="strategy"]')?.value;
  const reputation =
    doc.querySelector<HTMLInputElement>('input[name="sellerReputation"]:checked')?.value ??
    doc.querySelector<HTMLSelectElement>('select[name="sellerReputation"]')?.value;
  const shipTime =
    doc.querySelector<HTMLInputElement>('input[name="maxShippingTime"]:checked')?.value ??
    doc.querySelector<HTMLSelectElement>('select[name="maxShippingTime"]')?.value;

  return {
    progressAction,
    progressFields,
    token,
    strategy: checkedStrategy?.trim() || DEFAULT_WIZARD_STRATEGY,
    sellerReputation: reputation?.trim() || DEFAULT_SELLER_REPUTATION,
    maxShippingTime: shipTime?.trim() || DEFAULT_MAX_SHIPPING_TIME,
  };
};

const ajaxInt = (xml: string, tag: string): number | undefined => {
  const raw = ajaxBox(xml, tag).trim();
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
};

const ajaxResultCode = (xml: string): string =>
  ajaxBox(xml, 'resultsCode').trim() || ajaxBox(xml, 'resultCode').trim();

/**
 * Open the wizard for a list (session warm-up), start calculation, poll until
 * Results, return the parsed summary.
 */
export const runShoppingWizard = async (opts: WizardRunOptions): Promise<WizardResults> => {
  const lang = currentLang();
  const setupUrl = `/${lang}/Magic/Wants/ShoppingWizard?idWantsList=${encodeURIComponent(opts.idWantsList)}`;
  const setup = await fetchDoc(setupUrl, opts.signal);
  const meta = parseWizardSetupHtml(setup.html);
  const token = opts.token || meta.token;
  if (!token) throw new Error('No Cardmarket session token for Shopping Wizard');

  const strategy = opts.strategy ?? meta.strategy;
  const args = buildStartCalculationArgs(token, {
    idWantsList: opts.idWantsList,
    sellerCountry: opts.sellerCountry,
    sellerReputation: opts.sellerReputation ?? meta.sellerReputation,
    maxShippingTime: opts.maxShippingTime ?? meta.maxShippingTime,
    strategy,
  });

  const startRes = await replayInPage(
    {
      body: `args=${args}`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      method: 'POST',
      url: `/${lang}/Magic/AjaxAction`,
    },
    60_000,
  );

  if (looksLikeChallenge(startRes.body) || isChallengeResponse(startRes.status, startRes.body)) {
    throw new Error('CHALLENGE: asked on Shopping Wizard start');
  }
  if (!startRes.ok) throw new Error(`Wizard start failed (HTTP ${startRes.status})`);

  const startCode = ajaxResultCode(startRes.body);
  if (startCode && startCode !== '1' && !/^success$/i.test(startCode)) {
    const msg =
      ajaxBox(startRes.body, 'systemMessage').replace(/<[^>]+>/g, ' ').trim() ||
      `Wizard refused (code ${startCode})`;
    throw new Error(msg);
  }

  let redirectTo =
    ajaxBox(startRes.body, 'redirectTo').trim() ||
    startRes.url?.match(/\/Wants\/ShoppingWizard\/Results\/[^?#]+/)?.[0] ||
    '';

  if (!redirectTo && meta.progressAction) {
    for (let i = 0; i < PROGRESS_MAX_WAITS; i++) {
      if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const fields = new Map(meta.progressFields);
      fields.set('__cmtkn', token);
      fields.set('strategy', strategy);
      const body = new URLSearchParams([...fields.entries()].filter(([, v]) => v !== '')).toString();
      const prog = await replayInPage({
        body,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        },
        method: 'POST',
        url: `/${lang}/Magic/AjaxAction/${meta.progressAction}`,
      });
      if (looksLikeChallenge(prog.body)) throw new Error('CHALLENGE: asked on Wizard progress');
      const pct = ajaxInt(prog.body, 'progress') ?? 0;
      opts.onProgress?.(pct);
      redirectTo = ajaxBox(prog.body, 'redirectTo').trim();
      if (pct >= 100 && redirectTo) break;
      if (pct >= 100 && prog.url?.includes('/Results/')) {
        redirectTo = prog.url;
        break;
      }
      await sleep(PROGRESS_POLL_MS);
    }
  }

  if (!redirectTo) {
    throw new Error('Shopping Wizard finished without a results URL');
  }

  const resultsPath = redirectTo.startsWith('http')
    ? new URL(redirectTo).pathname + new URL(redirectTo).search
    : redirectTo.startsWith('/')
      ? redirectTo
      : `/${lang}/Magic/Wants/ShoppingWizard/Results/${redirectTo}`;

  const resultsPage = await fetchDoc(resultsPath, opts.signal);
  const parsed = parseWizardResultsHtml(resultsPage.html, resultsPage.url ?? resultsPath);
  if (!parsed || parsed.articles.length === 0) {
    throw new Error('Could not parse Shopping Wizard results');
  }
  return parsed;
};

/** POST Wantslist_ShoppingWizard_AddArticlesToCart for every article in a result. */
export const addWizardArticlesToCart = async (
  results: WizardResults,
  token: string,
): Promise<WizardAddResult> => {
  const lang = currentLang();
  const fields: Array<[string, string]> = [
    ['__cmtkn', token || results.token],
    ['idCalculation', results.idCalculation],
  ];
  for (const a of results.articles) {
    fields.push([`idArticle[${a.articleId}]`, '1']);
    fields.push([`amount[${a.articleId}]`, String(a.amount)]);
  }
  fields.push(['redirect', 'true']);

  const res = await replayInPage({
    body: new URLSearchParams(fields).toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
    },
    method: 'POST',
    url: `/${lang}/Magic/AjaxAction/${ADD_ALL_ACTION}`,
  });

  if (looksLikeChallenge(res.body)) throw new Error('CHALLENGE: asked on Wizard add-to-cart');
  if (!res.ok) return { message: `Failed (HTTP ${res.status})`, ok: false };

  const resultType = ajaxBox(res.body, 'resultType').trim().toLowerCase();
  const sys = ajaxBox(res.body, 'systemMessage');
  const heading =
    sys.match(/alert-heading[^>]*>\s*([^<]+)/i)?.[1]?.trim() ||
    sys.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (/error/i.test(resultType) || /alert-danger/i.test(sys)) {
    return { message: heading || 'Add All refused', ok: false };
  }
  return {
    message: heading || `Added ${results.articles.length} articles to cart`,
    ok: true,
  };
};

/** Full path: run wizard for a want list and dump every suggested article into the cart. */
export const runWizardIntoCart = async (
  opts: WizardRunOptions,
): Promise<WizardIntoCartResult> => {
  const results = await runShoppingWizard(opts);
  const add = await addWizardArticlesToCart(results, opts.token || results.token);
  return { add, results };
};
