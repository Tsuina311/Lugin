/**
 * When each expansion came out, and how to recognise one across two catalogues.
 *
 * Cardmarket lists expansions alphabetically, which puts "Alliances" next to
 * "Alchemy Horizons" and tells you nothing about either. Sorted by release date
 * the same list reads as a history of the game, so this module turns whatever
 * spelling a row happens to carry into a set with a date, and groups those into
 * years.
 *
 * The catalogue itself is Scryfall's — see `src/background/sets.ts`. Everything
 * here is pure, so the matching rules can be tested against the real spellings
 * that caused trouble.
 */

export interface SetInfo {
  /** Scryfall's set code, lowercase. */
  code: string;
  name: string;
  /** ISO date, e.g. "2012-10-05". Absent for sets with no announced date. */
  releasedAt?: string;
}

export interface SetIndex {
  byCode: ReadonlyMap<string, SetInfo>;
  byName: ReadonlyMap<string, SetInfo>;
}

export const EMPTY_SET_INDEX: SetIndex = { byCode: new Map(), byName: new Map() };

/**
 * Fold a set's name to something three catalogues can agree on: no accents, no
 * punctuation, no case. "Innistrad: Crimson Vow" and "Innistrad Crimson Vow"
 * are the same set written by two different people.
 *
 * Also the key `expansionIconStore` files its sprites under, which is why it
 * lives in this dependency-free module rather than beside either use.
 */
export const normalizeSetName = (name: string): string =>
  name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Cardmarket sells the odds and ends of a set as their own expansion, named for
 * the parent with a suffix. Scryfall either files them under the parent or gives
 * them a code of their own, so a row from "Time Spiral Remastered: Extras" needs
 * a second attempt as plain "Time Spiral Remastered" before we give up on it.
 */
const PARENT_SUFFIXES = [
  'extras',
  'tokens',
  'promos',
  'art series',
  'minigames',
  'substitute cards',
  'variants',
];

/** Cardmarket labels the crossover sets; Scryfall names them plainly. */
const DROPPED_PREFIXES = ['universes beyond'];

/** Where Cardmarket splits one Scryfall set into many, all of them lead back. */
const PREFIX_ALIASES: readonly (readonly [string, string])[] = [
  ['secret lair drop series', 'secret lair drop'],
];

/**
 * Sets Cardmarket simply calls something else. Almost all of them are the early
 * printings — which, being the expensive ones, are exactly the sets you would
 * want to filter down to.
 */
const ALIASES: Record<string, string> = {
  alpha: 'limited edition alpha',
  beta: 'limited edition beta',
  revised: 'revised edition',
  unlimited: 'unlimited edition',
};

const withoutSuffix = (normalized: string): string | undefined => {
  for (const suffix of PARENT_SUFFIXES) {
    if (normalized.endsWith(` ${suffix}`)) return normalized.slice(0, -(suffix.length + 1));
  }
  return undefined;
};

const withoutPrefix = (normalized: string): string | undefined => {
  for (const prefix of DROPPED_PREFIXES) {
    if (normalized.startsWith(`${prefix} `)) return normalized.slice(prefix.length + 1);
  }
  return undefined;
};

/** "guilds of ravnica guild kits" -> "…kit", for Cardmarket's stray plurals. */
const singular = (normalized: string): string | undefined =>
  /[a-z]{3}s$/.test(normalized) ? normalized.slice(0, -1) : undefined;

/**
 * Every spelling of a name worth trying, best first.
 *
 * Ordered, and the order matters: the name as written always wins, because some
 * genuine set names end in "Promos" or begin with a word we would otherwise
 * strip. The looser rules only get a turn once the exact name has missed.
 */
const candidateNames = (normalized: string): string[] => {
  const out: string[] = [];
  const add = (name: string | undefined) => {
    if (name && !out.includes(name)) out.push(name);
  };

  // Both the name and its de-prefixed form go through the same rules, so
  // "Universes Beyond: Fallout: Extras" is reachable from either end.
  for (const base of [normalized, withoutPrefix(normalized)]) {
    if (!base) continue;
    add(base);
    add(ALIASES[base]);
    for (const [prefix, target] of PREFIX_ALIASES) {
      if (base.startsWith(prefix)) add(target);
    }
    add(withoutSuffix(base));
    add(singular(base));
  }
  return out;
};

