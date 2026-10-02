
import { comboPairKey } from './pairKey';
import type { ComboBundle, SpellbookBracketTag, StoredCombo, StoredComboCard } from './types';

import { cardKey } from '@/lib/cardName';


const TAGS = new Set<string>(['B', 'C', 'E', 'O', 'P', 'R', 'S']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE = 'https://backend.commanderspellbook.com/variants/?q=cards%3D2';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const reject = (message: string): never => {
  throw new Error(`Combo index rejected: ${message}`);
};

/**
 * Turn a Spellbook `cards=2` variant list into the compact runtime index.
 * Commander-legal, status OK, exactly two distinct oracle ids. A malformed
 * variant fails the whole build so a bad page is never cached.
 */
export const compileTwoCardIndex = (variants: readonly unknown[], sourceVersion: string): ComboBundle => {
  const combos: ComboBundle['combos'] = {};
  for (const variant of variants) {
    const built = readVariant(variant);
    if (!built?.legal) continue;
    combos[built.id] = built;
  }
  if (Object.keys(combos).length === 0) reject('no Commander-legal two-card combos');

  const pairs: ComboBundle['pairs'] = {};
  const names: ComboBundle['names'] = {};
  for (const combo of Object.values(combos)) {
    const key = comboPairKey(combo.cards[0].oracleId, combo.cards[1].oracleId);
    const list = pairs[key] ?? [];
    list.push(combo.id);
    pairs[key] = list;
    for (const piece of combo.cards) names[cardKey(piece.name)] = piece.oracleId;
  }
  for (const ids of Object.values(pairs)) ids.sort();

  return {
    combos,
    metadata: {
      comboCount: Object.keys(combos).length,
      generatedAt: new Date().toISOString(),
      pairCount: Object.keys(pairs).length,
      productionBundle: false,
      provider: 'Commander Spellbook',
      redistribution: 'not-cleared',
      schema: 1,
      sha256: { combos: 'local', pairs: 'local', runtime: 'local' },
      sourceUrl: SOURCE,
      sourceVersion,
    },
    names,
    pairs,
  };
};

const readVariant = (value: unknown): StoredCombo | null => {
  if (!isRecord(value)) return reject('a variant is not an object');
  if (typeof value.id !== 'string') return reject('a variant has no id');
  const id = value.id;
  if (!Array.isArray(value.uses)) return reject(`${id} has no uses`);
  if (value.uses.length !== 2) return null;
  const left = readUse(value.uses[0], id);
  const right = readUse(value.uses[1], id);
  if (!left || !right) return null;
  if (left.oracleId === right.oracleId) return null;
  const cards = [left, right].sort((a, b) => (a.oracleId < b.oracleId ? -1 : 1)) as StoredCombo['cards'];
  if (typeof value.bracketTag !== 'string' || !TAGS.has(value.bracketTag)) {
    return reject(`${id} has bracket tag ${String(value.bracketTag)}`);
  }
  if (typeof value.status !== 'string') return reject(`${id} has no status`);
  if (value.status !== 'OK') return null;
  const legalities = isRecord(value.legalities) ? value.legalities : {};
  const req = Array.isArray(value.requires)
    ? value.requires.flatMap(item => {
        if (!isRecord(item)) return [];
        const template = isRecord(item.template) ? item.template : {};
        return typeof template.name === 'string' && template.name
          ? [{ commander: item.mustBeCommander === true, name: template.name }]
          : [];
      })
    : [];
  const results = Array.isArray(value.produces)
    ? value.produces.flatMap(item => {
        if (!isRecord(item)) return [];
        const feature = isRecord(item.feature) ? item.feature : {};
        return typeof feature.name === 'string' && feature.name ? [feature.name] : [];
      })
    : [];
  const desc = typeof value.description === 'string' ? value.description.trim() : '';
  return {
    cards,
    desc: desc.length > 1200 ? `${desc.slice(0, 1199)}…` : desc,
    easy: typeof value.easyPrerequisites === 'string' ? value.easyPrerequisites.trim() : '',
    id,
    legal: legalities.commander === true,
    mana: typeof value.manaNeeded === 'string' ? value.manaNeeded : '',
    mv: typeof value.manaValueNeeded === 'number' ? value.manaValueNeeded : 0,
    notable: typeof value.notablePrerequisites === 'string' ? value.notablePrerequisites.trim() : '',
    req,
    results,
    status: value.status,
    tag: value.bracketTag as SpellbookBracketTag,
  };
};

const readUse = (value: unknown, id: string): StoredComboCard | null => {
  if (!isRecord(value)) return reject(`${id} has a use that is not an object`);
  const card = isRecord(value.card) ? value.card : reject(`${id} has a card that is not an object`);
  if (typeof card.name !== 'string' || !card.name.trim()) return reject(`${id} has a card with no name`);
  if (typeof card.oracleId !== 'string' || !UUID.test(card.oracleId)) return null;
  const zones = Array.isArray(value.zoneLocations)
    ? value.zoneLocations.filter((zone): zone is string => typeof zone === 'string')
    : [];
  return {
    commander: value.mustBeCommander === true,
    name: card.name,
    oracleId: card.oracleId.toLowerCase(),
    qty: typeof value.quantity === 'number' && value.quantity > 0 ? value.quantity : 1,
    zones,
  };
};
