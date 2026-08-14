// Reading the delimited files people actually export.
//
// "CSV" is a polite fiction. ManaBox writes commas from one screen and tabs from
// another, European exports use semicolons because their spreadsheets do, and
// anything that has been near Excel starts with a byte-order mark that turns the
// first column name into "\uFEFFName" and quietly breaks every header lookup.
//
// So nothing here trusts the file extension or the caller's expectation: the
// delimiter is inferred from the header row, the mark is stripped, and quoted
// fields are honoured because card names contain commas ("Erayo, Soratami
// Ascendant") far too often to treat a comma as a reliable boundary.

/** A file that parsed as a table: lowercased header, plus the data rows. */
export interface Table {
  /** What separated the fields — reported so a UI can explain what it read. */
  delimiter: string;
  /** Trimmed and lowercased, so callers can match without normalising again. */
  header: string[];
  rows: string[][];
}

// Ordered by how likely they are to be the real delimiter when a line contains
// several: a tab is never incidental, a semicolon usually isn't, a comma often
// is (it lives inside card names).
const DELIMITERS = ['\t', ';', ','];

/**
 * Split one line, honouring double-quoted fields and the doubled `""` escape.
 *
 * Quotes are only special at the start of a field: a bare quote mid-value (an
 * inch mark, a nickname) would otherwise swallow the rest of the line.
 */
export const splitLine = (line: string, delimiter: string): string[] => {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  let atFieldStart = true;

  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"' && atFieldStart) {
      quoted = true;
      atFieldStart = false;
    } else if (c === delimiter) {
      out.push(cur);
      cur = '';
      atFieldStart = true;
    } else {
      cur += c;
      atFieldStart = false;
    }
  }
  out.push(cur);
  return out;
};

/** Strip the byte-order mark Excel and friends prepend. */
export const stripBom = (text: string): string => text.replace(/^\uFEFF/, '');

/**
 * Which delimiter is this file using? Whichever splits the header into the most
 * fields, preferring the least ambiguous on a tie — a header of
 * "Name,Set code" has one tab and two comma-fields, and only one of those
 * readings produces columns.
 */
export const sniffDelimiter = (headerLine: string): string => {
  let best = ',';
  let bestCount = 1;
  for (const d of DELIMITERS) {
    const count = splitLine(headerLine, d).length;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
};

/**
 * Read `text` as a delimited table, or return null if it doesn't look like one.
 *
 * "Looks like one" deliberately means *more than one column*, and nothing about
 * the column names: what counts as a usable header is the caller's business,
 * and a decklist is a one-column file that must not be mistaken for a table.
 */
export const parseTable = (text: string): Table | null => {
  const lines = stripBom(text)
    .split(/\r?\n/)
    .filter(l => l.trim() !== '');
  if (lines.length === 0) return null;

  const delimiter = sniffDelimiter(lines[0]);
  const header = splitLine(lines[0], delimiter).map(h => h.trim().toLowerCase());
  if (header.length < 2) return null;

  return {
    delimiter,
    header,
    rows: lines.slice(1).map(l => splitLine(l, delimiter)),
  };
};

/**
 * Index of the first header matching any of `names`, or -1.
 *
 * Aliases rather than one canonical spelling because every exporter names these
 * differently — "Collector number", "Card number", "CollectorNumber" are all the
 * same column, and the file is not going to change to suit us.
 */
export const columnIndex = (header: string[], ...names: string[]): number => {
  for (const name of names) {
    const i = header.indexOf(name);
    if (i >= 0) return i;
  }
  return -1;
};

/** Trimmed value at `index`, or undefined for a missing or empty cell. */
export const cell = (fields: string[], index: number): string | undefined =>
  index >= 0 ? fields[index]?.trim() || undefined : undefined;
