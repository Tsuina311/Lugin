// Turn OCR noise from the collector area into set code and/or collector number.
//
// Parts can arrive separately across snaps (number line vs set line), so parsers
// return whatever they could read rather than requiring a full match every time.

export interface CollectorParts {
  collectorNumber?: string;
  /** True when ★ was seen; false when • was seen; else unknown. */
  foilMarker: boolean | null;
  raw: string;
  setCode?: string;
}

const FOIL_STAR = /[★✶✪*]/;
const NONFOIL_DOT = /[•·∙]/;

/** Words that look like 3-letter set codes but aren't. */
const SET_BLOCKLIST = new Set([
  'THE',
  'AND',
  'FOR',
  'SET',
  'LLC',
  'WOT',
  'INC',
  'ALL',
  'ANY',
  'ONE',
  'TWO',
  'RED',
]);

/** Type-line openers in EN / FR / DE / IT — skip these as title candidates. */
const TYPE_LINE =
  /^(legendary|legendäre|légendaire|leggendari[oa]?|creature|créature|creatura|kreatur|instant|éphémère|istantanea|sofortzauber|sorcery|rituel|stregoneria|hexerei|enchantment|enchantement|incantesimo|verzauberung|artifact|artefact|artefatto|artefakt|land|terrain|terra|planeswalker|planewalker)\b/iu;

/** Collapse OCR junk into a single comparable line. */
export const tidyOcr = (raw: string): string =>
  raw
    .replace(/\s+/g, ' ')
    .replace(/[|]/g, '/')
    .trim()
    .toUpperCase();

