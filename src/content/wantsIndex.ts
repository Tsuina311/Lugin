// Edits to the local wants index, as plain functions over the data.
//
// Renaming or emptying a want list on Cardmarket costs one request; rebuilding
// the index costs one per list, so the index is patched to match instead. These
// are pure so that the patching — the part that quietly goes wrong — can be
// checked on its own.

import { cardKey, stripVersion } from '@/lib/cardName';
import type { WantPlacement, WantsIndex } from '@/sites/cardmarket/wants';

/** One card as a want list holds it. */
export interface ListCard {
  /** The other lists that want it too, by name. */
  alsoOn: string[];
  /** The per-list want id, for removing this one membership. */
  idWant: string;
  key: string;
  name: string;
}

/** What a want list holds, by the local index, in name order. */
export const listCards = (index: WantsIndex | null, listId: string): ListCard[] => {
  const out: ListCard[] = [];
  for (const [key, entry] of Object.entries(index?.cards ?? {})) {
    const here = entry.placements?.find(p => p.listId === listId);
    if (!here) continue;
    out.push({
      alsoOn: entry.lists.filter(name => name !== here.listName),
      idWant: here.idWant,
      key,
      name: entry.name,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
};

/** How many cards each list holds, by list id, in one pass over the index. */
export const cardCounts = (index: WantsIndex | null): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const entry of Object.values(index?.cards ?? {})) {
    for (const p of entry.placements ?? []) counts.set(p.listId, (counts.get(p.listId) ?? 0) + 1);
  }
  return counts;
};

/**
 * Drop the placements a predicate rejects, and with them any card left on no
 * list at all. Cards from an index built before placements were recorded have
 * none to judge, and are left as they are rather than deleted on no evidence.
 */
const prune = (
  index: WantsIndex,
  keep: (p: WantPlacement) => boolean,
): { cards: WantsIndex['cards']; removed: Map<string, number> } => {
  const cards: WantsIndex['cards'] = {};
  const removed = new Map<string, number>();

  for (const [key, entry] of Object.entries(index.cards ?? {})) {
    const placements = entry.placements ?? [];
    if (placements.length === 0) {
      cards[key] = entry;
      continue;
    }
    const kept = placements.filter(keep);
    for (const p of placements) {
      if (!keep(p)) removed.set(p.listId, (removed.get(p.listId) ?? 0) + 1);
    }
    if (kept.length === 0) continue;
    const names = new Set(kept.map(p => p.listName));
    cards[key] = {
      ...entry,
      lists: entry.lists.filter(name => names.has(name)),
      placements: kept,
    };
  }
  return { cards, removed };
};

/** Forget one or more wants, each identified by the list it's on. */
export const dropWants = (
  index: WantsIndex,
  wants: readonly { idWant: string; listId: string }[],
): WantsIndex => {
  const gone = new Set(wants.map(w => `${w.listId}|${w.idWant}`));
  const { cards, removed } = prune(index, p => !gone.has(`${p.listId}|${p.idWant}`));
  return {
    ...index,
    cards,
    lists: index.lists.map(l =>
      removed.has(l.id)
        ? { ...l, extracted: Math.max(0, l.extracted - (removed.get(l.id) ?? 0)) }
        : l,
    ),
  };
};

/** Forget a whole list and every want on it. */
export const dropList = (index: WantsIndex, listId: string): WantsIndex => ({
  ...index,
  cards: prune(index, p => p.listId !== listId).cards,
  lists: index.lists.filter(l => l.id !== listId),
});

/** Recompute each card's list *names* from the placements it's left with. */
const named = (cards: WantsIndex['cards']): WantsIndex['cards'] => {
  const out: WantsIndex['cards'] = {};
  for (const [key, entry] of Object.entries(cards)) {
    const placements = entry.placements;
    out[key] = placements
      ? { ...entry, lists: [...new Set(placements.map(p => p.listName))] }
      : entry;
  }
  return out;
};

/**
 * Hand wants from one list to another, keeping their ids.
 *
 * A moved want keeps its `idWant` — the site's own bulk move sends the same ids
 * back on the next page — so a move is knowable without asking, and shows up at
 * once instead of after a round trip. A card the target already wants keeps the
 * placement it has: the site merges the two, and only a re-read can say into
 * what.
 */
export const moveWants = (
  index: WantsIndex,
  from: string,
  to: { id: string; name: string },
  idWants: readonly string[],
): WantsIndex => {
  const moving = new Set(idWants);
  const cards: WantsIndex['cards'] = {};
  let moved = 0;

  for (const [key, entry] of Object.entries(index.cards ?? {})) {
    const placements = entry.placements;
    if (!placements) {
      cards[key] = entry;
      continue;
    }
    const alreadyThere = placements.some(p => p.listId === to.id);
    const kept = placements.flatMap(p => {
      if (p.listId !== from || !moving.has(p.idWant)) return [p];
      moved++;
      if (alreadyThere) return [];
      return [{ idWant: p.idWant, listId: to.id, listName: to.name }];
    });
    if (kept.length > 0) cards[key] = { ...entry, placements: kept };
  }

  const known = index.lists.some(l => l.id === to.id);
  const lists = index.lists.map(l => {
    if (l.id === from) return { ...l, extracted: Math.max(0, l.extracted - moved) };
    if (l.id === to.id) return { ...l, extracted: l.extracted + moved };
    return l;
  });
  return {
    ...index,
    cards: named(cards),
    lists: known ? lists : [...lists, { expected: moved, extracted: moved, ...to }],
  };
};

/**
 * Replace everything the index believes about one list with what the list
 * actually holds. Used after a move or copy, where the wants land with ids only
 * Cardmarket knows, so the list is re-read rather than guessed at.
 */
export const setListWants = (
  index: WantsIndex,
  list: { id: string; name: string },
  rows: readonly { idWant: string; name: string }[],
): WantsIndex => {
  const cards = { ...prune(index, p => p.listId !== list.id).cards };

  for (const row of rows) {
    const key = cardKey(row.name);
    if (!key) continue;
    const entry = cards[key] ?? { lists: [], name: stripVersion(row.name), placements: [] };
    cards[key] = {
      ...entry,
      lists: entry.lists.includes(list.name) ? entry.lists : [...entry.lists, list.name],
      placements: [
        ...(entry.placements ?? []),
        { idWant: row.idWant, listId: list.id, listName: list.name },
      ],
    };
  }

  const known = index.lists.some(l => l.id === list.id);
  return {
    ...index,
    cards,
    lists: known
      ? index.lists.map(l =>
          l.id === list.id ? { ...l, expected: rows.length, extracted: rows.length } : l,
        )
      : [...index.lists, { expected: rows.length, extracted: rows.length, ...list }],
  };
};

/**
 * Rename a list wherever the index names it.
 *
 * Cards carry list *names*, not ids, so a rename that only touched the list
 * table would leave every card pointing at a list that no longer exists.
 */
export const renameList = (index: WantsIndex, listId: string, name: string): WantsIndex => {
  const before = index.lists.find(l => l.id === listId)?.name;
  const lists = index.lists.map(l => (l.id === listId ? { ...l, name } : l));
  if (before === undefined || before === name) return { ...index, lists };

  const cards: WantsIndex['cards'] = {};
  for (const [key, entry] of Object.entries(index.cards ?? {})) {
    cards[key] = {
      ...entry,
      lists: entry.lists.map(n => (n === before ? name : n)),
      placements: entry.placements?.map(p => (p.listId === listId ? { ...p, listName: name } : p)),
    };
  }
  return { ...index, cards, lists };
};