export const buildSetIndex = (sets: readonly SetInfo[]): SetIndex => {
  const byCode = new Map<string, SetInfo>();
  const byName = new Map<string, SetInfo>();
  for (const set of sets) {
    const code = set.code.trim().toLowerCase();
    if (code) byCode.set(code, set);
    const name = normalizeSetName(set.name);
    // First writer wins: Scryfall lists a parent set before its offshoots, and
    // the parent is the one a bare name should resolve to.
    if (name && !byName.has(name)) byName.set(name, set);
  }
  return { byCode, byName };
};

/** Anything that names a printing's expansion, however partially. */
export interface EditionRow {
  setCode?: string;
  setName?: string;
}

/**
 * Find the set a row belongs to.
 *
 * Set code first — collection rows imported from ManaBox carry Scryfall's own
 * code, which cannot be wrong. Rows read off Cardmarket only have a display
 * name, so those fall through to the name rules.
 */
export const resolveSet = (index: SetIndex, row: EditionRow): SetInfo | undefined => {
  const code = row.setCode?.trim().toLowerCase();
  if (code) {
    const found = index.byCode.get(code);
    if (found) return found;
  }
  const name = row.setName?.trim();
  if (!name) return undefined;
  for (const candidate of candidateNames(normalizeSetName(name))) {
    const found = index.byName.get(candidate);
    if (found) return found;
  }
  return undefined;
};

/**
 * What to group a row under.
 *
 * The resolved set code when we know it, so a card bought from "Time Spiral
 * Remastered: Extras" files alongside the rest of that set instead of becoming
 * its own line. Otherwise the row's own spelling, folded — an edition we cannot
 * place is still an edition worth filtering by.
 */
export const editionIdOf = (index: SetIndex, row: EditionRow): string | undefined => {
  const set = resolveSet(index, row);
  if (set) return set.code;
  const own = normalizeSetName(row.setName ?? '') || row.setCode?.trim().toLowerCase();
  return own || undefined;
};

export interface EditionTally {
  count: number;
  /** Matches `editionIdOf`, so a filter can test a row without re-deriving it. */
  key: string;
  /** Scryfall's name once we can place the set, else whatever the row said. */
  label: string;
  releasedAt?: string;
}

/** Count the distinct editions present in a list of rows. */
export const tallyEditions = (
  rows: readonly EditionRow[],
  index: SetIndex,
): EditionTally[] => {
  const found = new Map<string, EditionTally>();
  for (const row of rows) {
    const key = editionIdOf(index, row);
    if (!key) continue;
    const existing = found.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    const set = resolveSet(index, row);
    found.set(key, {
      count: 1,
      key,
      label: set?.name ?? row.setName ?? row.setCode ?? key,
      releasedAt: set?.releasedAt,
    });
  }
  return [...found.values()];
};

export interface EditionYear {
  /** How many rows fall in this year, across all its editions. */
  count: number;
  editions: EditionTally[];
  /** null for editions we could not date. */
  year: number | null;
}

const yearOf = (releasedAt: string | undefined): number | null => {
  const year = Number(releasedAt?.slice(0, 4));
  return Number.isInteger(year) && year > 1900 ? year : null;
};

/**
 * Arrange editions into years: newest year first, because that is where the
 * cards you are looking at usually come from, and within a year newest
 * printing first too — the same direction as the year headers.
 *
 * Editions we could not date collect in a trailing `null` year rather than being
 * dropped — Cardmarket sells things Scryfall has never heard of, and hiding them
 * would quietly shorten the list the filter claims to describe.
 */
export const groupEditionsByYear = (editions: readonly EditionTally[]): EditionYear[] => {
  const years = new Map<number | null, EditionTally[]>();
  for (const edition of editions) {
    const year = yearOf(edition.releasedAt);
    const bucket = years.get(year);
    if (bucket) bucket.push(edition);
    else years.set(year, [edition]);
  }

  const out: EditionYear[] = [];
  for (const [year, bucket] of years) {
    const sorted =
      year == null
        ? [...bucket].sort((a, b) => b.label.localeCompare(a.label))
        : [...bucket].sort(
            (a, b) =>
              (b.releasedAt ?? '').localeCompare(a.releasedAt ?? '') ||
              a.label.localeCompare(b.label),
          );

    out.push({
      count: sorted.reduce((n, e) => n + e.count, 0),
      editions: sorted,
      year,
    });
  }

  return out.sort((a, b) => {
    if (a.year === b.year) return 0;
    if (a.year == null) return 1;
    if (b.year == null) return -1;
    return b.year - a.year;
  });
};
