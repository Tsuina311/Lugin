// MTGGoldfish archetype data.
//
// Goldfish has no public API, so we fetch its archetype pages through the
// background worker (host_permissions) and parse the HTML with DOMParser. Two
// pages are used, each loaded lazily:
//
//   /archetype/<slug>         — "Card Breakdown": per-category cards with the
//                               average number of copies and the share of decks
//                               that play them.
//   /archetype/<slug>/decks   — the archetype's deck list (date, name, author,
//                               prices) linking to each deck.
//
// Individual deck pages (/deck/<id>, /deck/download/<id>) sit behind a
// Cloudflare challenge and can't be fetched here, so decks link out instead of
// being imported.

import { frontFaceName } from './cardName';
import { requestApi } from './messaging';

/** One card in the archetype's breakdown. */
export interface GoldfishCard {
  /** Average copies played across decks that run it (e.g. 1.0, or 10.4 basics). */
  avgCopies?: number;
  imageUrl?: string;
  /** Share of the archetype's decks that play it, 0..1. */
  inclusion?: number;
  name: string;
}

/** A breakdown category ("Creatures", "Lands", …). */
export interface GoldfishCategory {
  cards: GoldfishCard[];
  header: string;
}

export interface GoldfishArchetype {
  categories: GoldfishCategory[];
  fetchedAt: number;
  pageUrl: string;
}

/** One deck listed under the archetype. */
export interface GoldfishDeck {
  author?: string;
  /** ISO-ish date string as shown ("2026-08-09"). */
  date?: string;
  id: string;
  name: string;
  /** Tabletop price as shown ("$ 662"). */
  price?: string;
  url: string;
}

export interface GoldfishDecks {
  decks: GoldfishDeck[];
  fetchedAt: number;
  pageUrl: string;
}

const SITE = 'https://www.mtggoldfish.com';
const CACHE_PREFIX = 'goldfish:';
// Breakdown stats are aggregates that shift slowly; deck lists get new entries
// daily. One day keeps both reasonably fresh without re-fetching on every open.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Goldfish's slug form of a card name — same shape as EDHREC's but kept
 * separate since they're independent sites: lowercase, diacritics folded,
 * apostrophes dropped, other non-alphanumerics collapsed to single hyphens.
 */
