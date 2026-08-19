// Scryfall card search for the deck builder's "add a card" box. On the
// extension this goes through the background worker; on the phone build it
// calls Scryfall directly (they allow CORS).
//
// A search combines free text with structured filters. Bare words match card
// names, but anything that looks like Scryfall syntax (`t:wolf`, `o:"draw a
// card"`, `mv<3`, `-t:land`) is passed through untouched, so the box doubles as
// a full Scryfall query field. `total` is surfaced so the UI can decide when the
// result set is small enough to show card images.

import { requestApi } from './messaging';
import type { ApiResult } from './types';

/** Scryfall allows browser CORS; the extension routes through its worker instead. */
const fetchScryfall = async (url: string): Promise<ApiResult> => {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
      return await requestApi({ url });
    }
  } catch {
    // Unpacked builds can throw when the runtime is gone — fall through to fetch.
  }
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  return {
    body: await res.text(),
    headers: {},
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    url: res.url,
  };
};

export interface CardSearchResult {
  cmc?: number;
  collectorNumber?: string;
  /**
   * Per-face images for physically two-sided cards (length >= 2), so the hover
   * preview can flip without a second lookup.
   */
  faceImages?: string[];
  id: string;
  /** Front image (normal size) — browser-cached CDN URL. */
  imageUrl?: string;
  name: string;
  setCode?: string;
  typeLine?: string;
}

export interface CardSearchResponse {
  cards: CardSearchResult[];
  /** The Scryfall query that produced this, for display. */
  query: string;
  /** Total matches Scryfall reports (may exceed the returned page). */
  total: number;
}

/** The structured search the UI collects. */
export interface CardQuery {
  cmcMax?: number;
  cmcMin?: number;
  /**
   * Restrict to cards playable under this color identity (Commander's rule:
   * the card's identity must be a subset). An empty array means colorless only;
   * `undefined` means no restriction.
   */
  identity?: string[];
  /** A subtype — creature type, land type, … ("Wolf"). */
  subtype?: string;
  /** Free text: bare words match names, Scryfall operators pass through. */
  text?: string;
  /** Card types; a card matching any of them qualifies. */
  types?: string[];
}

interface ScryfallCard {
  card_faces?: Array<{ image_uris?: Record<string, string> }>;
  cmc?: number;
  collector_number?: string;
  id: string;
  image_uris?: Record<string, string>;
  name: string;
  set?: string;
  type_line?: string;
}

interface ScryfallList {
  data?: ScryfallCard[];
  total_cards?: number;
}

const SEARCH_URL = 'https://api.scryfall.com/cards/search';

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
    faceImages: faceImages.length >= 2 ? faceImages : undefined,
    id: c.id,
    imageUrl: images?.normal ?? images?.large ?? images?.small,
    name: c.name,
    setCode: c.set,
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

/**
 * A bare word (or quoted phrase) becomes a name filter, keeping phrases intact.
 * Punctuation-only tokens (the `//` in "Fire // Ice") are dropped — they'd make
 * the query invalid without narrowing it.
 */
const nameTerm = (token: string): string | null => {
  const phrase = token.match(/^"([^"]*)"$/);
  const value = (phrase ? phrase[1] : token.replace(/"/g, '')).trim();
  return /[a-z0-9]/i.test(value) ? `name:${quoted(value)}` : null;
};

/**
 * Turn the UI's query into Scryfall search syntax. Exported so the box can show
 * users the query it's running (and to keep it testable).
 */
export const buildScryfallQuery = (q: CardQuery): string => {
  const parts: string[] = [];

  for (const token of (q.text ?? '').trim().match(TOKEN_RE) ?? []) {
    const term = isSyntax(token) ? token : nameTerm(token);
    if (term) parts.push(term);
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
 * Run a search (one printing per card, alphabetical). Returns at most `limit`
 * cards plus the true total, so the caller can show images only once the set has
 * narrowed. Empty when there's nothing to search for, or when Scryfall finds
 * nothing (404).
 */
export const searchCards = async (q: CardQuery, limit = 12): Promise<CardSearchResponse> => {
  const query = buildScryfallQuery(q);
  if (!query || !hasSearchCriteria(q)) return { cards: [], query, total: 0 };

  const url = `${SEARCH_URL}?order=name&unique=cards&dir=asc&q=${encodeURIComponent(query)}`;
  const res = await fetchScryfall(url);
  if (!res.ok) {
    if (res.status === 404) return { cards: [], query, total: 0 }; // no matches
    if (res.status === 400) throw new Error('That search isn’t valid Scryfall syntax.');
    throw new Error(`Scryfall search failed (HTTP ${res.status})`);
  }
  const json = JSON.parse(res.body) as ScryfallList;
  const data = json.data ?? [];
  return {
    cards: data.slice(0, limit).map(toResult),
    query,
    total: json.total_cards ?? data.length,
  };
};
