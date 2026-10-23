export interface DeckTagMatchCard {
  keywords?: readonly string[];
  name: string;
  oracleText?: string;
  typeLine?: string;
}

type Token =
  | { kind: 'and' | 'left' | 'not' | 'or' | 'right' }
  | { field: string; kind: 'term'; regex: boolean; value: string };

const startsWord = (text: string, at: number, word: string): boolean => {
  const slice = text.slice(at, at + word.length);
  const after = text[at + word.length];
  return slice.toLowerCase() === word && (!after || /[\s()]/.test(after));
};

const tokens = (query: string): Token[] => {
  const out: Token[] = [];
  let at = 0;
  while (at < query.length) {
    if (/\s/.test(query[at])) {
      at += 1;
      continue;
    }
    if (query[at] === '(') {
      out.push({ kind: 'left' });
      at += 1;
      continue;
    }
    if (query[at] === ')') {
      out.push({ kind: 'right' });
      at += 1;
      continue;
    }
    if (query[at] === '-') {
      out.push({ kind: 'not' });
      at += 1;
      continue;
    }
    if (startsWord(query, at, 'or')) {
      out.push({ kind: 'or' });
      at += 2;
      continue;
    }
    if (startsWord(query, at, 'and')) {
      out.push({ kind: 'and' });
      at += 3;
      continue;
    }
    const field = query.slice(at).match(/^([a-z]+):/i);
    if (!field) {
      // None of the shared catalogue uses bare name terms. Skip defensively.
      while (at < query.length && !/[\s()]/.test(query[at])) at += 1;
      continue;
    }
    at += field[0].length;
    let value = '';
    let regex = false;
    if (query[at] === '"') {
      at += 1;
      while (at < query.length && query[at] !== '"') {
        value += query[at];
        at += 1;
      }
      at += Number(query[at] === '"');
    } else if (query[at] === '/') {
      regex = true;
      at += 1;
      while (at < query.length) {
        if (query[at] === '/' && query[at - 1] !== '\\') break;
        value += query[at];
        at += 1;
      }
      at += Number(query[at] === '/');
    } else {
      while (at < query.length && !/[\s()]/.test(query[at])) {
        value += query[at];
        at += 1;
      }
    }
    out.push({ field: field[1].toLowerCase(), kind: 'term', regex, value });
  }
  return out;
};

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const oracleMatch = (
  card: DeckTagMatchCard,
  value: string,
  regex: boolean,
): boolean => {
  const oracle = card.oracleText ?? '';
  const names = card.name.split(/\s*\/\/\s*/);
  if (regex) {
    return names.some(name => {
      try {
        return new RegExp(value.replace(/~/g, escapeRegex(name)), 'i').test(oracle);
      } catch {
        return false;
      }
    });
  }
  return names.some(name => oracle.toLocaleLowerCase().includes(value.replace(/~/g, name).toLocaleLowerCase()));
};

const termMatch = (
  card: DeckTagMatchCard,
  token: Extract<Token, { kind: 'term' }>,
): boolean => {
  if (token.field === 'o') return oracleMatch(card, token.value, token.regex);
  if (token.field === 'keyword') {
    const wanted = token.value.toLocaleLowerCase();
    return card.keywords?.some(keyword => keyword.toLocaleLowerCase() === wanted) === true;
  }
  if (token.field === 't') {
    const wanted = escapeRegex(token.value);
    return new RegExp(`(^|[^a-z])${wanted}([^a-z]|$)`, 'i').test(card.typeLine ?? '');
  }
  return false;
};

type Matcher = (card: DeckTagMatchCard) => boolean;

const compile = (query: string): Matcher => {
  const stream = tokens(query);
  let at = 0;

  const primary = (): Matcher => {
    const token = stream[at++];
    if (!token) return () => false;
    if (token.kind === 'left') {
      const inside = or();
      if (stream[at]?.kind === 'right') at += 1;
      return inside;
    }
    if (token.kind === 'term') return card => termMatch(card, token);
    return () => false;
  };
  const unary = (): Matcher => {
    if (stream[at]?.kind !== 'not') return primary();
    at += 1;
    const inner = unary();
    return card => !inner(card);
  };
  const and = (): Matcher => {
    const matchers = [unary()];
    while (at < stream.length && stream[at].kind !== 'or' && stream[at].kind !== 'right') {
      if (stream[at].kind === 'and') at += 1;
      matchers.push(unary());
    }
    return card => matchers.every(matcher => matcher(card));
  };
  const or = (): Matcher => {
    const matchers = [and()];
    while (stream[at]?.kind === 'or') {
      at += 1;
      matchers.push(and());
    }
    return card => matchers.some(matcher => matcher(card));
  };

  return or();
};

const compiled = new Map<string, Matcher>();

/** Oracle tags are Scryfall-internal classifications unavailable on card JSON. */
export const canMatchDeckTagLocally = (query: string): boolean => !/(^|[\s(])-?otag:/i.test(query);

/** Evaluate the subset of Scryfall syntax used by the shared tag catalogue. */
export const matchesDeckTagQuery = (card: DeckTagMatchCard, query: string): boolean => {
  if (!canMatchDeckTagLocally(query)) return false;
  let matcher = compiled.get(query);
  if (!matcher) {
    matcher = compile(query);
    compiled.set(query, matcher);
  }
  return matcher(card);
};
