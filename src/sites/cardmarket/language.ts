// Reading the language off a Cardmarket offer row.
//
// Cardmarket prints the language as a flag image with no text, so the only thing
// to read is the `aria-label`. That makes the language *harder* to extract than
// the price, which is why the offer parsers historically skipped it — and why the
// condition/language breakdown people ask for could never be built.
//
// Shared between the two row parsers (`adapter.ts` for the page in front of you,
// `wants.ts` for a fetched seller page) because they were about to disagree about
// what counts as a language, and a list of eighteen strings duplicated across two
// files is a list that drifts.

/**
 * Languages Cardmarket exposes as a flag icon, spelled as it spells them.
 *
 * Matched exactly rather than sniffed, because the selector that finds these also
 * matches every other decorated icon in the row: foil, signed, altered, first
 * edition. Without a closed set, "Signed" becomes a language.
 */
export const KNOWN_LANGUAGES: ReadonlySet<string> = new Set([
  'English',
  'French',
  'German',
  'Italian',
  'Spanish',
  'Portuguese',
  'Japanese',
  'Simplified Chinese',
  'Traditional Chinese',
  'Chinese',
  'Korean',
  'Russian',
  'Dutch',
  'Polish',
  'Czech',
  'Hungarian',
  'Other',
]);

/**
 * Language display names — English *and* native — that must never be read as a
 * card name.
 *
 * Some rows expose a language label whose text is the native name, and without
 * this "Español" gets harvested as a card and sent to Scryfall.
 */
export const LANGUAGE_NAMES: ReadonlySet<string> = new Set(
  [
    ...KNOWN_LANGUAGES,
    'Français',
    'Deutsch',
    'Español',
    'Italiano',
    'Português',
    'Nederlands',
    'Polski',
    'Русский',
    '日本語',
    '简体中文',
    '繁體中文',
    '中文',
    '한국어',
    'Čeština',
    'Magyar',
  ].map(s => s.toLowerCase()),
);

export const isLanguageName = (name: string): boolean =>
  LANGUAGE_NAMES.has(name.trim().toLowerCase());

/**
 * The offer's language, or undefined if the row doesn't say.
 *
 * Searches the whole row rather than a specific attribute container: the markup
 * differs between a product page, a seller's stock list and a want-list view, and
 * the closed set above is what makes a broad search safe.
 */
export const languageOfRow = (row: Element): string | undefined => {
  for (const el of row.querySelectorAll('[aria-label]')) {
    const label = el.getAttribute('aria-label')?.trim() ?? '';
    if (KNOWN_LANGUAGES.has(label)) return label;
  }
  // Older rows put it in the tooltip attribute instead of aria-label.
  for (const el of row.querySelectorAll('[data-bs-original-title], [data-original-title]')) {
    const label = (
      el.getAttribute('data-bs-original-title') ??
      el.getAttribute('data-original-title') ??
      ''
    ).trim();
    if (KNOWN_LANGUAGES.has(label)) return label;
  }
  return undefined;
};
