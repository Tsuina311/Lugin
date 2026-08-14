// Turn OCR text into a ranked list of real card names.
//
// This is the step that makes scanning a *constrained identification* problem
// rather than transcription. OCR does not have to spell the name correctly; it
// only has to get close enough that the right card wins against ~30,000 others.
// "Sol Rinq" is not a card, so it costs nothing to read it that way.
//
// Two consequences shape the design:
//
// - Choosing between OCR passes and identifying the card are the *same* decision.
//   Nothing else can rank two readings of a title, because "which string is
//   longer" or "which had higher engine confidence" are both blind to whether the
//   string names a card that exists. So `matchReadings` takes every pass at once.
// - The answer is a list, not a name. A near-tie between two real cards is the
//   honest outcome for a smudged title, and the UI can offer both far more
//   usefully than it can recover from one silently wrong pick.
//
// Pure and DOM-free, like the rest of `src/lib/scan`, so the evaluation harness
// scores the same code the phone runs.

/** How many index entries survive the trigram prefilter and get scored properly. */
const RESCORE_LIMIT = 400;

/** Trigram padding, so two-letter names ("Ow") still produce grams. */
const PAD = '\u0001';

export interface NameCandidate {
  /** Language of `printedName`, when the match came from a localized title. */
  lang?: string;
  /** Canonical English (oracle) name — always what gets stored. */
  name: string;
  /** The localized title that actually matched, when it wasn't the English name. */
  printedName?: string;
  /** 0–1. Similarity to the OCR text, not a probability. */
  score: number;
  /** Which OCR reading produced this match. */
  source?: string;
}

/**
 * The shipped index, kept deliberately dull so it gzips well and parses fast.
 *
 * Localized titles point at their English name by position rather than repeating
 * it: French, German and Italian together roughly triple the entry count, and
 * storing the oracle name four times would triple the download for nothing.
 */
export interface CardNameIndexData {
  generated?: string;
  /** Canonical English names. */
  names: string[];
  /** Language code → [index into `names`, printed title]. */
  printed?: Record<string, Array<[number, string]>>;
  version: number;
}

interface Entry {
  key: string;
  lang?: string;
  /** Position in `CardNameIndexData.names`. */
  name: number;
  printed?: string;
}

export interface CardNameIndex {
  entries: Entry[];
  names: string[];
  /** Trigram → entry ids. Built once; this is what keeps a search off the full list. */
  postings: Map<string, number[]>;
}

/**
 * Strip a name down to comparable letters: accents folded, punctuation and
 * spacing dropped, lowercased.
 *
 * Punctuation is worth discarding rather than matching. Card names are full of
 * apostrophes and commas that OCR renders inconsistently or not at all, and none
 * of them distinguish one card from another.
 */
export const foldName = (raw: string): string =>
  raw
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]/gu, '');

/**
 * Fold characters OCR routinely confuses onto one representative, on both the
 * query and the index.
 *
 * Doing it symmetrically is the point: it is not an attempt to guess what the
 * engine meant, it removes a distinction that carries no information at this
 * resolution. `l`/`1`/`I` are the same handful of pixels in a title font.
 *
 * The multi-character rules come first because they are the ones that shift
 * length, and length differences are what edit distance punishes hardest —
 * `rn`→`m` alone turns "Sworn" into "Swom" on both sides instead of scoring it as
 * a deletion.
 *
 * Whether this beats plain `foldName` is a measured question, not an obvious one:
 * collapsing `u`/`v` also makes genuinely different names collide. See
 * `scan-eval.mjs --folds`.
 */
export const shapeFold = (raw: string): string =>
  foldName(raw)
    .replace(/vv/g, 'w')
    .replace(/rn/g, 'm')
    .replace(/[il1j]/g, 'i')
    .replace(/[o0]/g, 'o')
    .replace(/[s5]/g, 's')
    .replace(/[b8]/g, 'b')
    .replace(/[g9]/g, 'g')
    .replace(/[z2]/g, 'z')
    .replace(/[uv]/g, 'u');

export type FoldStrategy = (raw: string) => string;

const trigrams = (key: string): string[] => {
  const padded = `${PAD}${key}${PAD}`;
  const out: string[] = [];
  for (let i = 0; i + 3 <= padded.length; i++) out.push(padded.slice(i, i + 3));
  // A one-character key yields nothing above; fall back to the key itself so it
  // is still findable.
  return out.length ? out : [padded];
};

/**
 * Prepare an index for searching: fold every title and build the trigram map.
 *
 * Costly enough to do once (roughly 90k titles) and cheap enough not to care
 * about after that. Callers should hold onto the result.
 */
export const buildNameIndex = (
  data: CardNameIndexData,
  fold: FoldStrategy = shapeFold,
): CardNameIndex => {
  const entries: Entry[] = data.names.map((name, i) => ({ key: fold(name), name: i }));

  for (const [lang, list] of Object.entries(data.printed ?? {})) {
    for (const [nameIndex, printed] of list) {
      if (nameIndex < 0 || nameIndex >= data.names.length) continue;
      // Skip localized titles that fold to the same thing as the English name;
      // they add postings and change no outcome.
      const key = fold(printed);
      if (key === entries[nameIndex]?.key) continue;
      entries.push({ key, lang, name: nameIndex, printed });
    }
  }

  const postings = new Map<string, number[]>();
  entries.forEach((entry, id) => {
    // Distinct grams only: a repeated gram should not count twice toward overlap.
    for (const gram of new Set(trigrams(entry.key))) {
      const bucket = postings.get(gram);
      if (bucket) bucket.push(id);
      else postings.set(gram, [id]);
    }
  });

  return { entries, names: data.names, postings };
};

