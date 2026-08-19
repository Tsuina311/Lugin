// Deck-building tags: mechanics and themes mapped to Scryfall queries.
//
// Each tag is a searchable filter the deck editor can run to find cards matching
// a rule (keyword or oracle pattern). Multiple selected tags are AND-ed together.

import { sortWubrg } from './mtg';

export interface DeckTag {
  category: string;
  id: string;
  label: string;
  /** Scryfall search syntax for this tag (parentheses added when combining). */
  query: string;
  /** Extra words for the tag search box (synonyms, related terms). */
  terms?: string[];
}

/** Tags grouped for the picker UI — order is display order. */
export const DECK_TAG_CATEGORIES = [
  'Card advantage',
  'Combat',
  'Tokens & wide',
  'Counters',
  'Graveyard',
  'Removal',
  'Mana',
  'Life',
  'Spells',
  'Artifacts & enchantments',
  'Tribal',
  'Triggers',
] as const;

export const DECK_TAGS: DeckTag[] = [
  // Card advantage
  { category: 'Card advantage', id: 'draw', label: 'Draw cards', query: 'o:"draw"', terms: ['cantrip', 'card advantage'] },
  { category: 'Card advantage', id: 'draw-on-cast', label: 'Draw when you cast', query: 'o:"whenever you cast" o:"draw"', terms: ['spellslinger'] },
  { category: 'Card advantage', id: 'wheel', label: 'Wheel', query: 'o:"each player discards" o:"draw"', terms: ['mass discard'] },
  { category: 'Card advantage', id: 'loot', label: 'Loot / rummage', query: 'o:"draw" o:"discard"', terms: ['filter'] },
  { category: 'Card advantage', id: 'surveil', label: 'Surveil', query: 'keyword:surveil' },
  { category: 'Card advantage', id: 'explore', label: 'Explore', query: 'keyword:explore' },
  { category: 'Card advantage', id: 'mill-opp', label: 'Mill opponents', query: 'o:"mill"', terms: ['library'] },
  { category: 'Card advantage', id: 'self-mill', label: 'Self-mill', query: 'o:"put" o:"cards" o:"your" o:"graveyard" o:"library"', terms: ['dredge setup'] },
  { category: 'Card advantage', id: 'discard-opp', label: 'Make opponents discard', query: 'o:"discards a card"', terms: ['rack', 'hand attack'] },
  { category: 'Card advantage', id: 'self-discard', label: 'Self-discard', query: 'o:"discard" o:"you"', terms: ['madness'] },
  { category: 'Card advantage', id: 'madness', label: 'Madness', query: 'keyword:madness' },
  { category: 'Card advantage', id: 'scry', label: 'Scry', query: 'o:scry', terms: ['top of library'] },

  // Combat
  { category: 'Combat', id: 'flying', label: 'Flying', query: 'keyword:flying', terms: ['evasion'] },
  { category: 'Combat', id: 'first-strike', label: 'First strike', query: 'keyword:"first strike"' },
  { category: 'Combat', id: 'double-strike', label: 'Double strike', query: 'keyword:"double strike"', terms: ['voltron'] },
  { category: 'Combat', id: 'trample', label: 'Trample', query: 'keyword:trample', terms: ['stompy'] },
  { category: 'Combat', id: 'deathtouch', label: 'Deathtouch', query: 'keyword:deathtouch' },
  { category: 'Combat', id: 'lifelink', label: 'Lifelink', query: 'keyword:lifelink' },
  { category: 'Combat', id: 'vigilance', label: 'Vigilance', query: 'keyword:vigilance' },
  { category: 'Combat', id: 'reach', label: 'Reach', query: 'keyword:reach', terms: ['anti-flying'] },
  { category: 'Combat', id: 'haste', label: 'Haste', query: 'keyword:haste', terms: ['aggro'] },
  { category: 'Combat', id: 'menace', label: 'Menace', query: 'keyword:menace' },
  { category: 'Combat', id: 'hexproof', label: 'Hexproof', query: 'keyword:hexproof', terms: ['protection'] },
  { category: 'Combat', id: 'ward', label: 'Ward', query: 'keyword:ward' },
  { category: 'Combat', id: 'indestructible', label: 'Indestructible', query: 'keyword:indestructible' },
  { category: 'Combat', id: 'flash', label: 'Flash', query: 'keyword:flash', terms: ['instant speed'] },
  { category: 'Combat', id: 'fight', label: 'Fight / bite', query: '(keyword:fight or keyword:bite)' },
  { category: 'Combat', id: 'prowess', label: 'Prowess', query: 'keyword:prowess', terms: ['spells'] },

  // Tokens
  { category: 'Tokens & wide', id: 'tokens', label: 'Create tokens', query: 'o:"create" o:"token"', terms: ['go wide'] },
  { category: 'Tokens & wide', id: 'anthem', label: 'Anthem effects', query: 'o:"creatures you control get"', terms: ['lord', 'pump'] },
  { category: 'Tokens & wide', id: 'populate', label: 'Populate', query: 'keyword:populate' },
  { category: 'Tokens & wide', id: 'convoke', label: 'Convoke', query: 'keyword:convoke' },
  { category: 'Tokens & wide', id: 'improvise', label: 'Improvise', query: 'keyword:improvise' },
  { category: 'Tokens & wide', id: 'affinity', label: 'Affinity', query: 'keyword:affinity', terms: ['artifacts'] },
  { category: 'Tokens & wide', id: 'ninjutsu', label: 'Ninjutsu', query: 'keyword:ninjutsu' },

  // Counters
  { category: 'Counters', id: 'plus-one', label: '+1/+1 counters', query: 'o:"+1/+1 counter"', terms: ['go tall'] },
  { category: 'Counters', id: 'proliferate', label: 'Proliferate', query: 'keyword:proliferate' },
  { category: 'Counters', id: 'adapt', label: 'Adapt', query: 'keyword:adapt' },
  { category: 'Counters', id: 'modular', label: 'Modular', query: 'keyword:modular' },
  { category: 'Counters', id: 'evolve', label: 'Evolve', query: 'keyword:evolve' },

  // Graveyard
  { category: 'Graveyard', id: 'reanimate', label: 'Reanimate', query: 'o:"return" o:"creature" o:"graveyard" o:"battlefield"', terms: ['recursion'] },
  { category: 'Graveyard', id: 'recursion', label: 'Graveyard recursion', query: 'o:"return" o:"from your graveyard"', terms: ['regrowth'] },
  { category: 'Graveyard', id: 'flashback', label: 'Flashback', query: 'keyword:flashback' },
  { category: 'Graveyard', id: 'unearth', label: 'Unearth', query: 'keyword:unearth' },
  { category: 'Graveyard', id: 'escape', label: 'Escape', query: 'keyword:escape' },
  { category: 'Graveyard', id: 'disturb', label: 'Disturb', query: 'keyword:disturb' },
  { category: 'Graveyard', id: 'dredge', label: 'Dredge', query: 'keyword:dredge' },
  { category: 'Graveyard', id: 'delve', label: 'Delve', query: 'keyword:delve' },
  { category: 'Graveyard', id: 'grave-hate', label: 'Graveyard hate', query: 'o:"exile target" o:"graveyard"', terms: ['rest in peace'] },

  // Removal
  { category: 'Removal', id: 'destroy-creature', label: 'Destroy creature', query: 'o:"destroy target creature"' },
  { category: 'Removal', id: 'destroy-any', label: 'Destroy permanent', query: 'o:"destroy target"' },
  { category: 'Removal', id: 'exile', label: 'Exile', query: 'o:"exile target"' },
  { category: 'Removal', id: 'bounce', label: 'Bounce to hand', query: 'o:"return" o:"to" o:"hand"', terms: ['tempo'] },
  { category: 'Removal', id: 'board-wipe', label: 'Board wipe', query: 'o:"destroy all creatures"', terms: ['sweeper'] },
  { category: 'Removal', id: 'counterspell', label: 'Counterspell', query: 'o:"counter target"', terms: ['stack'] },
  { category: 'Removal', id: 'burn', label: 'Direct damage', query: 'o:"damage" o:"any target"', terms: ['burn', 'bolt'] },
  { category: 'Removal', id: 'fight-removal', label: 'Fight as removal', query: 'keyword:fight', terms: ['prey upon'] },

  // Mana
  { category: 'Mana', id: 'ramp', label: 'Ramp', query: 'o:"add {"', terms: ['mana dork', 'mana rock'] },
  { category: 'Mana', id: 'land-ramp', label: 'Land search', query: 'o:"search" o:"land" o:"library"', terms: ['cultivate'] },
  { category: 'Mana', id: 'extra-land', label: 'Extra land drop', query: 'o:"additional land"', terms: ['exploration'] },
  { category: 'Mana', id: 'landfall', label: 'Landfall', query: 'keyword:landfall' },
  { category: 'Mana', id: 'treasure', label: 'Treasure tokens', query: 'o:"Treasure token"' },
  { category: 'Mana', id: 'ritual', label: 'Mana ritual', query: 'o:"add" o:"until end of turn"', terms: ['dark ritual'] },
  { category: 'Mana', id: 'cost-reduction', label: 'Cost reduction', query: 'o:"cost" o:"less"', terms: ['emperor'] },
  { category: 'Mana', id: 'cascade', label: 'Cascade', query: 'keyword:cascade' },

  // Life
  { category: 'Life', id: 'lifegain', label: 'Lifegain', query: 'o:"gain" o:"life"', terms: ['life gain'] },
  { category: 'Life', id: 'drain', label: 'Life drain', query: 'o:"loses" o:"life" o:"gain"', terms: ['extort'] },
  { category: 'Life', id: 'pay-life', label: 'Pay life', query: 'o:"pay" o:"life"', terms: ['necropotence'] },

  // Spells
  { category: 'Spells', id: 'instant-sorcery', label: 'Instants & sorceries', query: '(t:instant or t:sorcery)' },
  { category: 'Spells', id: 'spells-matter', label: 'Spells matter', query: 'o:"instant or sorcery"', terms: ['magecraft'] },
  { category: 'Spells', id: 'storm', label: 'Storm', query: 'keyword:storm' },
  { category: 'Spells', id: 'magecraft', label: 'Magecraft', query: 'keyword:magecraft' },
  { category: 'Spells', id: 'copy-spell', label: 'Copy spells', query: 'o:"copy" o:"spell"', terms: ['twincast'] },

  // Artifacts & enchantments
  { category: 'Artifacts & enchantments', id: 'artifacts', label: 'Artifacts', query: 't:artifact', terms: ['artifact matters'] },
  { category: 'Artifacts & enchantments', id: 'enchantments', label: 'Enchantments', query: 't:enchantment', terms: ['enchantress'] },
  { category: 'Artifacts & enchantments', id: 'constellation', label: 'Constellation', query: 'keyword:constellation' },
  { category: 'Artifacts & enchantments', id: 'equipment', label: 'Equipment', query: 't:equipment', terms: ['voltron'] },
  { category: 'Artifacts & enchantments', id: 'aura', label: 'Auras', query: 't:aura', terms: ['voltron'] },
  { category: 'Artifacts & enchantments', id: 'sacrifice-outlet', label: 'Sacrifice outlets', query: 'o:"sacrifice" o:":"', terms: ['aristocrats'] },

  // Tribal
  { category: 'Tribal', id: 'tribe-elf', label: 'Elves', query: 't:elf', terms: ['tribal'] },
  { category: 'Tribal', id: 'tribe-goblin', label: 'Goblins', query: 't:goblin' },
  { category: 'Tribal', id: 'tribe-zombie', label: 'Zombies', query: 't:zombie' },
  { category: 'Tribal', id: 'tribe-vampire', label: 'Vampires', query: 't:vampire' },
  { category: 'Tribal', id: 'tribe-dragon', label: 'Dragons', query: 't:dragon' },
  { category: 'Tribal', id: 'tribe-merfolk', label: 'Merfolk', query: 't:merfolk' },
  { category: 'Tribal', id: 'tribe-wizard', label: 'Wizards', query: 't:wizard' },
  { category: 'Tribal', id: 'tribe-soldier', label: 'Soldiers', query: 't:soldier' },
  { category: 'Tribal', id: 'tribe-angel', label: 'Angels', query: 't:angel' },
  { category: 'Tribal', id: 'tribe-demon', label: 'Demons', query: 't:demon' },
  { category: 'Tribal', id: 'tribe-cat', label: 'Cats', query: 't:cat' },
  { category: 'Tribal', id: 'tribe-dinosaur', label: 'Dinosaurs', query: 't:dinosaur' },
  { category: 'Tribal', id: 'tribe-sliver', label: 'Slivers', query: 't:sliver' },

  // Triggers
  { category: 'Triggers', id: 'etb', label: 'Enter the battlefield', query: 'o:"enters the battlefield"', terms: ['etb', 'blink'] },
  { category: 'Triggers', id: 'dies', label: 'Dies trigger', query: 'o:"when" o:"dies"', terms: ['aristocrats', 'death trigger'] },
  { category: 'Triggers', id: 'attack-trigger', label: 'Attack trigger', query: 'o:"whenever" o:"attacks"' },
  { category: 'Triggers', id: 'cast-trigger', label: 'Cast trigger', query: 'o:"whenever you cast"' },
  { category: 'Triggers', id: 'lifegain-trigger', label: 'Whenever you gain life', query: 'o:"whenever you gain life"' },
  { category: 'Triggers', id: 'token-created', label: 'Whenever you create tokens', query: 'o:"whenever you create"' },
];