/** A card name OCR hit: prefer the first line (title), lightly cleaned. */
export const tidyName = (raw: string): string | null => {
  const lines = raw
    .split(/\n+/)
    .map(line =>
      line
        .replace(/\s+/g, ' ')
        // Keep Latin letters (incl. accents for FR/DE/IT names).
        .replace(/[^\p{L}\p{N}',.\-/ ]+/gu, '')
        .trim(),
    )
    .filter(Boolean);

  for (const name of lines) {
    if (name.length < 3) continue;
    if (!/\p{L}/u.test(name)) continue;
    if (/^\d/.test(name)) continue;
    if (TYPE_LINE.test(name)) continue;
    return name;
  }
  return null;
};

/** Pick the best title candidate from several OCR passes (title bar + focus zoom). */
export const bestName = (...raws: string[]): string | null => {
  let best: string | null = null;
  for (const raw of raws) {
    const name = tidyName(raw);
    if (!name) continue;
    if (!best || name.length > best.length) best = name;
  }
  return best;
};

/**
 * Normalize a candidate set code (CMR, M11, 2XM, …).
 * Returns undefined when it doesn't look like a Scryfall code.
 */
export const normalizeSetCode = (raw: string | undefined): string | undefined => {
  if (!raw) return undefined;
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 2 || code.length > 5) return undefined;
  if (SET_BLOCKLIST.has(code)) return undefined;
  if (!/[A-Z]/.test(code)) return undefined;
  // Pure words without digits that aren't exactly 3 chars are usually noise.
  if (!/\d/.test(code) && code.length !== 3 && code.length !== 4) return undefined;
  return code;
};

/**
 * Read a set code from the expansion-symbol crop (e.g. gold "M11" icon).
 * Collapses spaces so "M 11" → M11.
 */
export const parseSetSymbolText = (raw: string): string | undefined => {
  const compact = tidyOcr(raw).replace(/\s+/g, '');
  if (!compact) return undefined;

  // Prefer codes that include a digit (M11, 2XM) — distinctive in icon OCR.
  const withDigit = compact.match(/([A-Z]{1,3}\d{1,3}|\d[A-Z]{2,3}|[A-Z]\d{2})/);
  if (withDigit) return normalizeSetCode(withDigit[1]);

  const letters = compact.match(/([A-Z]{3,5})/);
  return normalizeSetCode(letters?.[1]);
};

const numberFrom = (line: string): string | undefined => {
  const classic = line.match(/\b(\d{1,4}[A-Z]?)\/\d{1,4}\b/);
  if (classic) return classic[1];
  const modern = line.match(/\b(\d{1,4}[A-Z]?)\b/);
  return modern?.[1];
};

const setFrom = (line: string): string | undefined => {
  // Alphanumeric codes: CMR, M11, 2XM, MH2, …
  const codes = [...line.matchAll(/\b([A-Z]{1,4}\d{0,3}|\d[A-Z0-9]{2,4})\b/g)].map(m => m[1]);
  for (const c of codes) {
    const n = normalizeSetCode(c);
    if (n) return n;
  }
  return undefined;
};

/**
 * Pull whatever collector fields are visible in this OCR string.
 *
 * Unlike `parseCollectorLine`, a partial hit (only the number, only the set) is
 * still useful — the scan UI keeps it until a later snap fills the gap.
 */
export const parseCollectorParts = (raw: string): CollectorParts => {
  const line = tidyOcr(raw);
  const foilMarker = FOIL_STAR.test(raw) ? true : NONFOIL_DOT.test(raw) ? false : null;
  if (!line) return { foilMarker, raw: line };

  // Full classic: 286/361 R CMR (rarity optional, set may be on the same pass).
  const classicFull = line.match(
    /\b(\d{1,4}[A-Z]?)\/\d{1,4}\b(?:\s*[A-Z])?[^A-Z0-9]{0,8}\b([A-Z0-9]{2,5})\b/,
  );
  if (classicFull) {
    const setCode = normalizeSetCode(classicFull[2]);
    if (setCode) {
      return {
        collectorNumber: classicFull[1],
        foilMarker,
        raw: line,
        setCode,
      };
    }
  }

  // Full modern: 0123 ★ DMU EN
  const modernFull = line.match(
    /\b(\d{1,4}[A-Z]?)\b[^A-Z0-9]{0,6}\b([A-Z0-9]{2,5})\b(?:[^A-Z0-9]+[A-Z]{2})?\b/,
  );
  if (modernFull) {
    const setCode = normalizeSetCode(modernFull[2]);
    if (setCode) {
      return {
        collectorNumber: modernFull[1],
        foilMarker,
        raw: line,
        setCode,
      };
    }
  }

  return {
    collectorNumber: numberFrom(line),
    foilMarker,
    raw: line,
    setCode: setFrom(line),
  };
};

/**
 * Back-compat: only succeed when both set and number are present.
 * Prefer `parseCollectorParts` for progressive scanning.
 */
export const parseCollectorLine = (
  raw: string,
): (Required<Pick<CollectorParts, 'collectorNumber' | 'setCode'>> & CollectorParts) | null => {
  const parts = parseCollectorParts(raw);
  if (!parts.collectorNumber || !parts.setCode) return null;
  return {
    collectorNumber: parts.collectorNumber,
    foilMarker: parts.foilMarker,
    raw: parts.raw,
    setCode: parts.setCode,
  };
};

/** Merge a new OCR pass into what we already hold — never wipe a good field. */
export const mergeParts = (
  into: CollectorParts,
  incoming: CollectorParts,
): CollectorParts => ({
  collectorNumber: incoming.collectorNumber ?? into.collectorNumber,
  foilMarker:
    incoming.foilMarker !== null && incoming.foilMarker !== undefined
      ? incoming.foilMarker
      : into.foilMarker,
  raw: [into.raw, incoming.raw].filter(Boolean).join(' · '),
  setCode: incoming.setCode ?? into.setCode,
});

/**
 * True when this OCR pass looks like a real collector strip, not title/type
 * text misread as a set code (e.g. "DUS" from "Dusk" on a name-only zoom).
 */
export const isConfidentCollector = (parts: CollectorParts): boolean => {
  if (parts.collectorNumber && parts.setCode) return true;
  if (parts.collectorNumber && /\d{1,4}[A-Z]?\/\d{1,4}/.test(parts.raw)) return true;
  // Digit-bearing set codes (M11, 2XM) are unlikely to be English word fragments.
  if (parts.setCode && /\d/.test(parts.setCode)) return true;
  return false;
};

/**
 * Merge collector OCR. Before the name is locked, ignore weak set-only /
 * digit-noise hits so a name-first zoom does not invent edition/number.
 */
export const mergePartsForScan = (
  into: CollectorParts,
  incoming: CollectorParts,
  opts: { nameLocked: boolean },
): CollectorParts => {
  if (opts.nameLocked || isConfidentCollector(incoming)) {
    return mergeParts(into, incoming);
  }
  // Soft keep: classic number alone is still useful; bare letter set codes are not.
  if (incoming.collectorNumber && /\d{1,4}[A-Z]?\/\d{1,4}/.test(incoming.raw)) {
    return mergeParts(into, {
      ...incoming,
      setCode: undefined,
    });
  }
  return into;
};
