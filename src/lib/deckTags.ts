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

const tribeCardsQuery = (type: string): string => `t:${type}`;
const tribePayoffQuery = (type: string): string => `o:${type}`;
const tribeTags = (id: string, label: string, type: string): DeckTag[] => [
  {
    category: 'Tribal',
    id: `tribe-${id}`,
    label: `${label}: cards`,
    query: tribeCardsQuery(type),
    terms: ['tribal', 'tribe matters'],
  },
  {
    category: 'Tribal',
    id: `tribe-${id}-payoff`,
    label: `${label}: payoffs`,
    query: tribePayoffQuery(type),
    terms: ['tribal', 'tribe matters'],
  },
];

/**
 * A card type (Room, Battle, Gate, …) plus oracle payoffs that name it.
 * Prefer phrases that mean the type (`"a Room"`, `"Rooms you"`) over bare
 * English words (`door`, `case`) — those match half the catalogue and make
 * Scryfall slow enough to 429 under normal use.
 */
const typePayoffQuery = (type: string, extraOracle: string[] = []): string => {
  const parts = [
    `o:"a ${type}"`,
    `o:"${type}s you"`,
    ...extraOracle.map(o => (/\s/.test(o) || /^[A-Z]/.test(o) ? `o:"${o}"` : `o:${o}`)),
  ];
  return `(${parts.join(' or ')})`;
};

const artifactTokenMakerQuery = (singular: string, extras: string[] = []): string => {
  const parts = [`o:/create [^.]* ${singular} tokens?/`, ...extras];
  return `(${parts.join(' or ')})`;
};