const BY_ID = new Map(DECK_TAGS.map(tag => [tag.id, tag]));

export const deckTagById = (id: string): DeckTag | undefined => BY_ID.get(id);

/** Filter the catalogue by label, category, id, or synonym. */
export const filterDeckTags = (needle: string, tags: readonly DeckTag[] = DECK_TAGS): DeckTag[] => {
  const q = needle.trim().toLowerCase();
  if (!q) return [...tags];
  return tags.filter(
    tag =>
      tag.label.toLowerCase().includes(q) ||
      tag.category.toLowerCase().includes(q) ||
      tag.id.includes(q) ||
      (tag.terms ?? []).some(term => term.toLowerCase().includes(q)),
  );
};

/** Tags grouped by category for the picker. */
export const deckTagsByCategory = (
  tags: readonly DeckTag[] = DECK_TAGS,
): { category: string; tags: DeckTag[] }[] => {
  const groups = new Map<string, DeckTag[]>();
  for (const tag of tags) {
    const list = groups.get(tag.category) ?? [];
    list.push(tag);
    groups.set(tag.category, list);
  }
  return DECK_TAG_CATEGORIES.filter(c => groups.has(c)).map(category => ({
    category,
    tags: groups.get(category) ?? [],
  }));
};

/**
 * Build a Scryfall query from selected tag ids. Tags are AND-ed. Optional
 * commander identity restricts to legal cards.
 */
export const buildTagsQuery = (tagIds: readonly string[], identity?: string[]): string => {
  const parts: string[] = [];
  for (const id of tagIds) {
    const tag = BY_ID.get(id);
    if (tag) parts.push(`(${tag.query})`);
  }
  if (identity) {
    parts.push(identity.length === 0 ? 'id=c' : `id<=${sortWubrg([...identity]).join('').toLowerCase()}`);
  }
  return parts.join(' ');
};
