// Bucket a deck's mainboard cards into user-chosen tag sections.
//
// Each section is a DECK_TAGS id. Cards are matched by asking Scryfall whether
// each name satisfies the tag's query (batched exact-name ORs), then assigned
// exclusively in tag order — first matching section wins. Unmatched cards stay
// under the normal "Main deck" heading.

import { cardKey } from './cardName';
import { deckTagById } from './deckTags';
import type { DeckCard } from './deck';
import { searchScryfallQuery } from './search';

/** How many exact names to OR into one Scryfall query (URL length budget). */
const NAME_CHUNK = 12;

const escapeExact = (name: string): string => name.replace(/"/g, '');

/**
 * Which of `names` match `tagQuery` on Scryfall. Returns cardKeys.
 */
export const matchNamesToTagQuery = async (
  names: readonly string[],
  tagQuery: string,
  signal?: AbortSignal,
): Promise<Set<string>> => {
  const out = new Set<string>();
  const unique = [...new Set(names.map(n => n.trim()).filter(Boolean))];
  if (unique.length === 0 || !tagQuery.trim()) return out;

  for (let i = 0; i < unique.length; i += NAME_CHUNK) {
    if (signal?.aborted) break;
    const chunk = unique.slice(i, i + NAME_CHUNK);
    const nameOr = chunk.map(n => `!"${escapeExact(n)}"`).join(' OR ');
    const q = `(${nameOr}) (${tagQuery})`;
    try {
      const { cards } = await searchScryfallQuery(q, chunk.length + 5);
      for (const c of cards) out.add(cardKey(c.name));
    } catch {
      // One bad chunk shouldn't wipe the whole section — leave those unmatched.
    }
  }
  return out;
};

export interface TagSectionBucket {
  /** Main-deck cards assigned to this tag (exclusive). */
  cards: DeckCard[];
  tagId: string;
  label: string;
}

/**
 * Partition main-deck cards into ordered tag buckets, then leftover main.
 * Commander / sideboard are left to the caller.
 */
export const bucketMainByTagSections = async (
  mainCards: readonly DeckCard[],
  tagSectionIds: readonly string[],
  signal?: AbortSignal,
): Promise<{ buckets: TagSectionBucket[]; rest: DeckCard[] }> => {
  const ids = tagSectionIds.filter(id => deckTagById(id));
  if (ids.length === 0) return { buckets: [], rest: [...mainCards] };

  const names = mainCards.map(c => c.name);
  /** cardKey -> first matching tag id */
  const assigned = new Map<string, string>();

  for (const tagId of ids) {
    if (signal?.aborted) break;
    const tag = deckTagById(tagId);
    if (!tag) continue;
    const remaining = names.filter(n => !assigned.has(cardKey(n)));
    if (remaining.length === 0) break;
    const hits = await matchNamesToTagQuery(remaining, tag.query, signal);
    for (const key of hits) {
      if (!assigned.has(key)) assigned.set(key, tagId);
    }
  }

  const byTag = new Map<string, DeckCard[]>();
  for (const id of ids) byTag.set(id, []);
  const rest: DeckCard[] = [];

  for (const card of mainCards) {
    const tagId = assigned.get(cardKey(card.name));
    if (tagId) byTag.get(tagId)?.push(card);
    else rest.push(card);
  }

  const buckets: TagSectionBucket[] = ids.map(tagId => ({
    cards: byTag.get(tagId) ?? [],
    label: deckTagById(tagId)?.label ?? tagId,
    tagId,
  }));

  return { buckets, rest };
};
