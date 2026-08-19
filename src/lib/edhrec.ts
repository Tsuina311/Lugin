// EDHREC commander recommendations.
//
// EDHREC publishes the data behind each commander page as JSON at
// json.edhrec.com/pages/commanders/<slug>[/<theme>].json — the same payload its
// own site renders, so we don't scrape HTML. The extension routes the request
// through its background worker; the phone build fetches JSON directly.
//
// Each card entry carries a Scryfall id, which we turn into a direct image-CDN
// URL (browser-cached, no API call per hover).

import { frontFaceName } from './cardName';
import { fetchRemote } from './fetchRemote';
import { readPlatformStorage, writePlatformStorage } from './platformStorage';

/** One recommended card within a category. */
export interface EdhrecCard {
  imageUrl?: string;
  /** Share of decks that play it, 0..1 (num_decks / potential_decks). */
  inclusion?: number;
  name: string;
  numDecks?: number;
  potentialDecks?: number;
  /** Scryfall id. */
  scryfallId?: string;
  /** EDHREC's synergy score, 0..1 (can be negative for staples). */
  synergy?: number;
}

/** A category of recommendations ("High Synergy Cards", "Creatures", …). */
export interface EdhrecList {
  cards: EdhrecCard[];
  header: string;
  tag: string;
}

/** A deck theme/tag for this commander ("Wolves", "Tokens", …). */
export interface EdhrecTheme {
  count: number;
  slug: string;
  value: string;
}

export interface EdhrecData {
  commanderName?: string;
  /** Number of decks EDHREC has for this commander (+ theme). */
  deckCount?: number;
  fetchedAt: number;
  lists: EdhrecList[];
  /** The human page URL, for a "view on EDHREC" link. */
  pageUrl: string;
  themes: EdhrecTheme[];
}

interface RawCardView {
  cmc?: number;
  id?: string;
  name?: string;
  num_decks?: number;
  potential_decks?: number;
  synergy?: number;
}

interface RawPayload {
  container?: {
    json_dict?: {
      card?: { name?: string; num_decks?: number };
      cardlists?: { cardviews?: RawCardView[]; header?: string; tag?: string }[];
    };
  };
  panels?: { taglinks?: { count?: number; slug?: string; value?: string }[] };
}

const JSON_BASE = 'https://json.edhrec.com/pages/commanders';
const PAGE_BASE = 'https://edhrec.com/commanders';
const CACHE_PREFIX = 'edhrec:';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // a week — deck stats move slowly.

/**
 * EDHREC's slug form of a card name: lowercase, diacritics folded, apostrophes
 * dropped, every other run of non-alphanumerics collapsed to a single hyphen.
 * "Sarulf, Realm Eater" -> "sarulf-realm-eater"; "Tovolar's Huntmaster" ->
 * "tovolars-huntmaster".
 */
export const edhrecSlug = (name: string): string =>
  frontFaceName(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * The page slug for a commander (or a partner pair — EDHREC accepts either
 * order and normalizes it).
 */
export const commanderSlug = (names: string[]): string =>
  names.map(edhrecSlug).filter(Boolean).join('-');

/** Direct Scryfall image-CDN URL for a printing id (browser-cached). */
const cdnImage = (id?: string): string | undefined => {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  return `https://cards.scryfall.io/normal/front/${id[0]}/${id[1]}/${id}.jpg`;
};

const parsePayload = (raw: RawPayload, pageUrl: string): EdhrecData => {
  const dict = raw.container?.json_dict;
  const lists: EdhrecList[] = (dict?.cardlists ?? [])
    .map(l => ({
      cards: (l.cardviews ?? [])
        .filter((c): c is RawCardView & { name: string } => typeof c.name === 'string')
        .map(c => ({
          imageUrl: cdnImage(c.id),
          inclusion:
            c.num_decks != null && c.potential_decks ? c.num_decks / c.potential_decks : undefined,
          name: c.name,
          numDecks: c.num_decks,
          potentialDecks: c.potential_decks,
          scryfallId: c.id,
          synergy: c.synergy,
        })),
      header: l.header ?? l.tag ?? 'Cards',
      tag: l.tag ?? l.header ?? 'cards',
    }))
    .filter(l => l.cards.length > 0);

  return {
    commanderName: dict?.card?.name,
    deckCount: dict?.card?.num_decks,
    fetchedAt: Date.now(),
    lists,
    pageUrl,
    themes: (raw.panels?.taglinks ?? [])
      .filter((t): t is { count: number; slug: string; value: string } => !!t.slug && !!t.value)
      .map(t => ({ count: t.count ?? 0, slug: t.slug, value: t.value })),
  };
};

/** Thrown when EDHREC has no page for this commander (or theme). */
export class EdhrecNotFound extends Error {}

/**
 * Recommendations for a commander (optionally narrowed to a theme, e.g.
 * "wolves"). Results are cached in chrome.storage for a week; pass
 * `force` to bypass the cache.
 */
export const fetchEdhrec = async (
  commanderNames: string[],
  theme?: string,
  force = false,
): Promise<EdhrecData> => {
  const slug = commanderSlug(commanderNames);
  if (!slug) throw new EdhrecNotFound('No commander selected.');

  const path = theme ? `${slug}/${theme}` : slug;
  const cacheKey = `${CACHE_PREFIX}${path}`;
  const pageUrl = `${PAGE_BASE}/${path}`;

  if (!force) {
    const hit = await readPlatformStorage<EdhrecData>(cacheKey);
    if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit;
  }

  const res = await fetchRemote(`${JSON_BASE}/${path}.json`, 'application/json');
  if (!res.ok) {
    // EDHREC answers 403 (not 404) for pages that don't exist.
    if (res.status === 403 || res.status === 404) {
      throw new EdhrecNotFound(
        theme ? 'EDHREC has no data for that theme.' : 'EDHREC has no page for this commander yet.',
      );
    }
    throw new Error(`EDHREC request failed (HTTP ${res.status})`);
  }

  const data = parsePayload(JSON.parse(res.body) as RawPayload, pageUrl);
  await writePlatformStorage(cacheKey, data);
  return data;
};
