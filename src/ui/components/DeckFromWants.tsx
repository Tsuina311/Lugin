import { useMemo, useState, useSyncExternalStore } from 'react';

import { Button } from './Button';
import { Select } from './Field';
import { ClipboardList } from './icons';

import { wantsStore } from '@/content/wantsStore';
import { cardKey } from '@/lib/cardName';
import type { WantsIndex } from '@/sites/cardmarket/wants';

// Pulling a want list back into a deck.
//
// The deck editor can already turn a deck into a want list of everything you
// don't own; this is that trip in reverse, which is what you want when the deck
// is gone and the shopping list is the only record of what was in it.
//
// One copy per card, because that's all the index knows: it records which lists
// hold a card, not how many were wanted. Quantities are a two-second fix in the
// deck list and not worth a slower, per-list fetch to get right.

/** Group the index's cards by the list they sit in, in the lists' own order. */
const byList = (index: WantsIndex | null): { cards: string[]; id: string; name: string }[] => {
  if (!index) return [];

  const cards = new Map<string, Set<string>>();
  const idOf = new Map<string, string>();
  for (const list of index.lists) {
    cards.set(list.id, new Set());
    idOf.set(list.name, list.id);
  }

  for (const entry of Object.values(index.cards)) {
    // Placements are exact. The name list is the fallback for cards indexed
    // before placements were recorded, and can only be matched by list name.
    const ids =
      entry.placements && entry.placements.length > 0
        ? entry.placements.map(p => p.listId)
        : entry.lists.map(name => idOf.get(name));
    for (const id of ids) if (id !== undefined) cards.get(id)?.add(entry.name);
  }

  return index.lists.map(list => ({
    cards: [...(cards.get(list.id) ?? [])],
    id: list.id,
    name: list.name,
  }));
};

export const DeckFromWants = ({
  inDeck,
  onAdd,
}: {
  /** cardKey -> how many are already in the deck. */
  inDeck: Record<string, number>;
  onAdd: (names: string[]) => void;
}) => {
  const { index } = useSyncExternalStore(wantsStore.subscribe, wantsStore.getSnapshot);
  const lists = useMemo(() => byList(index), [index]);
  const [pick, setPick] = useState<string | null>(null);

  // Nothing synced yet means nothing to offer, and a section explaining that
  // would be clutter to everyone who doesn't keep want lists.
  if (lists.length === 0) return null;

  const chosen = lists.find(l => l.id === pick) ?? lists[0];
  const missing = chosen.cards.filter(name => !inDeck[cardKey(name)]);
  const already = chosen.cards.length - missing.length;

  return (
    <div className="space-y-1.5 border-t border-line pt-2">
      <p className="flex items-center gap-1 text-2xs font-semibold uppercase tracking-wide text-ink-faint">
        <ClipboardList aria-hidden size={11} />
        From a want list
      </p>

      <Select
        aria-label="Want list to add cards from"
        className="w-full"
        onChange={e => setPick(e.target.value)}
        value={chosen.id}
      >
        {lists.map(list => (
          <option key={list.id} value={list.id}>
            {list.name} ({list.cards.length})
          </option>
        ))}
      </Select>

      <div className="flex items-center gap-1.5">
        <Button
          disabled={missing.length === 0}
          onClick={() => onAdd(missing)}
          title={
            missing.length === 0
              ? 'Every card in this list is already in the deck'
              : `Add ${missing.length} card${missing.length === 1 ? '' : 's'} from ${chosen.name}, one copy each`
          }
          variant="neutral"
        >
          {missing.length === 0 ? 'All here' : `Add ${missing.length}`}
        </Button>
        {already > 0 && (
          <span className="text-2xs text-ink-faint">
            {already} already {missing.length === 0 ? 'in the deck' : 'here'}
          </span>
        )}
      </div>
    </div>
  );
};