const artifactTokenPayoffQuery = (singular: string, plural: string): string =>
  `(o:"${singular} you control" or o:"${plural} you control" or o:"sacrifice a ${singular}" or o:"sacrificed a ${singular}" or o:"one or more ${plural}" or o:"for each ${singular}" or o:"for each ${plural}" or o:"number of ${plural}" or o:"${singular} enters" or o:"${plural} enter")`;

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
  { category: 'Card advantage', id: 'draw', label: 'Draw: effects', query: 'o:"draw"', terms: ['cantrip', 'card advantage', 'draw enabler'] },
  {
    category: 'Card advantage',
    id: 'draw-two-payoff',
    label: 'Draw: payoffs',
    query: '(o:"second card" o:"each turn") or (o:"drawn two or more cards this turn")',
    terms: ['draw two', 'second card', 'izzet', 'omnious seas'],
  },
  { category: 'Card advantage', id: 'draw-on-cast', label: 'Draw: cast triggers', query: 'o:"whenever you cast" o:"draw"', terms: ['spellslinger'] },
  {
    category: 'Card advantage',
    id: 'draw-trigger',
    label: 'Draw: triggers',
    query: '(o:"whenever you draw" or o:"when you draw")',
    terms: ['draw matters', 'card draw trigger'],
  },
  { category: 'Card advantage', id: 'wheel', label: 'Wheel', query: 'o:"each player discards" o:"draw"', terms: ['mass discard'] },
  {
    category: 'Card advantage',
    id: 'loot',
    label: 'Loot — draw, then discard',
    // Loot is self-filtering in this picker. Merely having "draw" and
    // "discard" somewhere on the card also finds unrelated hand attack.
    query:
      '(o:/draw [^.]*cards?, then discard/ or (o:"you may draw" o:"if you do, discard")) -o:"target player" -o:"each player" -o:"target opponent" -o:"each opponent"',
    terms: ['filter', 'looter', 'draw discard'],
  },
  {
    category: 'Card advantage',
    id: 'rummage',
    label: 'Rummage — discard, then draw',
    query:
      '(o:/discard [^.]*cards?, then draw/ or (o:"you may discard" o:"if you do, draw")) -o:"target player" -o:"each player" -o:"target opponent" -o:"each opponent"',
    terms: ['filter', 'discard draw'],
  },
  { category: 'Card advantage', id: 'surveil', label: 'Surveil', query: 'keyword:surveil' },
  { category: 'Card advantage', id: 'explore', label: 'Explore', query: 'keyword:explore' },
  { category: 'Card advantage', id: 'mill-opp', label: 'Mill opponents', query: 'o:"mill"', terms: ['library'] },
  { category: 'Card advantage', id: 'self-mill', label: 'Self-mill', query: 'o:"put" o:"cards" o:"your" o:"graveyard" o:"library"', terms: ['dredge setup'] },
  { category: 'Card advantage', id: 'discard-opp', label: 'Discard: opponents', query: 'o:"discards a card"', terms: ['rack', 'hand attack'] },
  {
    category: 'Card advantage',
    id: 'self-discard',
    label: 'Discard: self enablers',
    // Keep the actor and action in the same phrase. Separate `discard` and
    // `you` clauses also match unrelated text such as Maha's Ward cost plus
    // "your opponents" on another line.
    query:
      '(o:"you discard" or o:"you\'ve discarded" or o:"card you discarded" or o:"cards you discarded" or o:"then discard" or o:"discard your hand" or o:/discard a card:/ or (o:"additional cost" o:"discard"))',
    terms: ['madness'],
  },
  { category: 'Card advantage', id: 'madness', label: 'Discard: madness payoffs', query: 'keyword:madness' },
  {
    category: 'Card advantage',
    id: 'discard-low-hand-payoff',
    label: 'Discard: low-hand payoffs',
    query:
      '(o:"one or fewer cards in hand" or o:"two or fewer cards in hand" or o:"no cards in hand" or o:"fewer than three cards in hand" or keyword:hellbent)',
    terms: ['empty hand', 'hellbent', 'one card in hand', 'the rack', 'discard matters'],
  },
  { category: 'Card advantage', id: 'scry', label: 'Scry', query: 'o:scry', terms: ['top of library'] },
  {
    category: 'Card advantage',
    id: 'from-exile',
    label: 'From exile: enablers',
    query:
      '(otag:impulse-draw or (otag:cast-from-exile -o:"whenever you cast" -o:"whenever you play" -o:"if you cast" -o:"if you play"))',
    terms: ['impulse draw', 'foretell', 'adventure', 'plot', 'suspend'],
  },
  {
    category: 'Card advantage',
    id: 'from-exile-payoff',
    label: 'From exile: payoffs',
    query:
      '((o:"whenever" or o:"if" or o:"for each") (o:/cast [^.]* from exile/ or o:/play [^.]* from exile/))',
    terms: ['cast from exile matters', 'play from exile matters'],
  },
  {
    category: 'Card advantage',
    id: 'from-exile-cost-reduction',
    label: 'From exile: cost reduction',
    query: '((o:"from exile" or o:"anywhere other than your hand") o:cost o:less)',
    terms: ['cast from exile cheaper', 'outside hand cost reduction'],
  },

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
  { category: 'Combat', id: 'goad', label: 'Goad', query: 'keyword:goad', terms: ['forced attack'] },
  { category: 'Combat', id: 'recruit', label: 'Recruit', query: 'keyword:recruit', terms: ['soldier'] },
  {
    category: 'Combat',
    id: 'prevent-attack',
    label: 'Preventing attack',
    // Goad keeps them off you, and so does every "can't attack you" effect.
    query: '(keyword:goad or o:"can\'t attack you")',
    terms: ['propaganda', 'ghostly prison', 'pillow fort'],
  },
  {
    category: 'Combat',
    id: 'prevent-damage-players',
    label: 'Preventing damage to players',
    // Oracle lines from Scryfall: "to you", "any target", Fog, and redirects
    // such as "dealt to you … is dealt to … instead". Damage that is merely
    // increased ("damage plus", "double that damage") stays out.
    query:
      '(o:/prevent.*(to you\\b|players?\\b|any target|any number of targets|dealt by|would be dealt by|would deal)/ or o:/(to you\\b|damage to you\\b|players?\\b|any target).*prevent/ or o:/would deal(?:(?!creature).)*prevent/ or o:/(to you\\b|to you and|damage to you\\b|or player).*(is dealt to|deals that damage to|deal that damage to).*instead/ or o:/(excess damage is dealt to|that damage is dealt to|deals that damage to).*instead/ or o:"prevent all combat damage that would be dealt this turn" or o:"prevent all damage that would be dealt this turn" or o:"that much damage minus") -o:"can\'t be prevented" -o:"damage plus" -o:"double that damage"',
    terms: ['fog', 'redirect', 'pariah'],
  },
  {
    category: 'Combat',
    id: 'prevent-damage-creatures',
    label: 'Preventing damage to creatures',
    query:
      '(o:/prevent.*(creatures?\\b|any target|any number of targets|you control|would deal)/ or o:/creatures?\\b.*prevent/ or o:/damage[^.]*creatures you control[^.]*instead/ or o:"prevent all combat damage that would be dealt this turn" or o:"prevent all damage that would be dealt this turn" or ((o:"dealt to ~" or o:"dealt by ~") (o:prevent or o:instead)) or (o:/would be dealt (this turn )?to (?!you\\b).{0,50}creatures?/ (o:prevent or o:instead)) or o:/excess damage is dealt to.*instead/ or o:"that much damage minus") -o:"can\'t be prevented" -o:"damage plus" -o:"double that damage"',
    terms: ['fog', 'redirect', 'vigor'],
  },

  // Tokens
  { category: 'Tokens & wide', id: 'tokens', label: 'Tokens: makers', query: 'o:"create" o:"token"', terms: ['go wide'] },
  { category: 'Tokens & wide', id: 'anthem', label: 'Tokens: anthem payoffs', query: 'o:"creatures you control get"', terms: ['lord', 'pump'] },
  { category: 'Tokens & wide', id: 'populate', label: 'Populate', query: 'keyword:populate' },
  { category: 'Tokens & wide', id: 'convoke', label: 'Convoke', query: 'keyword:convoke' },
  { category: 'Tokens & wide', id: 'improvise', label: 'Improvise', query: 'keyword:improvise' },
  { category: 'Tokens & wide', id: 'affinity', label: 'Affinity', query: 'keyword:affinity', terms: ['artifacts'] },
  { category: 'Tokens & wide', id: 'ninjutsu', label: 'Ninjutsu', query: 'keyword:ninjutsu' },

  // Named artifact tokens — makers and payoffs for each token type.
  {
    category: 'Artifact tokens',
    id: 'treasure',
    label: 'Treasure: makers',
    query: artifactTokenMakerQuery('Treasure'),
    terms: ['mana', 'pirate', 'smash'],
  },
  {
    category: 'Artifact tokens',
    id: 'treasure-payoff',
    label: 'Treasure: payoffs',
    query: artifactTokenPayoffQuery('Treasure', 'Treasures'),
    terms: ['mana', 'artifact tokens', 'sacrifice treasure'],
  },
  {
    category: 'Artifact tokens',
    id: 'clue',
    label: 'Clue: makers',
    query: artifactTokenMakerQuery('Clue', ['keyword:investigate']),
    terms: ['investigate', 'detective', 'murders'],
  },
  {
    category: 'Artifact tokens',
    id: 'clue-payoff',
    label: 'Clue: payoffs',
    query: artifactTokenPayoffQuery('Clue', 'Clues'),
    terms: ['investigate', 'detective', 'sacrifice clue'],
  },
  {
    category: 'Artifact tokens',
    id: 'food',
    label: 'Food: makers',
    query: artifactTokenMakerQuery('Food'),
    terms: ['lifegain', 'feast', 'trail'],
  },
  {
    category: 'Artifact tokens',
    id: 'food-payoff',
    label: 'Food: payoffs',
    query: artifactTokenPayoffQuery('Food', 'Foods'),
    terms: ['lifegain', 'feast', 'sacrifice food'],
  },
  {
    category: 'Artifact tokens',
    id: 'blood',
    label: 'Blood: makers',
    query: artifactTokenMakerQuery('Blood'),
    terms: ['vampire', 'vow', 'discard'],
  },
  {
    category: 'Artifact tokens',
    id: 'blood-payoff',
    label: 'Blood: payoffs',
    query: artifactTokenPayoffQuery('Blood', 'Blood tokens'),
    terms: ['vampire', 'vow', 'sacrifice blood'],
  },
  {
    category: 'Artifact tokens',
    id: 'map',
    label: 'Map: all',
    query: artifactTokenQuery('Map'),
    terms: ['explore', 'ixalan', 'lost caverns'],
  },
  {
    category: 'Artifact tokens',
    id: 'powerstone',
    label: 'Powerstone: all',
    query: artifactTokenQuery('Powerstone'),
    terms: ['brotherhood', 'dominaria united', 'artifact'],
  },
  {
    category: 'Artifact tokens',
    id: 'junk',
    label: 'Junk: all',
    query: artifactTokenQuery('Junk'),
    terms: ['fallout', 'wasteland'],
  },
  {
    category: 'Artifact tokens',
    id: 'gold',
    label: 'Gold: all',
    query: artifactTokenQuery('Gold'),
    terms: ['theros', 'treasure precursor'],
  },
  {
    category: 'Artifact tokens',
    id: 'incubator',
    label: 'Incubator: all',
    query: artifactTokenQuery('Incubator', { article: 'an' }),
    terms: ['phyrexia', 'transform', 'phyrexian'],
  },

  // Counters
  { category: 'Counters', id: 'plus-one', label: '+1/+1 counters: placement', query: 'o:"put" o:"+1/+1 counter"', terms: ['go tall', 'counter enabler'] },
  {
    category: 'Counters',
    id: 'plus-one-payoff',
    label: '+1/+1 counters: payoffs',
    query:
      '(o:"creatures you control with +1/+1 counters" or o:"creature you control with a +1/+1 counter" or o:"for each +1/+1 counter on" or o:"as long as it has a +1/+1 counter" or o:"if it has a +1/+1 counter")',
    terms: ['go tall', 'counter matters'],
  },
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
  {
    category: 'Graveyard',
    id: 'descend-trigger',
    label: 'Descend: descended this turn',
    query: 'o:"descended this turn"',
    terms: ['descend trigger', 'lost caverns', 'ixalan'],
  },
  {
    category: 'Graveyard',
    id: 'descend-threshold',
    label: 'Descend: graveyard threshold',
    query: '(o:/descend (4|8)/ or o:"fathomless descent")',
    terms: ['descend payoff', 'descend 4', 'descend 8', 'fathomless descent'],
  },

  // Removal — each tag is one way a card answers something. Phrases stay
  // specific so blink, graveyard recursion, and stax don't land in here.
  {
    category: 'Removal',
    id: 'destroy-creature',
    label: 'Destroy creature',
    query: 'o:/destroy (another |up to (one|two|three|four) )?target [^.]*creature/',
    terms: ['murder', 'doom blade'],
  },
  {
    category: 'Removal',
    id: 'destroy-any',
    label: 'Destroy noncreature',
    query:
      '(o:"destroy target artifact" or o:"destroy target enchantment" or o:"destroy target permanent" or o:"destroy target nonland" or o:"destroy target noncreature" or o:"destroy target land" or o:"destroy target planeswalker")',
    terms: ['naturalize', 'disenchant', 'beast within'],
  },
  {
    category: 'Removal',
    id: 'exile',
    label: 'Exile',
    query:
      '(o:"exile target creature" or o:"exile target permanent" or o:"exile target artifact" or o:"exile target enchantment" or o:"exile target nonland" or o:"exile target planeswalker" or o:"exile another target creature" or o:"exile another target permanent" or o:"exile up to one target" or o:"exile up to two target") -o:"you control" -o:graveyard',
    terms: ['swords', 'path', 'unmaking'],
  },
  {
    category: 'Removal',
    id: 'pacify',
    label: 'Pacifism',
    query:
      '(o:"enchanted creature can\'t attack" or o:"enchanted permanent can\'t attack" or o:"target creature can\'t attack or block" or o:"loses all abilities" or o:"loses all other abilities" or o:"lose all abilities" or o:"loses all other card types")',
    terms: ['pacifism', 'arrest', 'prison', 'frogify'],
  },
  {
    category: 'Removal',
    id: 'stun',
    label: 'Stun',
    query:
      '(keyword:stun or o:"stun counter" or o:"doesn\'t untap during its controller" or o:"doesn\'t untap during your untap" or o:"don\'t untap during that player" or o:"don\'t untap during their controller" or o:"enchanted creature doesn\'t untap" or o:"enchanted permanent doesn\'t untap")',
    terms: ['freeze', 'sleep', 'claustrophobia', 'tap down'],
  },
  {
    category: 'Removal',
    id: 'bounce',
    label: 'Bounce to hand',
    query:
      '(o:"to its owner\'s hand" or o:"to their owners\' hands" or o:"to their owner\'s hand") -o:graveyard',
    terms: ['unsummon', 'boomerang', 'tempo'],
  },
  {
    category: 'Removal',
    id: 'tuck',
    label: 'Put on library',
    query:
      '(o:"owner\'s library" or o:"owners\' libraries" or o:"shuffles it into their library" or o:"shuffle it into their library") -o:graveyard',
    terms: ['tuck', 'condemn', 'chaos warp'],
  },
  {
    category: 'Removal',
    id: 'edict',
    label: 'Edict',
    query:
      '(o:"target player sacrifices" or o:"that player sacrifices" or o:"each opponent sacrifices" or o:"each other player sacrifices" or o:"each player sacrifices" or o:"opponent sacrifices a" or o:"an opponent sacrifices")',
    terms: ['sacrifice', 'grave pact', 'sheoldred'],
  },
  {
    category: 'Removal',
    id: 'shrink',
    label: '-X/-X',
    query:
      '(o:"target creature gets -" or o:"all creatures get -" or o:"each creature gets -" or o:"-1/-1 counter on target" or o:"-1/-1 counters on each" or o:"-1/-1 counter on each")',
    terms: ['shrink', 'toxic deluge', 'grasp', 'toughness'],
  },
  {
    category: 'Removal',
    id: 'phase-out',
    label: 'Phase out',
    query: '(o:"phase out target" or (o:"phases out" (o:"target creature" or o:"target permanent" or o:enchanted)))',
    terms: ['oubliette', 'phasing'],
  },
  {
    category: 'Removal',
    id: 'board-wipe',
    label: 'Board wipe',
    query:
      '(o:"destroy all creatures" or o:"destroy all nonland permanents" or o:"destroy all permanents" or o:"exile all creatures" or o:"exile all nonland permanents" or o:"exile all permanents" or o:"all creatures get -" or o:"each creature gets -" or o:"damage to each creature" or o:"damage to all creatures")',
    terms: ['sweeper', 'wrath', 'farewell'],
  },
  { category: 'Removal', id: 'counterspell', label: 'Counterspell', query: 'o:"counter target"', terms: ['stack'] },
  { category: 'Removal', id: 'burn', label: 'Direct damage', query: 'o:"damage" o:"any target"', terms: ['burn', 'bolt'] },
  {
    category: 'Removal',
    id: 'damage-creature',
    label: 'Damage creature',
    query: 'o:"damage to target creature"',
    terms: ['flame slash', 'bolt'],
  },
  {
    category: 'Removal',
    id: 'fight-removal',
    label: 'Fight / bite',
    query: '(keyword:fight or keyword:bite)',
    terms: ['prey upon'],
  },

  // Mana
  { category: 'Mana', id: 'ramp', label: 'Ramp', query: 'o:"add {"', terms: ['mana dork', 'mana rock'] },
  { category: 'Mana', id: 'land-ramp', label: 'Land search', query: 'o:"search" o:"land" o:"library"', terms: ['cultivate'] },
  { category: 'Mana', id: 'extra-land', label: 'Extra land drop', query: 'o:"additional land"', terms: ['exploration'] },
  { category: 'Mana', id: 'landfall', label: 'Landfall', query: 'keyword:landfall' },
  { category: 'Mana', id: 'ritual', label: 'Mana ritual', query: 'o:"add" o:"until end of turn"', terms: ['dark ritual'] },
  { category: 'Mana', id: 'cost-reduction', label: 'Cost reduction', query: 'o:"cost" o:"less"', terms: ['emperor'] },
  { category: 'Mana', id: 'cascade', label: 'Cascade', query: 'keyword:cascade' },

  // Life
  { category: 'Life', id: 'lifegain', label: 'Lifegain: effects', query: 'o:"gain" o:"life"', terms: ['life gain', 'lifegain enabler'] },
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
  { category: 'Spells', id: 'instant-sorcery', label: 'Spells: instants & sorceries', query: '(t:instant or t:sorcery)' },
  { category: 'Spells', id: 'spells-matter', label: 'Spells: payoffs', query: 'o:"instant or sorcery"', terms: ['magecraft'] },
  { category: 'Spells', id: 'storm', label: 'Storm', query: 'keyword:storm' },
  { category: 'Spells', id: 'magecraft', label: 'Magecraft', query: 'keyword:magecraft' },
  { category: 'Spells', id: 'copy-spell', label: 'Copy spells', query: 'o:"copy" o:"spell"', terms: ['twincast'] },
  {
    category: 'Spells',
    id: 'cast-from-hand',
    label: 'Casting: from your hand',
    query: '((o:cast or o:play) o:"from your hand")',
    terms: ['hand cast', 'play from hand'],
  },
  {
    category: 'Spells',
    id: 'cast-outside-hand',
    label: 'Casting outside hand: payoffs',
    // Match rewards and modifiers, not permission such as “you may cast this
    // from your graveyard.” Keeping cast/play and the source in one clause also
    // avoids cards whose unrelated abilities happen to mention both.
    query:
      '(o:/(when|whenever|if) you (cast|play) [^,.]* from (anywhere other than your hand|a graveyard|your graveyard|exile|the top of your library|your library|your command zone)/ or o:/(first|next) [^,.]* you (cast|play) from (anywhere other than your hand|a graveyard|your graveyard|exile|the top of your library|your library|your command zone)/ or (o:/(spells?|cards?|lands?|creatures?) you (cast|play) from (anywhere other than your hand|a graveyard|your graveyard|exile|the top of your library|your library|your command zone)/ (o:cost or o:have or o:has or o:enter)))',
    terms: [
      'not from hand payoff',
      'other than hand matters',
      'graveyard cast payoff',
      'exile cast payoff',
      'library cast payoff',
    ],
  },

  // Artifacts & enchantments
  { category: 'Artifacts & enchantments', id: 'artifacts', label: 'Artifacts', query: 't:artifact', terms: ['artifact matters'] },
  { category: 'Artifacts & enchantments', id: 'enchantments', label: 'Enchantments', query: 't:enchantment', terms: ['enchantress'] },
  { category: 'Artifacts & enchantments', id: 'constellation', label: 'Constellation', query: 'keyword:constellation' },
  { category: 'Artifacts & enchantments', id: 'equipment', label: 'Equipment', query: 't:equipment', terms: ['voltron'] },
  { category: 'Artifacts & enchantments', id: 'aura', label: 'Auras', query: 't:aura', terms: ['voltron'] },
  { category: 'Artifacts & enchantments', id: 'sacrifice-outlet', label: 'Sacrifice: outlets', query: 'o:"sacrifice" o:":"', terms: ['aristocrats'] },
  {
    category: 'Artifacts & enchantments',
    id: 'sacrifice-trigger',
    label: 'Sacrifice: triggers',
    query:
      '(o:"whenever you sacrifice" or o:"when you sacrifice" or o:"one or more permanents are sacrificed" or o:"one or more other permanents are sacrificed")',
    terms: ['aristocrats', 'sacrifice payoff', 'sacrifice matters'],
  },

  // Types & themes — subtype/set pieces and the oracle that cares about them.
  {
    category: 'Types & themes',
    id: 'rooms',
    label: 'Rooms: cards',
    query: 't:room',
    terms: ['duskmourn', 'unlock', 'door', 'haunted house'],
  },
  {
    category: 'Types & themes',
    id: 'rooms-payoff',
    label: 'Rooms: payoffs',
    // Avoid bare o:door / o:locked — those are common English and balloon the
    // query into a ~1000-card scrape that Scryfall rate-limits.
    query: typePayoffQuery('room', ['unlock a door', 'unlock', 'that door']),
    terms: ['duskmourn', 'unlock', 'door', 'haunted house'],
  },
  {
    category: 'Types & themes',
    id: 'battles',
    label: 'Battles: cards',
    query: 't:battle',
    terms: ['siege', 'mom', 'phyrexia', 'attack a battle', 'invasion'],
  },
  {
    category: 'Types & themes',
    id: 'battles-payoff',
    label: 'Battles: payoffs',
    // Bare o:battle matches "battlefield". Use type-aware phrases instead:
    // attack payoffs ("a battle"), modal removal (", battle" / "or battle"), …
    query:
      '(o:"a battle" or o:"target battle" or o:battles or o:"or battle" or o:", battle")',
    terms: ['siege', 'mom', 'phyrexia', 'attack a battle', 'invasion'],
  },
  {
    category: 'Types & themes',
    id: 'gates',
    label: 'Gates: cards',
    query: 't:gate',
    terms: ['guildgate', 'ravnica', 'maze', 'circuitous'],
  },
  {
    category: 'Types & themes',
    id: 'gates-payoff',
    label: 'Gates: payoffs',
    query: typePayoffQuery('gate'),
    terms: ['guildgate', 'ravnica', 'maze', 'circuitous'],
  },
  {
    category: 'Types & themes',
    id: 'caves',
    label: 'Caves: cards',
    query: 't:cave',
    terms: ['lost caverns', 'ixalan', 'descend'],
  },
  {
    category: 'Types & themes',
    id: 'caves-payoff',
    label: 'Caves: payoffs',
    query: typePayoffQuery('cave'),
    terms: ['lost caverns', 'ixalan', 'descend'],
  },
  {
    category: 'Types & themes',
    id: 'sagas',
    label: 'Sagas: cards',
    query: 't:saga',
    terms: ['enchantment', 'chapter', 'read ahead'],
  },
  {
    category: 'Types & themes',
    id: 'sagas-payoff',
    label: 'Sagas: payoffs',
    query: typePayoffQuery('saga', ['lore counter', 'read ahead']),
    terms: ['enchantment', 'chapter', 'read ahead'],
  },
  {
    category: 'Types & themes',
    id: 'classes',
    label: 'Classes: cards',
    query: 't:class',
    terms: ['afr', 'level up', 'background'],
  },
  {
    category: 'Types & themes',
    id: 'classes-payoff',
    label: 'Classes: payoffs',
    query: '(o:"a Class" or o:"Class you control")',
    terms: ['afr', 'level up', 'background'],
  },
  {
    category: 'Types & themes',
    id: 'vehicles',
    label: 'Vehicles: cards',
    query: 't:vehicle',
    terms: ['crew', 'pilot', 'mount'],
  },
  {
    category: 'Types & themes',
    id: 'vehicles-payoff',
    label: 'Vehicles: payoffs',
    query: '(keyword:crew or o:"Vehicle you control" or o:"Vehicles you control")',
    terms: ['crew', 'pilot', 'mount'],
  },
  {
    category: 'Types & themes',
    id: 'shrines',
    label: 'Shrines: cards',
    query: 't:shrine',
    terms: ['sanctum', 'go-shintai', 'enchantment'],
  },
  {
    category: 'Types & themes',
    id: 'shrines-payoff',
    label: 'Shrines: payoffs',
    query: typePayoffQuery('shrine'),
    terms: ['sanctum', 'go-shintai', 'enchantment'],
  },
  {
    category: 'Types & themes',
    id: 'cases',
    label: 'Cases: cards',
    query: 't:case',
    terms: ['murders', 'karlov', 'investigate', 'clue'],
  },
  {
    category: 'Types & themes',
    id: 'cases-payoff',
    label: 'Cases: payoffs',
    // Bare o:case matches "in case" everywhere — stick to Case vocabulary.
    query: '(o:"a Case" or o:"Cases you" or o:"to solve" or o:solved)',
    terms: ['murders', 'karlov', 'investigate', 'clue'],
  },
  {
    category: 'Types & themes',
    id: 'spacecraft',
    label: 'Spacecraft: cards',
    query: 't:spacecraft',
    terms: ['edge of eternities', 'station', 'spaceship'],
  },
  {
    category: 'Types & themes',
    id: 'spacecraft-payoff',
    label: 'Spacecraft: payoffs',
    // Never bare o:station — it is a substring of "manifestation" and pulls in
    // Theros Inspired cards (Arbiter of the Ideal, etc.).
    query:
      '(o:"a Spacecraft" or o:"Spacecraft you" or keyword:station or o:"station counter")',
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
    label: 'Dungeon: venture',
    query: '(o:"venture into the dungeon" or o:"take the initiative" or o:"venture into Undercity")',
    terms: ['venture', 'initiative', 'undercity', 'acererak', 'dungeon enabler'],
  },
  {
    category: 'Permanent effects',
    id: 'dungeon-payoff',
    label: 'Dungeon: payoffs',
    query:
      '(o:"completed a dungeon" or o:"complete a dungeon" or o:"dungeons you\'ve completed")',
    terms: ['venture', 'initiative', 'undercity', 'dungeon matters'],
  },
  {
    category: 'Permanent effects',
    id: 'initiative',
    label: 'Initiative',
    query: 'o:initiative',
    terms: ['undercity'],
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

  // Tribal cards and the cards that explicitly reward each type.
  ...tribeTags('elf', 'Elves', 'elf'),
  ...tribeTags('goblin', 'Goblins', 'goblin'),
  ...tribeTags('zombie', 'Zombies', 'zombie'),
  ...tribeTags('vampire', 'Vampires', 'vampire'),
  ...tribeTags('dragon', 'Dragons', 'dragon'),
  ...tribeTags('merfolk', 'Merfolk', 'merfolk'),
  ...tribeTags('wizard', 'Wizards', 'wizard'),
  ...tribeTags('soldier', 'Soldiers', 'soldier'),
  ...tribeTags('angel', 'Angels', 'angel'),
  ...tribeTags('demon', 'Demons', 'demon'),
  ...tribeTags('cat', 'Cats', 'cat'),
  ...tribeTags('dinosaur', 'Dinosaurs', 'dinosaur'),
  ...tribeTags('sliver', 'Slivers', 'sliver'),

  // Triggers
  { category: 'Triggers', id: 'etb', label: 'Enter the battlefield', query: 'o:"enters the battlefield"', terms: ['etb', 'blink'] },
  { category: 'Triggers', id: 'dies', label: 'Dies trigger', query: 'o:"when" o:"dies"', terms: ['aristocrats', 'death trigger'] },
  { category: 'Triggers', id: 'attack-trigger', label: 'Attack trigger', query: 'o:"whenever" o:"attacks"' },
  { category: 'Triggers', id: 'cast-trigger', label: 'Spells: cast triggers', query: 'o:"whenever you cast"' },
  { category: 'Triggers', id: 'lifegain-trigger', label: 'Lifegain: triggers', query: 'o:"whenever you gain life"' },
  { category: 'Triggers', id: 'token-created', label: 'Tokens: creation triggers', query: 'o:"whenever you create"' },
  {
    category: 'Triggers',
    id: 'crime-trigger',
    label: 'Crime: triggered payoffs',
    query: 'o:"whenever you commit a crime"',
    terms: ['commit crimes', 'outlaws', 'thunder junction'],
  },
  {
    category: 'Triggers',
    id: 'crime-payoff',
    label: 'Crime: conditional payoffs',
    query: 'o:"committed a crime this turn"',
    terms: ['commit crimes', 'outlaws', 'thunder junction'],
  },
  {
    category: 'Triggers',
    id: 'crime-enabler',
    label: 'Crime: targeted enablers',
    query:
      '(o:"target opponent" or o:/target [^.]* an opponent controls/ or o:/target [^.]* opponent controls/ or o:/target [^.]* card in a graveyard/ or o:"counter target spell")',
    terms: ['commit crimes', 'target opponents', 'removal', 'graveyard hate', 'counterspell'],
  },
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
 * Type-or-oracle search for a tag the catalogue doesn't have yet.
 * `kobold` becomes `(t:kobold or o:kobold)`: cards of that type, and cards
 * that name it in rules text. A phrase is quoted on both sides so the spaces
 * survive. Returns null until there are two characters to search for.
 */
export const customOracleQuery = (text: string): string | null => {
  const value = text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/"/g, '')
    .replace(/^(?:o:|t:)/i, '');
  if (value.length < 2) return null;
  const term = /\s/.test(value) ? `"${value}"` : value;
  return `(t:${term} or o:${term})`;
};

/**
 * Build a Scryfall query from selected tag ids. Tags are AND-ed. Optional
 * commander identity restricts to legal cards. `extraQueries` are the same
 * kind of clause for tags that aren't in the built-in catalogue.
 */
export const buildTagsQuery = (
  tagIds: readonly string[],
  identity?: string[],
  extraQueries: readonly string[] = [],
): string => {
  const parts: string[] = [];
  for (const id of tagIds) {
    const tag = BY_ID.get(id);
    if (tag) parts.push(`(${tag.query})`);
  }
  for (const query of extraQueries) {
    const trimmed = query.trim();
    if (trimmed) parts.push(`(${trimmed})`);
  }
  if (identity) {
    parts.push(identity.length === 0 ? 'id=c' : `id<=${sortWubrg([...identity]).join('').toLowerCase()}`);
  }
  return parts.join(' ');
};
