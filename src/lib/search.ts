// Scryfall card search for the deck builder's "add a card" box. On the
// extension this goes through the background worker; on the phone build it
// calls Scryfall directly (they allow CORS).
//
// A search combines free text with structured filters. Bare words match card
// names, but anything that looks like Scryfall syntax (`t:wolf`, `o:"draw a
// card"`, `mv<3`, `-t:land`) is passed through untouched, so the box doubles as
// a full Scryfall query field. With the oracle toggle on, bare text matches
// rules text at that exact spelling (`draw` stays `draw`). `total` is surfaced
// so the UI can decide when the result set is small enough to show card images.

import type { DeckFormat } from './deck';
import { fetchRemote } from './fetchRemote';

export interface CardSearchResult {
  cmc?: number;
  collectorNumber?: string;
  /** Commander color identity in WUBRG order. */
  colorIdentity?: string[];
  /**
   * Per-face images for physically two-sided cards (length >= 2), so the hover
   * preview can flip without a second lookup.
   */
  faceImages?: string[];
  id: string;
  /** Front image (normal size) — browser-cached CDN URL. */
  imageUrl?: string;
  /** Scryfall keyword abilities, used for local shared-tag analysis. */
  keywords?: string[];
  /** Front-face mana cost, used by the shared basic-land planner. */
  manaCost?: string;
  name: string;
  /** Oracle text from every face, joined for whole-card theme analysis. */
  oracleText?: string;
  setCode?: string;
  /** Smaller scan for a grid. The hover preview still uses `imageUrl`. */
  thumbUrl?: string;
  typeLine?: string;
}

export interface CardSearchResponse {
  cards: CardSearchResult[];
  /** The Scryfall query that produced this, for display. */
  query: string;
  /** Total matches Scryfall reports (may exceed the returned page). */
  total: number;
}

/** One Scryfall page, plus the URL of the next page when there is one. */
export interface CardSearchPage extends CardSearchResponse {
  next: string | null;
}

/** The structured search the UI collects. */
export interface CardQuery {
  cmcMax?: number;
  cmcMin?: number;
  /** Restrict to cards legal in this deck format; omitted or freeform = no restriction. */
  format?: DeckFormat;
  /**
   * Restrict to cards playable under this color identity (Commander's rule:
   * the card's identity must be a subset). An empty array means colorless only;
   * `undefined` means no restriction.
   */
  identity?: string[];
  /**
   * Match the free text against oracle text at that exact spelling. Scryfall's
   * plain `o:` search stems words (`draw` hits `draws`); a regex does not.
   */
  oracle?: boolean;
  /** A subtype — creature type, land type, … ("Wolf"). */
  subtype?: string;
  /** Free text: bare words match names, Scryfall operators pass through. */
  text?: string;
  /** Card types; a card matching any of them qualifies. */
  types?: string[];
}

interface ScryfallCard {
  card_faces?: Array<{
    image_uris?: Record<string, string>;
    mana_cost?: string;
    oracle_text?: string;
  }>;
  cmc?: number;
  collector_number?: string;
  color_identity?: string[];
  id: string;
  image_uris?: Record<string, string>;
  keywords?: string[];
  mana_cost?: string;
  name: string;
  oracle_text?: string;
  set?: string;
  type_line?: string;
}

interface ScryfallList {
  data?: ScryfallCard[];
  has_more?: boolean;
  next_page?: string;
  total_cards?: number;
}

const SEARCH_URL = 'https://api.scryfall.com/cards/search';

/** Exclude Arena-only printings unless the query already picks a game. */
const PAPER_ONLY_FILTER = 'game:paper';

export interface DefaultSearchFilterOptions {
  format?: DeckFormat;
}

export const applyDefaultSearchFilters = (
  query: string,
  options: DefaultSearchFilterOptions = {},
): string => {
  const trimmed = query.trim();
  if (!trimmed) return trimmed;

  const parts = [trimmed];
  if (!/\bgame:/i.test(trimmed)) parts.push(PAPER_ONLY_FILTER);

  const format = options.format;
  if (format && format !== 'freeform' && !/\bf:/i.test(trimmed)) parts.push(`f:${format}`);

  return parts.join(' ');
};

