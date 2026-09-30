// Infer which synced want list best matches a cart / Wizard plan so we can
// probe sellers with Cardmarket’s ?idWantslist= filter.

import { cardKey, stripVersion } from '@/lib/cardName';
import type { WantsIndex } from '@/sites/cardmarket/wants';

const wantKeyOf = (name: string): string => stripVersion(cardKey(name));

export const inferWantListForCart = (
  index: WantsIndex | null | undefined,
  cartNames: readonly string[],
): { id: string; name: string; hitCount: number; cartKeys: number } | null => {
  if (!index?.lists?.length || cartNames.length === 0) return null;
  const cartKeys = new Set(cartNames.map(wantKeyOf).filter(Boolean));
  if (cartKeys.size === 0) return null;

  let best: { id: string; name: string; hitCount: number; cartKeys: number } | null = null;
  for (const list of index.lists) {
    let hitCount = 0;
    for (const entry of Object.values(index.cards ?? {})) {
      const here = entry.placements?.some(p => p.listId === list.id);
      if (!here && !entry.lists.includes(list.name)) continue;
      const key = stripVersion(cardKey(entry.name));
      if (key && cartKeys.has(key)) hitCount++;
    }
    if (!best || hitCount > best.hitCount) {
      best = { id: list.id, name: list.name, hitCount, cartKeys: cartKeys.size };
    }
  }
  return best && best.hitCount > 0 ? best : null;
};
