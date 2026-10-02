import { comboPairKey } from './pairKey';
import type { ComboDependency, ComboLine, LuginDerivedResults, StoredCombo } from './types';

const SPELLBOOK_COMBO = 'https://commanderspellbook.com/combo/';

const ZONE: Record<string, string> = {
  B: 'battlefield',
  C: 'command zone',
  E: 'exile',
  G: 'graveyard',
  H: 'hand',
  L: 'library',
};

/** Feature-name checks. These are Lugin readings of Spellbook's result names, not fields the API returns as booleans. */
const derivedFrom = (results: readonly string[]): LuginDerivedResults => {
  const derived: LuginDerivedResults = {};
  for (const name of results) {
    if (name === 'Win the game' || name.startsWith('Win the game ')) derived.winsGame = true;
    if (name.startsWith('Near-infinite ') || name.startsWith('Infinite '))
      derived.isInfinite = true;
    if (/^(Near-infinite|Infinite) mana\b/.test(name)) derived.producesInfiniteMana = true;
    if (/^(Near-infinite|Infinite) (combat )?damage\b/.test(name))
      derived.producesInfiniteDamage = true;
    if (
      (name.startsWith('Near-infinite ') || name.startsWith('Infinite ')) &&
      /token/i.test(name)
    ) {
      derived.producesInfiniteTokens = true;
    }
    if (/extra turn/i.test(name) || name === 'Near-infinite turns') derived.extraTurns = true;
    if (/card draw/i.test(name)) derived.drawsLibrary = true;
  }
  return derived;
};

/**
 * Extra card templates, or a notable prerequisite Spellbook separated from
 * ordinary mana, mean the two names are not the whole line. `mustBeCommander`
 * on one of the two cards is Spellbook's own flag.
 */
export const comboDependency = (combo: StoredCombo): ComboDependency => {
  if (combo.req.length > 0 || combo.notable.trim().length > 0) return 'CONDITIONAL';
  if (combo.cards.some(card => card.commander)) return 'COMMANDER_DEPENDENT';
  return 'SELF_CONTAINED';
};

const prerequisitesOf = (combo: StoredCombo): string[] => {
  const lines: string[] = [];
  if (combo.mana.trim()) lines.push(`Mana: ${combo.mana.trim()}`);
  if (combo.easy.trim()) lines.push(combo.easy.trim());
  if (combo.notable.trim()) lines.push(combo.notable.trim());
  for (const req of combo.req) {
    lines.push(req.commander ? `Commander: ${req.name}` : req.name);
  }
  for (const card of combo.cards) {
    if (card.commander) lines.push(`${card.name} has to be your commander.`);
    const zones = card.zones.map(zone => ZONE[zone] ?? zone).filter(Boolean);
    if (zones.length > 0 && !(zones.length === 1 && zones[0] === 'hand')) {
      lines.push(`${card.name} starts in ${zones.join(', ')}.`);
    }
  }
  return lines;
};

export const materializeLine = (combo: StoredCombo): ComboLine => ({
  dependency: comboDependency(combo),
  derived: derivedFrom(combo.results),
  description: combo.desc,
  id: combo.id,
  mana: combo.mana,
  prerequisites: prerequisitesOf(combo),
  requiresCommander:
    combo.cards.some(card => card.commander) || combo.req.some(req => req.commander),
  results: combo.results,
  tag: combo.tag,
  url: `${SPELLBOOK_COMBO}${combo.id}/`,
});

export const storedPairKey = (combo: StoredCombo): string =>
  comboPairKey(combo.cards[0].oracleId, combo.cards[1].oracleId);
