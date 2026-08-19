// What Lugin fills in when it adds a want.
//
// `Wantslist_AddWant` carries a minimum condition, a maximum price and a language
// restriction. Lugin sent the first and hardcoded the other two to "any", so a
// want added through the overlay quietly lost two of the three preferences the
// site's own form offers — and there was nowhere to state them.
//
// It also disagreed with itself: the bulk "add missing cards" task asked for
// condition 2 while a single add from an offer row asked for 5, so the same card
// landed with a different floor depending on which button you pressed. One stored
// answer, read by both, is the actual fix.
//
// `localStorage` rather than `chrome.storage`, and no expiry: unlike a filter,
// "I only buy Near Mint" is a standing preference, and the callers that need it
// are synchronous.

/** Cardmarket's condition scale, in the site's own 1–7 order. */
export const CONDITIONS: readonly { id: number; label: string; short: string }[] = [
  { id: 1, label: 'Mint', short: 'MT' },
  { id: 2, label: 'Near Mint', short: 'NM' },
  { id: 3, label: 'Excellent', short: 'EX' },
  { id: 4, label: 'Good', short: 'GD' },
  { id: 5, label: 'Light Played', short: 'LP' },
  { id: 6, label: 'Played', short: 'PL' },
  { id: 7, label: 'Poor', short: 'PO' },
];

export interface WantDefaults {
  /**
   * Cardmarket language ids to restrict to; empty means any language.
   *
   * Ids are not hardcoded anywhere — they are read off the site's own language
   * picker when one is on the page (see `languageOptionsFromPage`), because a
   * guessed id would silently produce a want filtered to the wrong language, and
   * nothing about the resulting list would look wrong.
   */
  languages: number[];
  /** 1–7; the *worst* condition still acceptable. Lower is stricter. */
  minCondition: number;
  /** Most you'd pay per copy, in the account's currency. Undefined means no cap. */
  wishPrice?: number;
}

/**
 * Light Played, which is what Cardmarket's own add-want form sends.
 *
 * Deliberately the site's default rather than the stricter 2 the bulk task used:
 * a want that silently ignores most of the market is the more confusing of the two
 * failures, and the point of this module is that the choice is now visible.
 */
export const DEFAULT_WANT_DEFAULTS: WantDefaults = { languages: [], minCondition: 5 };

const KEY = 'lugin:wantDefaults';

export const readWantDefaults = (): WantDefaults => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_WANT_DEFAULTS;
    const held = JSON.parse(raw) as Partial<WantDefaults>;
    const minCondition =
      typeof held.minCondition === 'number' && held.minCondition >= 1 && held.minCondition <= 7
        ? Math.round(held.minCondition)
        : DEFAULT_WANT_DEFAULTS.minCondition;
    const wishPrice =
      typeof held.wishPrice === 'number' && Number.isFinite(held.wishPrice) && held.wishPrice > 0
        ? held.wishPrice
        : undefined;
    return {
      languages: Array.isArray(held.languages)
        ? held.languages.filter((n): n is number => Number.isInteger(n) && n > 0)
        : [],
      minCondition,
      ...(wishPrice === undefined ? {} : { wishPrice }),
    };
  } catch {
    return DEFAULT_WANT_DEFAULTS;
  }
};

export const writeWantDefaults = (value: WantDefaults): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // ignore storage failures
  }
};

/**
 * Language id → name, read from whatever language picker the current page has.
 *
 * Cardmarket's want forms render a `<select>` whose option values are the ids the
 * POST expects, so the page is the one authority that cannot be out of date.
 * Returns an empty map when no picker is present, which is most pages — the
 * language restriction is then simply not offered rather than guessed at.
 */
export const languageOptionsFromPage = (doc: ParentNode = document): Map<number, string> => {
  const out = new Map<number, string>();
  const selects = doc.querySelectorAll<HTMLSelectElement>(
    'select[name*="idLanguage" i], select[id*="idLanguage" i], select[name*="Language" i]',
  );
  for (const select of selects) {
    for (const option of select.options) {
      const id = Number.parseInt(option.value, 10);
      const label = option.textContent?.trim();
      if (!Number.isInteger(id) || id <= 0 || !label) continue;
      if (!out.has(id)) out.set(id, label);
    }
    if (out.size) break;
  }
  return out;
};
