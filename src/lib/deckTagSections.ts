// Bucket a deck's mainboard cards into user-chosen tag sections.
//
// Each section is a DECK_TAGS id. Cards are matched by asking Scryfall whether
// each name satisfies the tag's query (batched exact-name ORs), then assigned
// exclusively in tag order — first matching section wins. Unmatched cards stay
// under the normal "Main deck" heading.

import { cardKey } from './cardName';
import type { DeckCard, DeckTagAnalysis } from './deck';
import {
  canMatchDeckTagLocally,
  matchesDeckTagQuery,
  type DeckTagMatchCard,
} from './deckTagMatch';
import { deckTagById } from './deckTags';
import { searchScryfallQuery } from './search';

/** Encoded query budget, below common 8 KB request-line limits. */
const QUERY_BUDGET = 6000;

const escapeExact = (name: string): string => name.replace(/"/g, '');

const nameChunks = (names: readonly string[], tagQuery: string): string[][] => {
  const chunks: string[][] = [];
  let chunk: string[] = [];
  for (const name of names) {
    const candidate = [...chunk, name];
    const nameOr = candidate.map(n => `!"${escapeExact(n)}"`).join(' OR ');
    const query = `(${nameOr}) (${tagQuery})`;
    if (chunk.length > 0 && encodeURIComponent(query).length > QUERY_BUDGET) {
      chunks.push(chunk);
      chunk = [name];
    } else {
      chunk = candidate;
    }
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
};

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

  for (const chunk of nameChunks(unique, tagQuery)) {
    if (signal?.aborted) break;
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

/**
 * Complete the persisted per-card tag cache, querying only missing results.
 *
 * Removed cards/tags are pruned, and changing a tag query invalidates only that
 * tag. Negative matches are stored too, which is what makes a second visit
 * require no network requests.
 */
export const analyzeDeckTags = async (
  names: readonly string[],
  tagIds: readonly string[],
  previous?: DeckTagAnalysis,
  signal?: AbortSignal,
): Promise<DeckTagAnalysis> => {
  const cards = new Map<string, string>();
  for (const name of names) {
    const key = cardKey(name);
    if (key && !cards.has(key)) cards.set(key, name.trim());
  }
  const ids = [...new Set(tagIds)].filter(id => deckTagById(id));
  const previousCards = new Set(previous?.version === 2 ? previous.cards : []);
  const entries = await Promise.all(
    ids.map(async id => {
      const tag = deckTagById(id)!;
      const validPrevious =
        previous?.version === 2 && previous.queries[id] === tag.query
          ? new Set(previous.results[id] ?? [])
          : undefined;
      const result = new Set<string>();
      const missing: string[] = [];
      for (const [key, name] of cards) {
        if (validPrevious && previousCards.has(key)) {
          if (validPrevious.has(key)) result.add(key);
        }
        else missing.push(name);
      }
      if (missing.length > 0) {
        const matches = await matchNamesToTagQuery(missing, tag.query, signal);
        if (!signal?.aborted) {
          for (const name of missing) {
            const key = cardKey(name);
            if (matches.has(key)) result.add(key);
          }
        }
      }
      return { id, query: tag.query, result: [...result] };
    }),
  );

  return {
    cards: [...cards.keys()],
    queries: Object.fromEntries(entries.map(entry => [entry.id, entry.query])),
    results: Object.fromEntries(entries.map(entry => [entry.id, entry.result])),
    version: 2,
  };
};

/**
 * Analyze the full shared catalogue from card metadata in-memory. Only tags
 * using Scryfall's private `otag:` classification fall back to network search.
 */
export const analyzeDeckTagsWithMetadata = async (
  cards: readonly DeckTagMatchCard[],
  tagIds: readonly string[],
  previous?: DeckTagAnalysis,
  signal?: AbortSignal,
): Promise<DeckTagAnalysis> => {
  const ids = [...new Set(tagIds)].filter(id => deckTagById(id));
  const localIds = ids.filter(id => canMatchDeckTagLocally(deckTagById(id)!.query));
  const remoteIds = ids.filter(id => !localIds.includes(id));
  const remote =
    remoteIds.length > 0
      ? await analyzeDeckTags(cards.map(card => card.name), remoteIds, previous, signal)
      : undefined;
  const keys = cards.map(card => cardKey(card.name)).filter(Boolean);
  const queries: Record<string, string> = {};
  const results: Record<string, string[]> = {};

  for (const id of localIds) {
    const tag = deckTagById(id)!;
    queries[id] = tag.query;
    results[id] = cards
      .filter(card => matchesDeckTagQuery(card, tag.query))
      .map(card => cardKey(card.name))
      .filter(Boolean);
  }
  for (const id of remoteIds) {
    const tag = deckTagById(id)!;
    queries[id] = tag.query;
    results[id] = remote?.results[id] ?? [];
  }

  return { cards: keys, queries, results, version: 2 };
};

/** Whether every current card has a result for every current tag query. */
export const deckTagAnalysisComplete = (
  names: readonly string[],
  tagIds: readonly string[],
  analysis?: DeckTagAnalysis,
): boolean => {
  if (analysis?.version !== 2) return false;
  const keys = [...new Set(names.map(cardKey).filter(Boolean))];
  const analyzed = new Set(analysis.cards);
  if (!keys.every(key => analyzed.has(key))) return false;
  return [...new Set(tagIds)].every(id => {
    const tag = deckTagById(id);
    if (!tag || analysis.queries[id] !== tag.query) return false;
    return Array.isArray(analysis.results[id]);
  });
};

export interface TagSectionBucket {
  /** Main-deck cards assigned to this tag (exclusive). */
  cards: DeckCard[];
  label: string;
  tagId: string;
}

/**
 * Partition main-deck cards into ordered tag buckets, then leftover main.
 * Commander / sideboard are left to the caller.
 *
 * `overrides` (cardKey → tag id, or `""` for Main) wins over Scryfall matching.
 */
export const bucketMainByTagSections = async (
  mainCards: readonly DeckCard[],
  tagSectionIds: readonly string[],
  signal?: AbortSignal,
  overrides?: Readonly<Record<string, string>>,
): Promise<{ buckets: TagSectionBucket[]; rest: DeckCard[] }> => {
  const ids = tagSectionIds.filter(id => deckTagById(id));
  if (ids.length === 0) return { buckets: [], rest: [...mainCards] };

  const names = mainCards.map(c => c.name);
  /** cardKey -> tag id, or '' for forced Main */
  const assigned = new Map<string, string>();

  if (overrides) {
    for (const card of mainCards) {
      const key = cardKey(card.name);
      if (!Object.prototype.hasOwnProperty.call(overrides, key)) continue;
      const ov = overrides[key];
      if (ov === '' || !ids.includes(ov)) assigned.set(key, '');
      else assigned.set(key, ov);
    }
  }

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
