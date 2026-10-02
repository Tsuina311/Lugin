// The commander picker asks Scryfall for cards that can legally lead a
// Commander deck and that actually have rules text. A vanilla legendary is a
// legal commander and a dull one; `o:/./` is "the oracle text has a character".

import { deckTagById } from './deckTags';
import { sortWubrg } from './mtg';

export const COMMANDER_RARITIES = ['common', 'uncommon', 'rare', 'mythic'] as const;

export type CommanderRarity = (typeof COMMANDER_RARITIES)[number];

export interface CommanderQuery {
  /** Colorless commanders only. Wins over `identity`. */
  colorless?: boolean;
  /** Colors the commander's identity must fit inside. */
  identity?: string[];
  name?: string;
  rarities?: readonly string[];
  tagIds?: readonly string[];
}

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'mythic'];

/**
 * Scryfall query for the picker. Always legal commanders with some oracle text.
 */
export const commanderQuery = (options: CommanderQuery = {}): string => {
  const parts = ['is:commander', 'legal:commander', 'o:/./', 'game:paper'];

  const name = options.name?.trim().replace(/"/g, '') ?? '';
  for (const word of name.split(/\s+/)) {
    if (/[a-z0-9]/i.test(word)) parts.push(`name:${word}`);
  }

  if (options.colorless) parts.push('id=c');
  else if (options.identity && options.identity.length > 0) {
    parts.push(`id<=${sortWubrg([...options.identity]).join('').toLowerCase()}`);
  }

  const rarities = RARITY_ORDER.filter(rarity => options.rarities?.includes(rarity));
  if (rarities.length === 1) parts.push(`r:${rarities[0]}`);
  else if (rarities.length > 1) parts.push(`(${rarities.map(rarity => `r:${rarity}`).join(' or ')})`);

  for (const id of options.tagIds ?? []) {
    const tag = deckTagById(id);
    if (tag) parts.push(`(${tag.query})`);
  }

  return parts.join(' ');
};
