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
  'Artifact tokens',
  'Counters',
  'Graveyard',
  'Removal',
  'Mana',
  'Life',
  'Win conditions',
  'Spells',
  'Artifacts & enchantments',
  'Types & themes',
  'Permanent effects',
  'Tribal',
  'Triggers',
] as const;

/** Creatures of a tribe plus payoffs that reference it in oracle text. */
const tribeQuery = (type: string): string => `(t:${type} or o:${type})`;

/**
 * A card type (Room, Battle, Gate, …) plus oracle payoffs that name it.
 * Prefer phrases that mean the type (`"a Room"`, `"Rooms you"`) over bare
 * English words (`door`, `case`) — those match half the catalogue and make
 * Scryfall slow enough to 429 under normal use.
 */
const typeThemeQuery = (type: string, extraOracle: string[] = []): string => {
  const parts = [
    `t:${type}`,
    `o:"a ${type}"`,
    `o:"${type}s you"`,
    ...extraOracle.map(o => (/\s/.test(o) || /^[A-Z]/.test(o) ? `o:"${o}"` : `o:${o}`)),
  ];
  return `(${parts.join(' or ')})`;
};

/**
 * Named artifact tokens (Treasure, Clue, Blood, …) and the cards that make or
 * care about them. Stick to `"X token"` / `"a X"` / `Xs` — bare words like
 * `o:gold` or `o:map` are common English and explode the result set.
 */
const artifactTokenQuery = (
  singular: string,
  opts: { article?: 'a' | 'an'; extras?: string[] } = {},
): string => {
  const article = opts.article ?? 'a';
  const parts = [
    `o:"${singular} token"`,
    `o:"${article} ${singular}"`,
    `o:${singular}s`,
    ...(opts.extras ?? []),
  ];
  return `(${parts.join(' or ')})`;
};

