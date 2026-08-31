// Cardmarket's "filter this seller's stock" form, as data rather than DOM.
//
// A seller's Singles page filters server-side through one POST:
//
//   POST /<lang>/Magic/PostGetAction/User_Account_Filter_FilterUserInventory
//   __cmtkn=…&userInventoryFilterMode=&idUser=…&idSeller=…&category=1&name=
//     &idExpansion=5809&idRarity=0&condition=7&idLanguage=0&comments=
//     &minPrice=&maxPrice=&minAmt=0&isFoil=0&isSigned=0&isAltered=0
//     &sortBy=name_asc&apply=
//
// It answers 302 back to the stock list, which then shows only that expansion.
// Two details decide whether it works at all, and both cost an afternoon to
// rediscover: the expansion field is **singular** (`idExpansion`, one edition
// per request — several editions means several requests), and the value comes
// from the page's own `<select name="idExpansion">`, whose ids are Cardmarket's,
// unrelated to Scryfall set codes.
//
// The DOM reading lives in wants.ts; everything here is plain data so it can be
// tested without a browser.

/** One entry of the seller's edition dropdown. */
export interface ExpansionFilterOption {
  /** Singles the seller lists from it, from the "(N)" in the option text. */
  count?: number;
  id: number;
  label: string;
}

/** A `<option>` as read off the page. */
export interface RawFilterOption {
  label: string;
  value: string;
}

/** Name/value pairs for the filter POST, in form order. */
export type SellerInventoryFilterFields = [string, string][];

export const FILTER_USER_INVENTORY_PATH =
  '/Magic/PostGetAction/User_Account_Filter_FilterUserInventory';

/** The seller filter's expansion control, singular unless the page multi-selects. */
export const EXPANSION_FIELD = 'idExpansion';
export const EXPANSION_FIELD_MULTI = 'idExpansions[]';

/** Fields we set ourselves, so copies read off the page are dropped. */
export const FILTER_OWN_FIELDS: ReadonlySet<string> = new Set([
  '__cmtkn',
  'apply',
  EXPANSION_FIELD,
  EXPANSION_FIELD_MULTI,
]);

/** What Cardmarket's own filter sends for a control left untouched. */
export const FILTER_DEFAULTS: SellerInventoryFilterFields = [
  ['category', '1'],
  ['condition', '7'],
  ['idLanguage', '0'],
  ['idRarity', '0'],
  ['isAltered', '0'],
  ['isFoil', '0'],
  ['isSigned', '0'],
  ['minAmt', '0'],
  ['sortBy', 'name_asc'],
  ['userInventoryFilterMode', ''],
];

/** Everything needed to submit the filter, as the page's React props state it. */
export interface FilterComponentProps {
  /** Where to POST, language prefix included: `/en/Magic/PostGetAction/…`. */
  action: string;
  /** The seller's editions, straight from the component's own option list. */
  expansionOptions: ExpansionFilterOption[];
  /** Which expansion the page is currently filtered to, as the props state it. */
  expansionValue?: number;
  /** Form fields, empty controls resolved to what Cardmarket defaults them to. */
  fields: SellerInventoryFilterFields;
  /** The `__cmtkn` this form was rendered with. */
  token?: string;
}

interface RawProps {
  action?: string;
  csrftoken?: string;
  idCategory?: number | string;
  idSeller?: number | string;
  idUser?: number | string;
  inputs?: { name?: string; value?: unknown }[];
  options?: { expansionOptions?: RawFilterOption[] };
}

const ENTITIES: Record<string, string> = {
  '&#039;': '\u0027',
  '&#39;': '\u0027',
  '&amp;': '&',
  '&apos;': '\u0027',
  '&gt;': '>',
  '&lt;': '<',
  '&quot;': '\u0022',
};

