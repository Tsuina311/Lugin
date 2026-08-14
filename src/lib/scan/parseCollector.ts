// Turn OCR noise from the collector strip into a set code + collector number.
//
// Modern cards print something like `0123 ★ DMU EN` or `0123 • DMU • EN` under
// the text box. Older ones use `123/281 DMU`. The foil/non-foil marker is the
// star vs the bullet — see src/lib/scan/foil.ts.

export interface CollectorParse {
  collectorNumber: string;
  /** True when the strip clearly showed ★; false when it showed •; else unknown. */
  foilMarker: boolean | null;
  raw: string;
  setCode: string;
}

const FOIL_STAR = /[★✶✪*]/;
const NONFOIL_DOT = /[•·∙]/;

/** Collapse OCR junk into a single comparable line. */
const tidy = (raw: string): string =>
  raw
    .replace(/\s+/g, ' ')
    .replace(/[|]/g, '/')
    .trim()
    .toUpperCase();

/**
 * Read set + number (+ optional foil marker) out of a collector-line OCR string.
 *
 * Returns null when nothing looks like a Magic collector line — better to ask
 * again than to invent a set code from noise.
 */
export const parseCollectorLine = (raw: string): CollectorParse | null => {
  const line = tidy(raw);
  if (!line) return null;

  const foilMarker = FOIL_STAR.test(raw) ? true : NONFOIL_DOT.test(raw) ? false : null;

  // Classic first: 123/281 DMU — unambiguous when present.
  const classic = line.match(/\b(\d{1,3}[A-Z]?)\/\d{1,3}\b[^A-Z0-9]{0,6}\b([A-Z0-9]{3})\b/);
  if (classic) {
    return {
      collectorNumber: classic[1],
      foilMarker,
      raw: line,
      setCode: classic[2],
    };
  }

  // Modern: number, then set, then optional language — `0123 ★ DMU EN`.
  const modern = line.match(
    /\b(\d{1,4}[A-Z]?)\b[^A-Z0-9]{0,6}\b([A-Z]{3})\b(?:[^A-Z0-9]+[A-Z]{2})?\b/,
  );
  if (modern) {
    return {
      collectorNumber: modern[1],
      foilMarker,
      raw: line,
      setCode: modern[2],
    };
  }

  // Set-first fallback (some OCR orders): `DMU 0123`.
  const setFirst = line.match(/\b([A-Z]{3})\b[^A-Z0-9]{0,6}\b(\d{1,4}[A-Z]?)\b/);
  if (setFirst) {
    return {
      collectorNumber: setFirst[2],
      foilMarker,
      raw: line,
      setCode: setFirst[1],
    };
  }

  return null;
};