/** Levenshtein distance, two rows at a time. */
export const editDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = new Array<number>(b.length + 1);
  let row = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    row[0] = i;
    const ca = a[i - 1];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (ca === b[j - 1] ? 0 : 1),
      );
    }
    const swap = prev;
    prev = row;
    row = swap;
  }
  return prev[b.length];
};

/** Edit distance as a 0–1 similarity against the longer string. */
export const similarity = (a: string, b: string): number => {
  if (!a.length || !b.length) return 0;
  return Math.max(0, 1 - editDistance(a, b) / Math.max(a.length, b.length));
};

/**
 * Similarity that also rewards matching a *prefix* of a longer name.
 *
 * A title clipped by the crop, or a second line lost, reads as the start of the
 * real name — "Yavimaya, Cradle" for "Yavimaya, Cradle of Growth". Plain edit
 * distance scores that 0.6 purely for the missing tail, which is the difference
 * between identifying the card and offering nothing.
 */
const scoreAgainst = (query: string, key: string): number => {
  const whole = similarity(query, key);
  if (query.length >= 6 && key.length > query.length) {
    const head = similarity(query, key.slice(0, query.length));
    // Discounted: a prefix match really is weaker evidence than the full name,
    // and without the penalty every short query matches the longest card sharing
    // its opening.
    return Math.max(whole, head * 0.92);
  }
  return whole;
};

export interface MatchOptions {
  fold?: FoldStrategy;
  /** How many candidates to return. */
  limit?: number;
  /** Discard anything below this similarity. */
  minScore?: number;
}

/**
 * Rank index entries against one OCR reading.
 *
 * Two stages, because scoring 90k names properly per reading is too slow on a
 * phone: shared trigrams cheaply narrow the field, then edit distance ranks what
 * is left.
 */
export const matchName = (
  text: string,
  index: CardNameIndex,
  options: MatchOptions = {},
): NameCandidate[] => {
  const { fold = shapeFold, limit = 8, minScore = 0.45 } = options;
  const query = fold(text);
  if (query.length < 2) return [];

  const grams = new Set(trigrams(query));
  const overlap = new Map<number, number>();
  for (const gram of grams) {
    const bucket = index.postings.get(gram);
    if (!bucket) continue;
    for (const id of bucket) overlap.set(id, (overlap.get(id) ?? 0) + 1);
  }

  let pool: number[];
  if (overlap.size) {
    pool = [...overlap.keys()]
      .sort((a, b) => (overlap.get(b) ?? 0) - (overlap.get(a) ?? 0))
      .slice(0, RESCORE_LIMIT);
  } else {
    // No shared trigram at all. Rather than give up, score everything of a
    // plausible length: a badly mangled short name lands here.
    pool = [];
    for (let id = 0; id < index.entries.length; id++) {
      if (Math.abs(index.entries[id].key.length - query.length) <= 2) pool.push(id);
    }
  }

  // Keep the best score per English name: three languages and several printings
  // of one card must not fill the list with itself.
  const best = new Map<number, NameCandidate>();
  for (const id of pool) {
    const entry = index.entries[id];
    const score = scoreAgainst(query, entry.key);
    if (score < minScore) continue;
    const previous = best.get(entry.name);
    if (previous && previous.score >= score) continue;
    best.set(entry.name, {
      ...(entry.lang ? { lang: entry.lang } : {}),
      name: index.names[entry.name],
      ...(entry.printed ? { printedName: entry.printed } : {}),
      score,
    });
  }

  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
};

export interface Reading {
  /** Which pass produced it, for diagnostics. */
  source: string;
  text: string;
}

/**
 * Rank candidates across every OCR reading of the title.
 *
 * This replaces picking a winning string first and identifying it second. That
 * order cannot work: the only evidence that distinguishes "Sol Rinq" from
 * "Sol Ring" is that one of them is a card, which is precisely the knowledge the
 * string-picking step does not have.
 */
export const matchReadings = (
  readings: readonly Reading[],
  index: CardNameIndex,
  options: MatchOptions = {},
): NameCandidate[] => {
  const { limit = 8 } = options;
  const best = new Map<string, NameCandidate>();

  for (const reading of readings) {
    if (!reading.text.trim()) continue;
    for (const candidate of matchName(reading.text, index, { ...options, limit })) {
      const previous = best.get(candidate.name);
      if (previous && previous.score >= candidate.score) continue;
      best.set(candidate.name, { ...candidate, source: reading.source });
    }
  }

  return [...best.values()]
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
};

/**
 * How much better the leader is than the runner-up.
 *
 * The useful question is rarely "how good is the top score" but "is anything else
 * nearly as good". 0.9 with a 0.89 runner-up is an ambiguous read that should
 * offer a choice; 0.7 alone in the field is an answer.
 */
export const candidateMargin = (candidates: readonly NameCandidate[]): number => {
  if (!candidates.length) return 0;
  if (candidates.length === 1) return candidates[0].score;
  return candidates[0].score - candidates[1].score;
};
