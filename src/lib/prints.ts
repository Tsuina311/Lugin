// Fetch every printing of a card from Scryfall, so the user can pick the exact
// version they own when our automatic guess is wrong (see the "not this
// version" flow in CollectionPanel). Routed through the background worker
// (requestApi) to sidestep page CORS, same as the rest of our Scryfall use.

import { frontFaceName } from './cardName';
import { requestApi } from './messaging';

/** One printing of a card, with just what the picker + override need. */
export interface CardPrint {
  collectorNumber: string;
  /** e.g. ["nonfoil", "foil"] — shown so promos/foils are distinguishable. */
  finishes?: string[];
  /** Scryfall id (drives the browser-cached CDN image). */
  id: string;
  /** Front image (normal size) for the picker thumbnail. */
  imageUrl?: string;
  /** Released date string ("2020-07-03"), for display/sorting. */
  releasedAt?: string;
  setCode: string;
  setName: string;
}

interface ScryfallCard {
  card_faces?: Array<{ image_uris?: Record<string, string> }>;
  collector_number: string;
  finishes?: string[];
  id: string;
  image_uris?: Record<string, string>;
  released_at?: string;
  set: string;
  set_name: string;
}

interface ScryfallList {
  data?: ScryfallCard[];
  has_more?: boolean;
  next_page?: string;
}

const SEARCH_URL = 'https://api.scryfall.com/cards/search';
const MAX_PAGES = 6; // 175 prints/page — plenty for even the most-reprinted cards.

const toPrint = (c: ScryfallCard): CardPrint => {
  const images = c.image_uris ?? c.card_faces?.[0]?.image_uris;
  return {
    collectorNumber: c.collector_number,
    finishes: c.finishes,
    id: c.id,
    imageUrl: images?.normal ?? images?.large ?? images?.small,
    releasedAt: c.released_at,
    setCode: c.set,
    setName: c.set_name,
  };
};

/**
 * Every printing of a card, newest first. Uses an exact name match with
 * `unique=prints` so each distinct printing is returned once. Returns [] when
 * Scryfall knows no such card (404).
 */
export const fetchCardPrints = async (name: string): Promise<CardPrint[]> => {
  const exact = frontFaceName(name).trim();
  const query = `!"${exact}"`;
  const url = `${SEARCH_URL}?order=released&dir=desc&unique=prints&q=${encodeURIComponent(query)}`;

  const out: CardPrint[] = [];
  let next: string | undefined = url;
  for (let page = 0; next && page < MAX_PAGES; page++) {
    const res = await requestApi({ url: next });
    if (!res.ok) {
      if (res.status === 404) break; // no matching card
      throw new Error(`Scryfall search failed (HTTP ${res.status})`);
    }
    const json = JSON.parse(res.body) as ScryfallList;
    for (const c of json.data ?? []) out.push(toPrint(c));
    next = json.has_more ? json.next_page : undefined;
  }
  return out;
};
