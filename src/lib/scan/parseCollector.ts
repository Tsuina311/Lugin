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

/** Collapse OCR junk into a single comparable line. */
export const tidyOcr = (raw: string): string =>
  raw
    .replace(/\s+/g, ' ')
    .replace(/[|]/g, '/')
    .trim()
    .toUpperCase();

/** A card name OCR hit: strip newlines, keep letters/punctuation lightly cleaned. */
export const tidyName = (raw: string): string | null => {
  const name = raw
    .replace(/\s+/g, ' ')
    .replace(/[^A-Za-z0-9,',.\-/ ]+/g, '')
    .trim();
  if (name.length < 3) return null;
  if (!/[A-Za-z]/.test(name)) return null;
  return name;
};

const numberFrom = (line: string): string | undefined => {
  const classic = line.match(/\b(\d{1,4}[A-Z]?)\/\d{1,4}\b/);
  if (classic) return classic[1];
  const modern = line.match(/\b(\d{1,4}[A-Z]?)\b/);
  return modern?.[1];
};

const setFrom = (line: string): string | undefined => {
  // Prefer a standalone 3-letter code that isn't a rarity letter run.
  const codes = [...line.matchAll(/\b([A-Z]{3})\b/g)].map(m => m[1]);
  return codes.find(c => !/^(THE|AND|FOR|SET)$/.test(c));
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
    /\b(\d{1,4}[A-Z]?)\/\d{1,4}\b(?:\s*[A-Z])?[^A-Z0-9]{0,8}\b([A-Z]{3})\b/,
  );
  if (classicFull) {
    return {
      collectorNumber: classicFull[1],
      foilMarker,
      raw: line,
      setCode: classicFull[2],
    };
  }

  // Full modern: 0123 ★ DMU EN
  const modernFull = line.match(
    /\b(\d{1,4}[A-Z]?)\b[^A-Z0-9]{0,6}\b([A-Z]{3})\b(?:[^A-Z0-9]+[A-Z]{2})?\b/,
  );
  if (modernFull) {
    return {
      collectorNumber: modernFull[1],
      foilMarker,
      raw: line,
      setCode: modernFull[2],
    };
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
