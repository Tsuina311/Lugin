/**
 * Pure Shopping Wizard wire helpers — no DOM fetch / replay.
 * Network orchestration lives in `shoppingWizard.ts`.
 */

import { buildAjaxArgs, WIZARD_XOR_SEED } from '@/sites/cardmarket/searchArgs';

export const START_ACTION = 'Wantslist_ShoppingWizard_StartCalculation';
export const ADD_ALL_ACTION = 'Wantslist_ShoppingWizard_AddArticlesToCart';
/** Site default from a live capture — strategy radio value 4. */
export const DEFAULT_WIZARD_STRATEGY = '4';
export const DEFAULT_SELLER_REPUTATION = '5';
export const DEFAULT_MAX_SHIPPING_TIME = '7';

export interface WizardArticle {
  articleId: string;
  amount: number;
  /** Card title from the Results table, when parsed. */
  name?: string;
  unitPrice?: number;
  /** Condition badge (NM, EX, …) when the Results row exposes it. */
  condition?: string;
  /** Set / expansion name for icon lookup. */
  edition?: string;
  foil?: boolean;
  imageUrl?: string;
  language?: string;
}

/** Build StartCalculation `args` (byte-identical to a captured Next click). */
export const buildStartCalculationArgs = (
  token: string,
  opts: {
    idWantsList: string;
    sellerCountry?: string[];
    sellerReputation?: string;
    maxShippingTime?: string;
    strategy?: string;
  },
): string => {
  /* eslint-disable sort-keys-fix/sort-keys-fix -- wire order from capture */
  const json = JSON.stringify({
    __cmtkn: token,
    idWantsList: String(opts.idWantsList),
    sellerCountry: opts.sellerCountry ?? [],
    sellerReputation: opts.sellerReputation ?? DEFAULT_SELLER_REPUTATION,
    maxShippingTime: opts.maxShippingTime ?? DEFAULT_MAX_SHIPPING_TIME,
    strategy: opts.strategy ?? DEFAULT_WIZARD_STRATEGY,
  });
  /* eslint-enable sort-keys-fix/sort-keys-fix */
  return buildAjaxArgs(START_ACTION, token, json, WIZARD_XOR_SEED);
};

/**
 * Pull idCalculation + article ids from Results HTML without a DOM.
 * Prefers the summary “Add All” form inside `#ShoppingWizardResult`.
 */
export const extractWizardAddAllPayload = (
  html: string,
): { articles: WizardArticle[]; idCalculation: string; token: string } | null => {
  const summaryChunk =
    html.match(
      /id=["']ShoppingWizardResult["'][\s\S]*?<form\b[^>]*Wantslist_ShoppingWizard_AddArticlesToCart[\s\S]*?<\/form>/i,
    )?.[0] ??
    html.match(
      /<form\b[^>]*Wantslist_ShoppingWizard_AddArticlesToCart[\s\S]*?<\/form>/i,
    )?.[0];
  if (!summaryChunk) return null;

  const idCalculation =
    summaryChunk.match(/name=["']idCalculation["'][^>]*value=["']([^"']+)["']/i)?.[1]?.trim() ??
    summaryChunk.match(/value=["']([^"']+)["'][^>]*name=["']idCalculation["']/i)?.[1]?.trim() ??
    '';
  const token =
    summaryChunk.match(/name=["']__cmtkn["'][^>]*value=["']([^"']+)["']/i)?.[1]?.trim() ??
    summaryChunk.match(/value=["']([^"']+)["'][^>]*name=["']__cmtkn["']/i)?.[1]?.trim() ??
    '';
  if (!idCalculation) return null;

  const amounts = new Map<string, number>();
  for (const m of summaryChunk.matchAll(
    /name=["']amount\[(\d+)\]["'][^>]*value=["']([^"']*)["']/gi,
  )) {
    const n = Number.parseInt(m[2] || '1', 10);
    amounts.set(m[1], Number.isFinite(n) && n > 0 ? n : 1);
  }
  for (const m of summaryChunk.matchAll(
    /value=["']([^"']*)["'][^>]*name=["']amount\[(\d+)\]["']/gi,
  )) {
    if (amounts.has(m[2])) continue;
    const n = Number.parseInt(m[1] || '1', 10);
    amounts.set(m[2], Number.isFinite(n) && n > 0 ? n : 1);
  }

  const articles: WizardArticle[] = [];
  const seen = new Set<string>();
  for (const m of summaryChunk.matchAll(/name=["']idArticle\[(\d+)\]["']/gi)) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    articles.push({ articleId: id, amount: amounts.get(id) ?? 1 });
  }
  return { articles, idCalculation, token };
};
