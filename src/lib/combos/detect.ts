import { materializeLine } from './materialize';
import { comboPairKey } from './pairKey';
import type { ComboAnalysis, ComboBundle, ComboLine, DeckComboCard, DetectedPair } from './types';

import { cardKey } from '@/lib/cardName';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Strongest Spellbook tag first. Variants of one pair inherit this for the bracket note. */
const TAG_RANK: Record<ComboLine['tag'], number> = {
  B: 0,
  C: 2,
  E: 1,
  O: 3,
  P: 4,
  R: 6,
  S: 5,
};

const resolveOracleId = (card: DeckComboCard, names: ComboBundle['names']): string | null => {
  if (card.oracleId && UUID.test(card.oracleId)) return card.oracleId.toLowerCase();
  const fromName = names[cardKey(card.name)];
  return fromName ? fromName.toLowerCase() : null;
};

/**
 * Known two-card lines in this deck. Commander cards count. Sideboard does not.
 * One Spellbook pair with several variants comes back as one group.
 */
export const findTwoCardCombos = (
  cards: readonly DeckComboCard[],
  bundle: ComboBundle,
): ComboAnalysis => {
  const playing = cards.filter(card => card.section !== 'sideboard');
  const qty = new Map<string, number>();
  const names = new Map<string, string>();
  const commanders = new Set<string>();
  let unresolved = 0;
  let pending = 0;

  for (const card of playing) {
    const oracleId = resolveOracleId(card, bundle.names);
    if (!oracleId) {
      if (card.unresolved) unresolved += 1;
      else pending += 1;
      continue;
    }
    qty.set(oracleId, (qty.get(oracleId) ?? 0) + (card.quantity > 0 ? card.quantity : 1));
    if (!names.has(oracleId)) names.set(oracleId, card.name);
    if (card.section === 'commander') commanders.add(oracleId);
  }

  const ids = [...qty.keys()].sort();
  const pairs: DetectedPair[] = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const pairKey = comboPairKey(ids[i], ids[j]);
      const variantIds = bundle.pairs[pairKey];
      if (!variantIds || variantIds.length === 0) continue;
      const lines = variantIds
        .map(id => bundle.combos[id])
        .filter(combo => {
          if (!combo) return false;
          const [left, right] = combo.cards;
          return (
            (qty.get(left.oracleId.toLowerCase()) ?? 0) >= left.qty &&
            (qty.get(right.oracleId.toLowerCase()) ?? 0) >= right.qty
          );
        })
        .map(combo => materializeLine(combo))
        .sort((a, b) => TAG_RANK[b.tag] - TAG_RANK[a.tag] || a.id.localeCompare(b.id));
      if (lines.length === 0) continue;
      const [leftId, rightId] = pairKey.split('|');
      const stored = bundle.combos[lines[0].id];
      if (!stored) continue;
      const cardById = new Map(stored.cards.map(card => [card.oracleId.toLowerCase(), card.name]));
      pairs.push({
        cards: [
          { name: names.get(leftId) || cardById.get(leftId) || leftId, oracleId: leftId },
          { name: names.get(rightId) || cardById.get(rightId) || rightId, oracleId: rightId },
        ],
        lead: lines[0],
        lines,
        pairKey,
        usesCommander: commanders.has(leftId) || commanders.has(rightId),
      });
    }
  }
  pairs.sort(
    (a, b) =>
      a.cards[0].name.localeCompare(b.cards[0].name) ||
      a.cards[1].name.localeCompare(b.cards[1].name),
  );
  return {
    pairs,
    pending,
    resolved: qty.size,
    total: playing.length,
    unresolved,
  };
};