const toResult = (c: ScryfallCard): CardSearchResult => {
  const images = c.image_uris ?? c.card_faces?.[0]?.image_uris;
  // Physically two-sided cards give each face its own image_uris; split and
  // adventure cards share one image, so they're naturally excluded here.
  const faceImages = (c.card_faces ?? [])
    .map(f => f.image_uris?.normal ?? f.image_uris?.large ?? f.image_uris?.small)
    .filter((u): u is string => typeof u === 'string');
  return {
    cmc: c.cmc,
    collectorNumber: c.collector_number,
    colorIdentity: c.color_identity,
    faceImages: faceImages.length >= 2 ? faceImages : undefined,
    id: c.id,
    imageUrl: images?.normal ?? images?.large ?? images?.small,
    keywords: c.keywords,
    manaCost: c.mana_cost ?? c.card_faces?.[0]?.mana_cost,
    name: c.name,
    oracleText:
      c.oracle_text ??
      c.card_faces
        ?.map(face => face.oracle_text)
        .filter((text): text is string => Boolean(text))
        .join('\n'),
    setCode: c.set,
    thumbUrl: images?.small ?? images?.normal,
    typeLine: c.type_line,
  };
};

// Splits on whitespace but keeps quoted values attached to their key, so
// `o:"draw a card"` and `"wolf pack"` each stay a single token.
const TOKEN_RE = /[^\s"]*"[^"]*"|\S+/g;

/** Does this token already read as Scryfall syntax (an operator, boolean or group)? */
const isSyntax = (token: string): boolean =>
  /^-?[a-z]+(:|[<>]=?|=)/i.test(token) || /^[-(]|[)]$/.test(token) || /^(or|and)$/i.test(token);

/**
 * Whether the text uses Scryfall operators anywhere, i.e. it's a query rather
 * than a card name the user could add as typed.
 */
export const looksLikeSyntax = (text: string): boolean =>
  (text.trim().match(TOKEN_RE) ?? []).some(isSyntax);

const quoted = (value: string): string => (/\s/.test(value) ? `"${value}"` : value);

/** The words inside a token, or null when it has nothing searchable in it. */
const bareValue = (token: string): string | null => {
  const phrase = token.match(/^"([^"]*)"$/);
  const value = (phrase ? phrase[1] : token.replace(/"/g, '')).trim();
  return /[a-z0-9]/i.test(value) ? value : null;
};

// Scryfall's `o:` index stems, so `o:draw` also matches "draws". A regex matches
// the characters as typed. The lookaround keeps a word from matching inside a
// longer one, and still allows text that starts with a symbol (`{T}`).
const ORACLE_REGEX_ESCAPE = /[\\/^$.*+?()[\]{}|]/g;

const oracleExact = (value: string): string =>
  `o:/(?<!\\w)${value.replace(ORACLE_REGEX_ESCAPE, '\\$&')}(?!\\w)/`;

/**
 * Turn the UI's query into Scryfall search syntax. Exported so the box can show
 * users the query it's running (and to keep it testable).
 */
export const buildScryfallQuery = (q: CardQuery): string => {
  const parts: string[] = [];
  const text = (q.text ?? '').trim().replace(/\s+/g, ' ');

  if (q.oracle && text && !looksLikeSyntax(text)) {
    const value = bareValue(text);
    if (value) parts.push(oracleExact(value));
  } else {
    for (const token of text.match(TOKEN_RE) ?? []) {
      if (isSyntax(token)) {
        parts.push(token);
        continue;
      }
      const value = bareValue(token);
      if (!value) continue;
      parts.push(q.oracle ? oracleExact(value) : `name:${quoted(value)}`);
    }
  }

  if (q.identity) {
    // `id<=` keeps cards whose identity fits inside the commander's; colorless
    // cards qualify for any commander, so an empty identity means colorless only.
    parts.push(q.identity.length === 0 ? 'id=c' : `id<=${q.identity.join('').toLowerCase()}`);
  }

  const types = (q.types ?? []).map(t => `t:${t.toLowerCase()}`);
  if (types.length === 1) parts.push(types[0]);
  else if (types.length > 1) parts.push(`(${types.join(' or ')})`);

  const subtype = q.subtype?.trim();
  if (subtype) parts.push(`t:${quoted(subtype.toLowerCase())}`);

  if (q.cmcMin != null) parts.push(`mv>=${q.cmcMin}`);
  if (q.cmcMax != null) parts.push(`mv<=${q.cmcMax}`);

  return parts.join(' ');
};

/**
 * Whether a query is narrow enough to run. A color identity on its own matches
 * thousands of cards (and is preselected from the commander), so it doesn't
 * count as a criterion by itself.
 */
export const hasSearchCriteria = (q: CardQuery): boolean =>
  (q.text?.trim().length ?? 0) >= 2 ||
  !!q.subtype?.trim() ||
  (q.types?.length ?? 0) > 0 ||
  q.cmcMin != null ||
  q.cmcMax != null;

/**
 * One page of a Scryfall search. Pass `next` to continue a previous page.
 * `order: 'edhrec'` puts the most-played cards first.
 */
export const searchScryfallPage = async (
  query: string,
  options: { format?: DeckFormat; next?: string | null; order?: 'edhrec' | 'name' } = {},
): Promise<CardSearchPage> => {
  const trimmed = options.next
    ? query
    : applyDefaultSearchFilters(query, { format: options.format });
  if (!options.next && !trimmed) return { cards: [], next: null, query: '', total: 0 };

  const url =
    options.next ??
    `${SEARCH_URL}?order=${options.order ?? 'name'}&unique=cards&dir=asc&q=${encodeURIComponent(trimmed)}`;
  const res = await fetchRemote(url, 'application/json');
  if (!res.ok) {
    if (res.status === 404) return { cards: [], next: null, query: trimmed, total: 0 };
    if (res.status === 400) throw new Error('That search isn’t valid Scryfall syntax.');
    if (res.status === 429) {
      throw new Error('Scryfall is rate-limiting right now — wait a second and try again.');
    }
    throw new Error(`Scryfall search failed (HTTP ${res.status})`);
  }
  const json = JSON.parse(res.body) as ScryfallList;
  const data = json.data ?? [];
  return {
    cards: data.map(toResult),
    next: json.has_more && json.next_page ? json.next_page : null,
    query: trimmed,
    total: json.total_cards ?? data.length,
  };
};

/**
 * Run a raw Scryfall query (one printing per card, alphabetical).
 */
export const searchScryfallQuery = async (
  query: string,
  limit = 50,
  format?: DeckFormat,
): Promise<CardSearchResponse> => {
  const page = await searchScryfallPage(query, { format });
  return { cards: page.cards.slice(0, limit), query: page.query, total: page.total };
};

/**
 * Run a search (one printing per card, alphabetical). Returns at most `limit`
 * cards plus the true total, so the caller can show images only once the set has
 * narrowed. Empty when there's nothing to search for, or when Scryfall finds
 * nothing (404).
 */
export const searchCards = async (q: CardQuery, limit = 12): Promise<CardSearchResponse> => {
  const query = buildScryfallQuery(q);
  if (!query || !hasSearchCriteria(q)) return { cards: [], query, total: 0 };
  return searchScryfallQuery(query, limit, q.format);
};

const exactCardCache = new Map<string, Promise<CardSearchResult | null>>();

/** Exact canonical card lookup, cached for Commander identity and similar rules checks. */
export const searchExactCard = (name: string): Promise<CardSearchResult | null> => {
  const exact = name.trim().replace(/"/g, '');
  if (!exact) return Promise.resolve(null);
  const key = exact.toLowerCase();
  const cached = exactCardCache.get(key);
  if (cached) return cached;
  const request = searchScryfallPage(`!"${exact}"`).then(page => page.cards[0] ?? null);
  exactCardCache.set(key, request);
  void request.catch(() => exactCardCache.delete(key));
  return request;
};

/**
 * Resolve a deck-sized list of names without issuing one request per card.
 * Scryfall search accepts exact-name clauses, so small batches keep Native and
 * Web land planning on the same polite request path as every other search.
 */
export const searchExactCards = async (names: readonly string[]): Promise<CardSearchResult[]> => {
  const unique = [...new Set(names.map(name => name.trim()).filter(Boolean))];
  const cards: CardSearchResult[] = [];
  for (let start = 0; start < unique.length; start += 20) {
    const query = unique
      .slice(start, start + 20)
      .map(name => `!"${name.replace(/[\\"]/g, match => `\\${match}`)}"`)
      .join(' or ');
    const page = await searchScryfallPage(`(${query})`);
    cards.push(...page.cards);
  }
  return cards;
};