const slugify = (name: string): string =>
  frontFaceName(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Archetype slug for a commander deck: "commander-" plus the commander's slug
 * (partner pairs join both, as in the site's own URLs).
 */
export const goldfishArchetypeSlug = (commanderNames: string[]): string => {
  const cmd = commanderNames.map(slugify).filter(Boolean).join('-');
  return cmd ? `commander-${cmd}` : '';
};

/** Thrown when Goldfish has no page for this archetype. */
export class GoldfishNotFound extends Error {}

/** Fetch a Goldfish page and return its parsed document. */
const fetchDoc = async (path: string): Promise<Document> => {
  const res = await requestApi({ url: `${SITE}${path}` });
  if (!res.ok) {
    if (res.status === 404) throw new GoldfishNotFound('MTGGoldfish has no page for this deck.');
    if (res.status === 403) {
      throw new Error('MTGGoldfish blocked the request (bot check). Try again later.');
    }
    throw new Error(`MTGGoldfish request failed (HTTP ${res.status})`);
  }
  // Cloudflare's interstitial answers 200 in some cases; detect it explicitly.
  if (res.body.includes('Just a moment') && res.body.includes('challenge-platform')) {
    throw new Error('MTGGoldfish returned a bot check instead of the page.');
  }
  return new DOMParser().parseFromString(res.body, 'text/html');
};

const readCache = async <T>(key: string): Promise<T | null> => {
  try {
    const stored = await chrome.storage.local.get(key);
    const hit = stored[key] as (T & { fetchedAt: number }) | undefined;
    if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit;
  } catch {
    // ignore cache read failures
  }
  return null;
};

const writeCache = async (key: string, value: unknown): Promise<void> => {
  try {
    await chrome.storage.local.set({ [key]: value });
  } catch {
    // ignore cache write failures
  }
};

/**
 * Best image for a breakdown entry. The <picture> exposes a 265x370 variant as
 * the srcset's 1x candidate — the right size for our thumbnails and hover
 * preview — with the <img> src pointing at a much larger file.
 */
const pickImage = (card: Element): string | undefined => {
  const srcset = card.querySelector('source[srcset]')?.getAttribute('srcset');
  const first = srcset?.split(',')[0]?.trim().split(/\s+/)[0];
  if (first) return first;
  return card.querySelector<HTMLImageElement>('img')?.getAttribute('src') ?? undefined;
};

/** "1.0 in 86% of decks" -> { avgCopies: 1, inclusion: 0.86 } */
const parseStats = (text: string): Pick<GoldfishCard, 'avgCopies' | 'inclusion'> => {
  const m = text.match(/([\d.]+)\s+in\s+([\d.]+)\s*%/);
  if (!m) return {};
  const avg = Number.parseFloat(m[1]);
  const incl = Number.parseFloat(m[2]);
  return {
    avgCopies: Number.isFinite(avg) ? avg : undefined,
    inclusion: Number.isFinite(incl) ? incl / 100 : undefined,
  };
};

const parseArchetype = (doc: Document, pageUrl: string): GoldfishArchetype => {
  const categories: GoldfishCategory[] = [];
  for (const container of doc.querySelectorAll('.spoiler-card-container')) {
    const header = container.querySelector('h3')?.textContent?.trim() ?? 'Cards';
    const cards: GoldfishCard[] = [];
    for (const el of container.querySelectorAll('.spoiler-card')) {
      // The tray button carries the clean front-face display name (double-faced
      // cards list every face as a label, but only one display name).
      const name =
        el
          .querySelector('[data-card-tray-display-name]')
          ?.getAttribute('data-card-tray-display-name') ??
        el.querySelector('.price-card-invisible-label')?.textContent?.trim();
      if (!name) continue;
      cards.push({
        ...parseStats(
          el.querySelector('.archetype-breakdown-featured-card-text')?.textContent ?? '',
        ),
        imageUrl: pickImage(el),
        name,
      });
    }
    if (cards.length > 0) categories.push({ cards, header });
  }
  return { categories, fetchedAt: Date.now(), pageUrl };
};

const parseDecks = (doc: Document, pageUrl: string): GoldfishDecks => {
  const rows = [...doc.querySelectorAll('table tr')];

  // Map columns by their header label rather than fixed positions, so the
  // parse survives Goldfish reordering/adding columns.
  const headers = rows.find(r => r.querySelector('th'))?.querySelectorAll('th');
  const columnOf = (...labels: string[]): number | undefined => {
    if (!headers) return undefined;
    for (let i = 0; i < headers.length; i++) {
      const label = headers[i].textContent?.trim().toLowerCase() ?? '';
      if (labels.includes(label)) return i;
    }
    return undefined;
  };
  const dateCol = columnOf('date');
  const authorCol = columnOf('author', 'player');
  const priceCol = columnOf('tabletop price', 'price');

  const decks: GoldfishDeck[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const link = row.querySelector<HTMLAnchorElement>('a[href*="/deck/"]');
    const id = link?.getAttribute('href')?.match(/\/deck\/(\d+)/)?.[1];
    const name = link?.textContent?.trim();
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);

    const cells = [...row.querySelectorAll('td')].map(c => c.textContent?.trim() ?? '');
    const at = (i?: number): string | undefined => (i == null ? undefined : cells[i] || undefined);
    // Prices render as "$ 662" (tabletop) and "57 tix" (MTGO); prefer the
    // labelled column, else fall back to whichever cell shows a currency.
    const price = at(priceCol) ?? cells.filter(c => c.includes('$')).pop();
    decks.push({
      author: at(authorCol),
      date: at(dateCol),
      id,
      name,
      price: price === '-' ? undefined : price,
      url: `${SITE}/deck/${id}`,
    });
  }
  return { decks, fetchedAt: Date.now(), pageUrl };
};

/** The archetype's card breakdown (cached for a day; `force` re-fetches). */
export const fetchGoldfishArchetype = async (
  commanderNames: string[],
  force = false,
): Promise<GoldfishArchetype> => {
  const slug = goldfishArchetypeSlug(commanderNames);
  if (!slug) throw new GoldfishNotFound('No commander selected.');
  const key = `${CACHE_PREFIX}arch:${slug}`;
  if (!force) {
    const hit = await readCache<GoldfishArchetype>(key);
    if (hit) return hit;
  }
  const pageUrl = `${SITE}/archetype/${slug}`;
  const data = parseArchetype(await fetchDoc(`/archetype/${slug}`), pageUrl);
  if (data.categories.length === 0) {
    throw new GoldfishNotFound('MTGGoldfish has no card breakdown for this commander yet.');
  }
  await writeCache(key, data);
  return data;
};

/** The archetype's decks (cached for a day; `force` re-fetches). */
export const fetchGoldfishDecks = async (
  commanderNames: string[],
  force = false,
): Promise<GoldfishDecks> => {
  const slug = goldfishArchetypeSlug(commanderNames);
  if (!slug) throw new GoldfishNotFound('No commander selected.');
  const key = `${CACHE_PREFIX}decks:${slug}`;
  if (!force) {
    const hit = await readCache<GoldfishDecks>(key);
    if (hit) return hit;
  }
  const pageUrl = `${SITE}/archetype/${slug}/decks`;
  const data = parseDecks(await fetchDoc(`/archetype/${slug}/decks`), pageUrl);
  if (data.decks.length === 0) {
    throw new GoldfishNotFound('MTGGoldfish lists no decks for this commander yet.');
  }
  await writeCache(key, data);
  return data;
};