export const DECK_TAGS: DeckTag[] = [
  // Card advantage
  { category: 'Card advantage', id: 'draw', label: 'Draw cards', query: 'o:"draw"', terms: ['cantrip', 'card advantage'] },
  {
    category: 'Card advantage',
    id: 'draw-two-payoff',
    label: 'Draw-two payoffs',
    query: '(o:"second card" o:"each turn") or (o:"drawn two or more cards this turn")',
    terms: ['draw two', 'second card', 'izzet', 'omnious seas'],
  },
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

  // Named artifact tokens — makers and payoffs for each token type.
  {
    category: 'Artifact tokens',
    id: 'treasure',
    label: 'Treasure',
    query: artifactTokenQuery('Treasure'),
    terms: ['mana', 'pirate', 'smash'],
  },
  {
    category: 'Artifact tokens',
    id: 'clue',
    label: 'Clue',
    query: artifactTokenQuery('Clue', { extras: ['keyword:investigate'] }),
    terms: ['investigate', 'detective', 'murders'],
  },
  {
    category: 'Artifact tokens',
    id: 'food',
    label: 'Food',
    query: artifactTokenQuery('Food'),
    terms: ['lifegain', 'feast', 'trail'],
  },
  {
    category: 'Artifact tokens',
    id: 'blood',
    label: 'Blood',
    query: artifactTokenQuery('Blood'),
    terms: ['vampire', 'vow', 'discard'],
  },
  {
    category: 'Artifact tokens',
    id: 'map',
    label: 'Map',
    query: artifactTokenQuery('Map'),
    terms: ['explore', 'ixalan', 'lost caverns'],
  },
  {
    category: 'Artifact tokens',
    id: 'powerstone',
    label: 'Powerstone',
    query: artifactTokenQuery('Powerstone'),
    terms: ['brotherhood', 'dominaria united', 'artifact'],
  },
  {
    category: 'Artifact tokens',
    id: 'junk',
    label: 'Junk',
    query: artifactTokenQuery('Junk'),
    terms: ['fallout', 'wasteland'],
  },
  {
    category: 'Artifact tokens',
    id: 'gold',
    label: 'Gold',
    query: artifactTokenQuery('Gold'),
    terms: ['theros', 'treasure precursor'],
  },
  {
    category: 'Artifact tokens',
    id: 'incubator',
    label: 'Incubator',
    query: artifactTokenQuery('Incubator', { article: 'an' }),
    terms: ['phyrexia', 'transform', 'phyrexian'],
  },

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
  { category: 'Mana', id: 'ritual', label: 'Mana ritual', query: 'o:"add" o:"until end of turn"', terms: ['dark ritual'] },
  { category: 'Mana', id: 'cost-reduction', label: 'Cost reduction', query: 'o:"cost" o:"less"', terms: ['emperor'] },
  { category: 'Mana', id: 'cascade', label: 'Cascade', query: 'keyword:cascade' },

  // Life
  { category: 'Life', id: 'lifegain', label: 'Lifegain', query: 'o:"gain" o:"life"', terms: ['life gain'] },
  { category: 'Life', id: 'drain', label: 'Life drain', query: 'o:"loses" o:"life" o:"gain"', terms: ['extort'] },
  { category: 'Life', id: 'pay-life', label: 'Pay life', query: 'o:"pay" o:"life"', terms: ['necropotence'] },

  // Win conditions — not life totals; Laboratory Maniac, Approach, etc.
  {
    category: 'Win conditions',
    id: 'alt-win',
    label: 'Alternate win condition',
    query: '(o:"win the game" or o:"wins the game" or o:"lose the game" or o:"loses the game")',
    terms: ['alt win', 'wincon', 'lose the game', 'laboratory maniac', "thassa's oracle"],
  },

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

  // Types & themes — subtype/set pieces and the oracle that cares about them.
  {
    category: 'Types & themes',
    id: 'rooms',
    label: 'Rooms',
    // Avoid bare o:door / o:locked — those are common English and balloon the
    // query into a ~1000-card scrape that Scryfall rate-limits.
    query: typeThemeQuery('room', ['unlock a door', 'unlock', 'that door']),
    terms: ['duskmourn', 'unlock', 'door', 'haunted house'],
  },
  {
    category: 'Types & themes',
    id: 'battles',
    label: 'Battles',
    // Bare o:battle matches "battlefield". Use type-aware phrases instead:
    // attack payoffs ("a battle"), modal removal (", battle" / "or battle"), …
    query:
      '(t:battle or o:"a battle" or o:"target battle" or o:battles or o:"or battle" or o:", battle")',
    terms: ['siege', 'mom', 'phyrexia', 'attack a battle', 'invasion'],
  },
  {
    category: 'Types & themes',
    id: 'gates',
    label: 'Gates',
    query: typeThemeQuery('gate'),
    terms: ['guildgate', 'ravnica', 'maze', 'circuitous'],
  },
  {
    category: 'Types & themes',
    id: 'caves',
    label: 'Caves',
    query: typeThemeQuery('cave'),
    terms: ['lost caverns', 'ixalan', 'descend'],
  },
  {
    category: 'Types & themes',
    id: 'sagas',
    label: 'Sagas',
    query: typeThemeQuery('saga', ['lore counter', 'read ahead']),
    terms: ['enchantment', 'chapter', 'read ahead'],
  },
  {
    category: 'Types & themes',
    id: 'classes',
    label: 'Classes',
    query: '(t:class or o:"a Class" or o:"Class you control")',
    terms: ['afr', 'level up', 'background'],
  },
  {
    category: 'Types & themes',
    id: 'vehicles',
    label: 'Vehicles',
    query: '(t:vehicle or keyword:crew or o:crew)',
    terms: ['crew', 'pilot', 'mount'],
  },
  {
    category: 'Types & themes',
    id: 'shrines',
    label: 'Shrines',
    query: typeThemeQuery('shrine'),
    terms: ['sanctum', 'go-shintai', 'enchantment'],
  },
  {
    category: 'Types & themes',
    id: 'cases',
    label: 'Cases',
    // Bare o:case matches "in case" everywhere — stick to Case vocabulary.
    query: '(t:case or o:"a Case" or o:"Cases you" or o:"to solve" or o:solved)',
    terms: ['murders', 'karlov', 'investigate', 'clue'],
  },
  {
    category: 'Types & themes',
    id: 'spacecraft',
    label: 'Spacecraft',
    // Never bare o:station — it is a substring of "manifestation" and pulls in
    // Theros Inspired cards (Arbiter of the Ideal, etc.).
    query:
      '(t:spacecraft or o:"a Spacecraft" or o:"Spacecraft you" or keyword:station or o:"station counter")',
    terms: ['edge of eternities', 'station', 'spaceship'],
  },

  // Permanent player designations & threshold markers (City's Blessing, storied, …)
  { category: 'Permanent effects', id: 'ascend', label: 'Ascend', query: 'keyword:ascend', terms: ["city's blessing", 'tenth land'] },
  {
    category: 'Permanent effects',
    id: 'city-blessing',
    label: "City's Blessing",
    query: 'o:"City\'s Blessing"',
    terms: ['ascend', 'ixalan'],
  },
  {
    category: 'Permanent effects',
    id: 'storied',
    label: 'Storied',
    query: '(keyword:storied or o:"enduring story")',
    terms: ['hobbit', 'historic', 'legendary matters'],
  },
  {
    category: 'Permanent effects',
    id: 'monarch',
    label: 'Monarch',
    query: 'o:monarch',
    terms: ['multiplayer', 'politics'],
  },
  {
    category: 'Permanent effects',
    id: 'dungeon',
    label: 'Dungeons',
    query:
      '(o:dungeon or o:"venture into the dungeon" or o:"completed a dungeon" or o:"complete a dungeon" or o:initiative or o:Undercity)',
    terms: ['venture', 'initiative', 'undercity', 'acererak', 'dungeon descent'],
  },
  {
    category: 'Permanent effects',
    id: 'day-night',
    label: 'Day / night',
    query: '(o:daybound or o:nightbound or o:"it becomes day" or o:"it becomes night")',
    terms: ['innistrad', 'transform'],
  },
  {
    category: 'Permanent effects',
    id: 'ring-bearer',
    label: 'Ring-bearer',
    query: 'o:"Ring-bearer"',
    terms: ['lord of the rings', 'the ring'],
  },

  // Tribal — creatures of the type plus oracle payoffs (e.g. sacrifice a Goblin).
  { category: 'Tribal', id: 'tribe-elf', label: 'Elves', query: tribeQuery('elf'), terms: ['tribal', 'tribe matters'] },
  { category: 'Tribal', id: 'tribe-goblin', label: 'Goblins', query: tribeQuery('goblin'), terms: ['tribal', 'tribe matters'] },
  { category: 'Tribal', id: 'tribe-zombie', label: 'Zombies', query: tribeQuery('zombie'), terms: ['tribal', 'tribe matters'] },
  { category: 'Tribal', id: 'tribe-vampire', label: 'Vampires', query: tribeQuery('vampire'), terms: ['tribal', 'tribe matters'] },
  { category: 'Tribal', id: 'tribe-dragon', label: 'Dragons', query: tribeQuery('dragon'), terms: ['tribal', 'tribe matters'] },
  { category: 'Tribal', id: 'tribe-merfolk', label: 'Merfolk', query: tribeQuery('merfolk'), terms: ['tribal', 'tribe matters'] },
  { category: 'Tribal', id: 'tribe-wizard', label: 'Wizards', query: tribeQuery('wizard'), terms: ['tribal', 'tribe matters'] },
  { category: 'Tribal', id: 'tribe-soldier', label: 'Soldiers', query: tribeQuery('soldier'), terms: ['tribal', 'tribe matters'] },
  { category: 'Tribal', id: 'tribe-angel', label: 'Angels', query: tribeQuery('angel'), terms: ['tribal', 'tribe matters'] },
  { category: 'Tribal', id: 'tribe-demon', label: 'Demons', query: tribeQuery('demon'), terms: ['tribal', 'tribe matters'] },
  { category: 'Tribal', id: 'tribe-cat', label: 'Cats', query: tribeQuery('cat'), terms: ['tribal', 'tribe matters'] },
  { category: 'Tribal', id: 'tribe-dinosaur', label: 'Dinosaurs', query: tribeQuery('dinosaur'), terms: ['tribal', 'tribe matters'] },
  { category: 'Tribal', id: 'tribe-sliver', label: 'Slivers', query: tribeQuery('sliver'), terms: ['tribal', 'tribe matters'] },

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