const decodeEntities = (text: string): string =>
  text.replace(/&(?:#0?39|#039|quot|apos|amp|lt|gt);/g, m => ENTITIES[m] ?? m);

const defaultFor = (name: string): string | undefined =>
  FILTER_DEFAULTS.find(([n]) => n === name)?.[1];

/**
 * The filter as its React component was handed it.
 *
 * Cardmarket renders the stock filter from a `data-props` blob on
 * `[data-component-name="CategoryOffersFilterComponent"]`, and that blob states
 * the POST target, the CSRF token, `idUser`/`idSeller`, every field with its
 * value, and the seller's expansion list. Reading it beats scraping the form it
 * builds: the form sits inside a hidden wrapper the page clones into a modal, so
 * whether its controls are in the document at all depends on viewport and markup
 * we don't control — while the props are always there, in one place.
 *
 * A stock page carries two of these (stock filter, wants filter); the caller
 * wants the one that lists expansions.
 */
export const parseFilterComponentProps = (html: string): FilterComponentProps[] => {
  const out: FilterComponentProps[] = [];
  for (const m of html.matchAll(/data-props="([^"]*)"/g)) {
    let raw: RawProps;
    try {
      raw = JSON.parse(decodeEntities(m[1])) as RawProps;
    } catch {
      continue;
    }
    if (!raw?.action?.includes('FilterUserInventory')) continue;

    const fields: SellerInventoryFilterFields = [];
    const push = (name: string, value: string | number | undefined) => {
      if (value == null || value === '') return;
      fields.push([name, String(value)]);
    };
    push('idUser', raw.idUser);
    push('idSeller', raw.idSeller);
    push('category', raw.idCategory);
    let expansionValue: number | undefined;
    for (const input of raw.inputs ?? []) {
      if (!input?.name) continue;
      if (FILTER_OWN_FIELDS.has(input.name)) {
        if (input.name === EXPANSION_FIELD) {
          const n = Number.parseInt(String(input.value ?? ''), 10);
          if (Number.isFinite(n)) expansionValue = n;
        }
        continue;
      }
      const value = input.value == null ? '' : String(input.value);
      // An untouched control arrives empty here but is submitted as whatever the
      // rendered form shows — `condition` empty means Poor (7), i.e. any.
      fields.push([input.name, value === '' ? (defaultFor(input.name) ?? '') : value]);
    }
    out.push({
      action: raw.action,
      expansionOptions: expansionOptionsFrom(raw.options?.expansionOptions ?? []),
      expansionValue,
      fields: withFilterDefaults([['userInventoryFilterMode', ''], ...fields]),
      token: raw.csrftoken,
    });
  }
  return out;
};

/** Of a page's filter components, the one driving the stock list. */
export const stockFilterProps = (
  components: readonly FilterComponentProps[],
): FilterComponentProps | undefined =>
  [...components].sort((a, b) => b.expansionOptions.length - a.expansionOptions.length)[0];

/**
 * `idUser` / `idSeller` from a seller's page, however that page spells them.
 *
 * The pair identifies whose stock is being filtered, and the filter panel is the
 * only place that states it — sometimes as hidden inputs, sometimes as data
 * attributes, sometimes only in an inline script. Guessing wrong used to mean
 * the request was never sent at all, so this tries every shape we've seen.
 */
export const inventoryIdsFromHtml = (html: string): { idSeller?: string; idUser?: string } => {
  const find = (...names: string[]): string | undefined => {
    for (const name of names) {
      const patterns = [
        // <input name="idUser" value="1454828"> and the reverse attribute order.
        `<input[^>]*\\bname=["']?${name}["']?[^>]*\\bvalue=["']?(\\d{3,})`,
        `<input[^>]*\\bvalue=["']?(\\d{3,})["']?[^>]*\\bname=["']?${name}["']?`,
        // data-id-user="1454828", "idUser": "1454828", idUser: 1454828, idUser=1454828
        `\\b${name}\\b["']?\\s*[:=]\\s*["']?(\\d{3,})`,
      ];
      for (const source of patterns) {
        const m = html.match(new RegExp(source, 'i'));
        if (m) return m[1];
      }
    }
    return undefined;
  };
  return {
    idSeller: find('idSeller', 'id-seller', 'id_seller', 'sellerId', 'seller-id', 'seller_id'),
    idUser: find('idUser', 'id-user', 'id_user', 'userId', 'user-id', 'user_id'),
  };
};

/**
 * Whether two URLs name the same page, ignoring query and trailing slash.
 *
 * Tells one seller's stock page from another's — their names are in the path —
 * which is what decides whether the open tab may be read as the stock page whose
 * filter we're building.
 */
export const samePagePath = (a: string, b: string, origin: string): boolean => {
  try {
    const path = (url: string) => new URL(url, origin).pathname.replace(/\/+$/, '');
    return path(a) === path(b);
  } catch {
    return false;
  }
};

/** "All" and its translations — the dropdown's no-filter entry, not an edition. */
const ANY_OPTION = /^(all|alle|any|tous|toutes|todos|tutti|tutte)$/i;
/** Trailing stock count: "Duskmourn: House of Horror: Extras (16)". */
const OPTION_COUNT = /^(.*\S)\s*\(\s*([\d.,\s]+)\s*\)\s*$/;

const countFrom = (text: string): number | undefined => {
  const n = Number.parseInt(text.replace(/[.,\s]/g, ''), 10);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * The seller's editions, from their dropdown.
 *
 * Options with a zero count are kept: Cardmarket lists them, so hiding them
 * would make our picker disagree with the page it mirrors.
 */
export const expansionOptionsFrom = (
  raw: readonly RawFilterOption[],
): ExpansionFilterOption[] => {
  const out: ExpansionFilterOption[] = [];
  const seen = new Set<number>();
  for (const { label, value } of raw) {
    const id = Number.parseInt(value, 10);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
    const text = label.replace(/\s+/g, ' ').trim();
    if (!text || ANY_OPTION.test(text)) continue;
    seen.add(id);
    const m = text.match(OPTION_COUNT);
    if (m) out.push({ count: countFrom(m[2]), id, label: m[1] });
    else out.push({ id, label: text });
  }
  return out;
};

/** Fill in the fields a page didn't render, without touching the ones it did. */
export const withFilterDefaults = (
  fields: SellerInventoryFilterFields,
): SellerInventoryFilterFields => {
  const names = new Set(fields.map(([name]) => name));
  return [...fields, ...FILTER_DEFAULTS.filter(([name]) => !names.has(name))];
};

/**
 * The filter POST body.
 *
 * `idExpansions` is a list only so callers don't special-case one edition; with
 * the singular field, anything past the first is the caller's to fetch
 * separately. An empty list sends `idExpansion=0`, which is "All" — how the
 * dropdown clears a filter.
 */
export const sellerInventoryFilterBody = (opts: {
  expansionField?: string;
  fields: SellerInventoryFilterFields;
  idExpansions: readonly number[];
  token: string;
}): string => {
  const field = opts.expansionField ?? EXPANSION_FIELD;
  const ids = opts.idExpansions.filter(id => Number.isFinite(id) && id > 0);
  const body: SellerInventoryFilterFields = [['__cmtkn', opts.token]];
  for (const [name, value] of opts.fields) {
    if (!FILTER_OWN_FIELDS.has(name)) body.push([name, value]);
  }
  if (field === EXPANSION_FIELD_MULTI) {
    for (const id of ids) body.push([field, String(id)]);
    if (ids.length === 0) body.push([field, '0']);
  } else {
    body.push([field, String(ids[0] ?? 0)]);
  }
  body.push(['apply', '']);
  return new URLSearchParams(body).toString();
};

const normalizeLabel = (label: string): string =>
  label
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Match edition names to the dropdown's ids.
 *
 * Names come from our own picker, which prefers Scryfall's spelling, so the
 * comparison ignores punctuation and case. Anything unmatched is returned rather
 * than dropped, because the caller has to tell the user which pick it couldn't
 * honour.
 */
export const matchExpansionIds = (
  labels: readonly string[],
  options: readonly ExpansionFilterOption[],
): { ids: number[]; missing: string[] } => {
  const byLabel = new Map<string, number>();
  for (const opt of options) {
    const key = normalizeLabel(opt.label);
    if (key && !byLabel.has(key)) byLabel.set(key, opt.id);
  }
  const ids: number[] = [];
  const missing: string[] = [];
  for (const label of labels) {
    const id = byLabel.get(normalizeLabel(label));
    if (id == null) missing.push(label);
    else if (!ids.includes(id)) ids.push(id);
  }
  return { ids, missing };
};
