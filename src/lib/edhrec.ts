// EDHREC recommendations.
//
// Commander pages: json.edhrec.com/pages/commanders/<slug>[/<theme>].json
// Card pages: json.edhrec.com/pages/cards/<slug>.json — the same payload, for
// decks that include that card (Maze's End, The World Tree, …).
// The extension routes the request through its background worker; the phone
// build fetches JSON directly.
//
// Each card entry carries a Scryfall id, which we turn into a direct image-CDN
// URL (browser-cached, no API call per hover).

import { cardKey, frontFaceName } from './cardName';
import { fetchRemote } from './fetchRemote';
import { isBasicLand } from './lands';
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
const CARD_JSON_BASE = 'https://json.edhrec.com/pages/cards';
const CARD_PAGE_BASE = 'https://edhrec.com/cards';
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

/** A main-deck card the theme picker can see. Metadata is optional (phone). */
export interface EdhrecThemeDeckCard {
  keywords?: readonly string[];
  name: string;
  subtypes?: readonly string[];
  typeLine?: string;
}

export interface EdhrecThemePick {
  hits: number;
  label: string;
  reason: string;
  slug: string;
}

const THEME_STOP = new Set([
  'and',
  'budget',
  'card',
  'cards',
  'deck',
  'for',
  'from',
  'goodstuff',
  'land',
  'lands',
  'one',
  'plus',
  'spell',
  'spells',
  'the',
  'with',
  'you',
  'your',
]);

const stemWord = (word: string): string => {
  let w = word.toLowerCase();
  if (w.length < 3) return w;
  if (w.endsWith('ves') && w.length > 4) w = `${w.slice(0, -3)}f`;
  else if (w.endsWith('ies') && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (w.endsWith('es') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('s') && !w.endsWith('ss') && w.length > 4) w = w.slice(0, -1);
  return w;
};

const themeNeedles = (theme: EdhrecTheme): string[] => {
  const raw = `${theme.value} ${theme.slug.replace(/-/g, ' ')}`;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.toLowerCase().split(/[^a-z0-9]+/)) {
    if (part.length < 3 || THEME_STOP.has(part)) continue;
    const stem = stemWord(part);
    if (stem.length < 3 || THEME_STOP.has(stem) || seen.has(stem)) continue;
    seen.add(stem);
    out.push(stem);
  }
  return out;
};

const cardStems = (card: EdhrecThemeDeckCard): string[] => {
  const raw = [card.name, card.typeLine ?? '', ...(card.subtypes ?? []), ...(card.keywords ?? [])].join(
    ' ',
  );
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.toLowerCase().split(/[^a-z0-9]+/)) {
    if (part.length < 3) continue;
    const stem = stemWord(part);
    if (stem.length < 3 || seen.has(stem)) continue;
    seen.add(stem);
    out.push(stem);
  }
  return out;
};

const stemsOverlap = (needle: string, hay: string): boolean => {
  if (needle === hay) return true;
  const [shorter, longer] = needle.length <= hay.length ? [needle, hay] : [hay, needle];
  return shorter.length >= 3 && longer.startsWith(shorter);
};

/**
 * Pick an EDHREC theme when the main deck clearly matches one label
 * (Elves, Dragons, Equipment, …). Ties and weak hits stay on the generic page.
 */
export const pickEdhrecTheme = (
  themes: readonly EdhrecTheme[],
  cards: readonly EdhrecThemeDeckCard[],
): EdhrecThemePick | null => {
  const deck = cards.filter(c => c.name && !isBasicLand(c.name));
  if (themes.length === 0 || deck.length === 0) return null;

  const haystacks = deck.map(cardStems);
  const scored = themes
    .map(theme => {
      const needles = themeNeedles(theme);
      if (needles.length === 0) return { hits: 0, theme };
      let hits = 0;
      for (const hay of haystacks) {
        if (needles.some(n => hay.some(h => stemsOverlap(n, h)))) hits++;
      }
      return { hits, theme };
    })
    .sort((a, b) => b.hits - a.hits || b.theme.count - a.theme.count);

  const best = scored[0];
  const second = scored[1]?.hits ?? 0;
  if (!best || best.hits < 2 || best.hits < second + 2) return null;

  return {
    hits: best.hits,
    label: best.theme.value,
    reason: `Matched ${best.theme.value} in this deck`,
    slug: best.theme.slug,
  };
};

/** How many deck cards can be combined in one search. */
export const EDHREC_FOCUS_CAP = 3;

export interface EdhrecInclusionSource {
  inclusion?: number;
  /** Card or commander the percent belongs to. */
  label: string;
}

export interface EdhrecCombinedCard {
  card: EdhrecCard;
  /** Weakest inclusion among the required card pages. */
  minInclusion: number;
  sources: EdhrecInclusionSource[];
}

const bestByName = (data: EdhrecData): Map<string, EdhrecCard> => {
  const map = new Map<string, EdhrecCard>();
  for (const list of data.lists) {
    for (const card of list.cards) {
      const key = cardKey(card.name);
      const prev = map.get(key);
      if (!prev || (card.inclusion ?? -1) > (prev.inclusion ?? -1)) map.set(key, card);
    }
  }
  return map;
};

/**
 * Cards that show up on every selected card page, ranked by the weakest
 * inclusion. Commander inclusion is attached when that card is also on the
 * commander page; it does not filter the list.
 *
 * This is "popular next to each pick," not a count of decks that contain
 * every pick together.
 */
export const combineEdhrecCardPages = (
  pages: readonly { data: EdhrecData; label: string }[],
  commander?: { data: EdhrecData; label: string } | null,
): EdhrecCombinedCard[] => {
  if (pages.length < 2) return [];
  const indexes = pages.map(page => ({ cards: bestByName(page.data), label: page.label }));
  const commanderCards = commander ? bestByName(commander.data) : null;
  const [first, ...rest] = indexes;
  if (!first) return [];

  const out: EdhrecCombinedCard[] = [];
  for (const [key, card] of first.cards) {
    const hits: { card: EdhrecCard; label: string }[] = [{ card, label: first.label }];
    let missing = false;
    for (const other of rest) {
      const found = other.cards.get(key);
      if (!found) {
        missing = true;
        break;
      }
      hits.push({ card: found, label: other.label });
    }
    if (missing) continue;

    const minInclusion = Math.min(...hits.map(hit => hit.card.inclusion ?? 0));
    const richest = hits.reduce((best, hit) =>
      (hit.card.inclusion ?? 0) > (best.card.inclusion ?? 0) ? hit : best,
    );
    const sources: EdhrecInclusionSource[] = hits.map(hit => ({
      inclusion: hit.card.inclusion,
      label: hit.label,
    }));
    if (commander && commanderCards) {
      const onCommander = commanderCards.get(key);
      if (onCommander) {
        sources.push({
          inclusion: onCommander.inclusion,
          label: frontFaceName(commander.label),
        });
      }
    }
    out.push({
      card: { ...richest.card, imageUrl: richest.card.imageUrl ?? card.imageUrl, inclusion: minInclusion },
      minInclusion,
      sources,
    });
  }

  return out.sort(
    (a, b) => b.minInclusion - a.minInclusion || a.card.name.localeCompare(b.card.name),
  );
};

/** Thrown when EDHREC has no page for this commander (or theme). */
export class EdhrecNotFound extends Error {}

const fetchEdhrecJson = async (
  jsonUrl: string,
  pageUrl: string,
  cacheKey: string,
  missing: string,
  force: boolean,
): Promise<EdhrecData> => {
  if (!force) {
    const hit = await readPlatformStorage<EdhrecData>(cacheKey);
    if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit;
  }

  const res = await fetchRemote(jsonUrl, 'application/json');
  if (!res.ok) {
    // EDHREC answers 403 (not 404) for pages that don't exist.
    if (res.status === 403 || res.status === 404) throw new EdhrecNotFound(missing);
    throw new Error(`EDHREC request failed (HTTP ${res.status})`);
  }

  const data = parsePayload(JSON.parse(res.body) as RawPayload, pageUrl);
  await writePlatformStorage(cacheKey, data);
  return data;
};

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
  return fetchEdhrecJson(
    `${JSON_BASE}/${path}.json`,
    `${PAGE_BASE}/${path}`,
    `${CACHE_PREFIX}${path}`,
    theme ? 'EDHREC has no data for that theme.' : 'EDHREC has no page for this commander yet.',
    force,
  );
};

/**
 * Cards played in decks that already include `name` — the same aggregate EDHREC
 * uses for a commander, scoped to one card (Maze's End, The World Tree, …).
 */
export const fetchEdhrecCard = async (name: string, force = false): Promise<EdhrecData> => {
  const slug = edhrecSlug(name);
  if (!slug) throw new EdhrecNotFound('No card selected.');
  return fetchEdhrecJson(
    `${CARD_JSON_BASE}/${slug}.json`,
    `${CARD_PAGE_BASE}/${slug}`,
    `${CACHE_PREFIX}card:${slug}`,
    'EDHREC has no page for this card yet.',
    force,
  );
};
