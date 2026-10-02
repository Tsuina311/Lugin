// Commander bracket floor, from the cards a deck already stores.
//
// Wizards' brackets are a checklist. The number here is the lowest bracket this
// list is allowed to sit in, not a power-level score. Bracket 1 (a theme deck
// on purpose) and Bracket 5 (how you play it) are choices the list cannot prove.
// Two-card combos are not on this checklist.
//
// The names are the February 9, 2026 update. Game Changers are Wizards' list
// (Farewell and Biorhythm joined that day; Scryfall `is:gamechanger` is the
// same 53). Mass land denial is the community Scryfall tag `otag:mass-land-denial`
// with planeswalker ultimates and one-land effects taken out, plus Burning of
// Xinye and Hall of Gemstone, which match Wizards' definition and were missing
// from the tag. The next Wizards tweak should be an edit to these arrays.
//
// Both app entries call `loadBracketLists` at startup so a deck row can show a
// floor before anyone opens that deck.

import { cardKey } from './cardName';
import type { DeckSection } from './deck';

/** Official Game Changers. Zero below Bracket 3; a fourth forces Bracket 4. */
export const GAME_CHANGERS: readonly string[] = [
  'Ad Nauseam',
  'Ancient Tomb',
  'Aura Shards',
  'Biorhythm',
  'Bolas’s Citadel',
  'Braids, Cabal Minion',
  'Chrome Mox',
  'Coalition Victory',
  'Consecrated Sphinx',
  'Crop Rotation',
  'Cyclonic Rift',
  'Demonic Tutor',
  'Drannith Magistrate',
  'Enlightened Tutor',
  'Farewell',
  'Field of the Dead',
  'Fierce Guardianship',
  'Force of Will',
  'Gaea’s Cradle',
  'Gamble',
  'Gifts Ungiven',
  'Glacial Chasm',
  'Grand Arbiter Augustin IV',
  'Grim Monolith',
  'Humility',
  'Imperial Seal',
  'Intuition',
  'Jeska’s Will',
  'Lion’s Eye Diamond',
  'Mana Vault',
  'Mishra’s Workshop',
  'Mox Diamond',
  'Mystical Tutor',
  'Narset, Parter of Veils',
  'Natural Order',
  'Necropotence',
  'Notion Thief',
  'Opposition Agent',
  'Orcish Bowmasters',
  'Panoptic Mirror',
  'Rhystic Study',
  'Seedborn Muse',
  'Serra’s Sanctum',
  'Smothering Tithe',
  'Survival of the Fittest',
  'Teferi’s Protection',
  'Tergrid, God of Fright',
  'Thassa’s Oracle',
  'The One Ring',
  'The Tabernacle at Pendrell Vale',
  'Underworld Breach',
  'Vampiric Tutor',
  'Worldly Tutor',
];

/**
 * Cards that destroy, exile, bounce, keep tapped, or rewrite the mana of many
 * lands without replacing them. Any one of them is Bracket 4.
 */
export const MASS_LAND_DENIAL: readonly string[] = [
  'Acid Rain',
  'Apocalypse',
  'Armageddon',
  'Avalanche',
  'Back to Basics',
  'Balance',
  'Balancing Act',
  'Bearer of the Heavens',
  'Bend or Break',
  'Blood Moon',
  'Boil',
  'Boiling Seas',
  'Boom // Bust',
  'Break the Ice',
  'Burning of Xinye',
  'Cataclysm',
  'Catastrophe',
  'Chaos Moon',
  'Choke',
  'Cleansing',
  'Contamination',
  'Conversion',
  'Curse of Marit Lage',
  'Curse of the Cabal',
  'Death Cloud',
  'Decree of Annihilation',
  'Desolation',
  'Desolation Angel',
  'Destructive Flow',
  'Devastating Dreams',
  'Devastation',
  'Dimensional Breach',
  'Drought',
  'Earthlink',
  'Epicenter',
  'Equipoise',
  'Fall of the Thran',
  'Flashfires',
  'Global Ruin',
  'Hall of Gemstone',
  'Harbinger of the Seas',
  'Hokori, Dust Drinker',
  'Illusionary Terrain',
  'Impending Disaster',
  'Infernal Darkness',
  'Jokulhaups',
  'Keldon Firebombers',
  'Land Equilibrium',
  'Limited Resources',
  'Magus of the Balance',
  'Magus of the Moon',
  'Mana Breach',
  'Mana Vortex',
  'Mist of Stagnation',
  'Myojin of Infinite Rage',
  'Naked Singularity',
  'Nature’s Wrath',
  'Obliterate',
  'Omen of Fire',
  'Pox Plague',
  'Quicksilver Fountain',
  'Ravages of War',
  'Razia’s Purification',
  'Realm Razer',
  'Restore Balance',
  'Rising Waters',
  'Ritual of Subdual',
  'Ruination',
  'Rumbling Crescendo',
  'Soulscour',
  'Stasis',
  'Static Orb',
  'Stench of Evil',
  'Storm Cauldron',
  'Sunder',
  'Tectonic Break',
  'Temporal Distortion',
  'Thoughts of Ruin',
  'Tsabo’s Web',
  'Tsunami',
  'Upheaval',
  'Volcanic Awakening',
  'Wake of Destruction',
  'Wildfire',
  'Winter Moon',
  'Winter Orb',
  'Winter’s Night',
  'Worldfire',
  'Worldpurge',
  'Worldslayer',
  'Zhao, the Moon Slayer',
];

/**
 * Cards that take an extra turn. None of these can claim Bracket 1. A couple
 * is still Core, so they do not raise the floor on their own.
 * Stranglehold and Trouble in Pairs mention extra turns only to skip them.
 */
export const EXTRA_TURNS: readonly string[] = [
  'Alchemist’s Gambit',
  'Alrund’s Epiphany',
  'Beacon of Tomorrows',
  'Capture of Jingzhou',
  'Chance for Glory',
  'Emrakul, the Aeons Torn',
  'Emrakul, the Promised End',
  'Eon Frolicker',
  'Expropriate',
  'Final Fortune',
  'Gerrard’s Hourglass Pendant',
  'Gonti’s Aether Heart',
  'Ichormoon Gauntlet',
  'Kang the Conqueror',
  'Karn’s Temporal Sundering',
  'Last Chance',
  'Lighthouse Chronologist',
  'Lost Isle Calling',
  'Magistrate’s Scepter',
  'Magosi, the Waterveil',
  'Medomai the Ageless',
  'Mu Yanling',
  'Nexus of Fate',
  'Notorious Throng',
  'Part the Waterveil',
  'Perch Protection',
  'Phone a Friend',
  'Plea for Power',
  'Ral Zarek',
  'Regenerations Restored',
  'Rise of the Eldrazi',
  'Sage of Hours',
  'Savor the Moment',
  'Search the City',
  'Second Chance',
  'Seedtime',
  'Stitch in Time',
  'Teferi, Master of Time',
  'Teferi, Timebender',
  'Temporal Extortion',
  'Temporal Manipulation',
  'Temporal Mastery',
  'Temporal Trespass',
  'The Legend of Kuruk // Avatar Kuruk',
  'Time Sieve',
  'Time Stretch',
  'Time Vault',
  'Time Walk',
  'Time Warp',
  'Timesifter',
  'Timestream Navigator',
  'Twice Upon a Time // Unlikely Meeting',
  'Ugin’s Nexus',
  'Ultimecia, Time Sorceress // Ultimecia, Omnipotent',
  'Walk the Aeons',
  'Wanderwine Prophets',
  'Warrior’s Oath',
  'Wormfang Manta',
];

/**
 * Non-land tutors that are not already Game Changers. October 2025 dropped tutor
 * limits, so this count is shown beside the floor and never raises it. Efficient
 * tutors (Demonic Tutor, Mystical Tutor, and the rest) are Game Changers instead.
 */
export const TUTORS: readonly string[] = [
  'Academy Rector',
  'Beseech the Mirror',
  'Beseech the Queen',
  'Birthing Pod',
  'Bring to Light',
  'Buried Alive',
  'Chord of Calling',
  'Congregation at Dawn',
  'Conflux',
  'Cruel Tutor',
  'Dark Petition',
  'Demonic Counsel',
  'Diabolic Intent',
  'Diabolic Tutor',
  'Eldritch Evolution',
  'Eladamri’s Call',
  'Fabricate',
  'Fauna Shaman',
  'Fierce Empath',
  'Finale of Devastation',
  'Goblin Engineer',
  'Green Sun’s Zenith',
  'Grim Tutor',
  'Hoarding Broodlord',
  'Idyllic Tutor',
  'Imperial Recruiter',
  'Increasing Ambition',
  'Infernal Tutor',
  'Insidious Dreams',
  'Jarad’s Orders',
  'Lim-Dul’s Vault',
  'Mastermind’s Acquisition',
  'Merchant Scroll',
  'Moon-Blessed Cleric',
  'Mystical Teachings',
  'Neoform',
  'Personal Tutor',
  'Plea for Guidance',
  'Praetor’s Grasp',
  'Profane Tutor',
  'Razaketh, the Foulblooded',
  'Recruiter of the Guard',
  'Reshape',
  'Rune-Scarred Demon',
  'Scheming Symmetry',
  'Shared Summons',
  'Sidisi, Undead Vizier',
  'Solve the Equation',
  'Spellseeker',
  'Sterling Grove',
  'Tinker',
  'Transmute Artifact',
  'Tribute Mage',
  'Trinket Mage',
  'Trophy Mage',
  'Varragoth, Bloodsky Sire',
  'Whir of Invention',
  'Wishclaw Talisman',
];

export const BRACKET_NAME: Record<2 | 3 | 4, string> = {
  2: 'Core',
  3: 'Upgraded',
  4: 'Optimized',
};

export interface BracketCardRef {
  name: string;
  section: DeckSection;
}

export interface BracketEstimate {
  /** Nothing blocks a player from choosing Bracket 1. The list still does not prove it. */
  exhibitionOk: boolean;
  extraTurns: BracketCardRef[];
  /** Lowest bracket this list is allowed to sit in. */
  floor: 2 | 3 | 4;
  gameChangers: BracketCardRef[];
  massLandDenial: BracketCardRef[];
  tutors: BracketCardRef[];
}

interface BracketIndexes {
  extraTurns: Map<string, string>;
  gameChangers: Map<string, string>;
  massLandDenial: Map<string, string>;
  tutors: Map<string, string>;
}

const indexNames = (names: readonly string[]): Map<string, string> => {
  const map = new Map<string, string>();
  for (const name of names) map.set(cardKey(name), name);
  return map;
};

let loaded: BracketIndexes | null = null;

/** Build the name indexes. Both app entries call this before the first paint. */
export const loadBracketLists = (): BracketIndexes => {
  if (!loaded) {
    loaded = {
      extraTurns: indexNames(EXTRA_TURNS),
      gameChangers: indexNames(GAME_CHANGERS),
      massLandDenial: indexNames(MASS_LAND_DENIAL),
      tutors: indexNames(TUTORS),
    };
  }
  return loaded;
};

const take = (
  cards: readonly { name: string; section: DeckSection }[],
  index: Map<string, string>,
  seen: Set<string>,
): BracketCardRef[] => {
  const hits: BracketCardRef[] = [];
  for (const card of cards) {
    if (card.section === 'sideboard') continue;
    const key = cardKey(card.name);
    if (!key || seen.has(key) || !index.has(key)) continue;
    seen.add(key);
    hits.push({ name: card.name, section: card.section });
  }
  hits.sort((a, b) => a.name.localeCompare(b.name));
  return hits;
};

/** The floor for these cards. Sideboard is ignored. A card is counted once, as its strongest category. */
export const estimateBracket = (
  cards: readonly { name: string; section: DeckSection }[],
): BracketEstimate => {
  const lists = loadBracketLists();
  // Game Changers and mass land denial are counted on their own, so a card that
  // ever sits on both lists still forces Bracket 4. Later groups skip those
  // names so the hover shows each card once.
  const gameChangers = take(cards, lists.gameChangers, new Set());
  const massLandDenial = take(cards, lists.massLandDenial, new Set());
  const claimed = new Set([...gameChangers, ...massLandDenial].map(card => cardKey(card.name)));
  const extraTurns = take(cards, lists.extraTurns, claimed);
  const tutors = take(cards, lists.tutors, claimed);
  const floor: 2 | 3 | 4 =
    massLandDenial.length > 0 || gameChangers.length >= 4 ? 4 : gameChangers.length > 0 ? 3 : 2;
  return {
    exhibitionOk: floor === 2 && extraTurns.length === 0,
    extraTurns,
    floor,
    gameChangers,
    massLandDenial,
    tutors,
  };
};

const nCards = (count: number): string => (count === 1 ? 'this card' : `these ${count} cards`);

/** The sentence above the card lists: why the floor is what it is. */
export const bracketBecause = (estimate: BracketEstimate): string => {
  const changers = estimate.gameChangers.length;
  const denial = estimate.massLandDenial.length > 0;
  if (estimate.floor === 4 && denial && changers > 0) {
    return `Bracket 4 or higher because of mass land denial and ${nCards(changers)}.`;
  }
  if (estimate.floor === 4 && denial) return 'Bracket 4 or higher because of mass land denial.';
  if (estimate.floor === 4) return `Bracket 4 or higher because of ${nCards(changers)}.`;
  if (estimate.floor === 3) return `Bracket 3 or higher because of ${nCards(changers)}.`;
  return 'This list can be played as Bracket 2.';
};

/** Counts for the hover summary. Empty when nothing on the lists is in the deck. */
export const bracketSummary = (estimate: BracketEstimate): string => {
  const parts: string[] = [];
  if (estimate.gameChangers.length > 0) {
    const n = estimate.gameChangers.length;
    parts.push(`${n} Game Changer${n === 1 ? '' : 's'}`);
  }
  if (estimate.massLandDenial.length > 0) {
    const n = estimate.massLandDenial.length;
    parts.push(`${n} mass land denial${n === 1 ? '' : ' cards'}`);
  }
  if (estimate.extraTurns.length > 0) {
    const n = estimate.extraTurns.length;
    parts.push(`${n} extra-turn card${n === 1 ? '' : 's'}`);
  }
  if (estimate.tutors.length > 0) {
    const n = estimate.tutors.length;
    parts.push(`${n} tutor${n === 1 ? '' : 's'}`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Nothing on the restricted lists';
};

/** Bracket 1, Bracket 5, and combos — the parts the card list cannot decide. */
export const bracketNote = (estimate: BracketEstimate): string => {
  const lines: string[] = [];
  if (estimate.floor === 2) {
    lines.push(
      estimate.exhibitionOk
        ? 'Bracket 1 is a theme deck on purpose.'
        : 'Extra-turn cards keep this from Bracket 1.',
    );
  }
  if (estimate.tutors.length > 0) lines.push('The tutor count does not raise the bracket.');
  lines.push('Bracket 5 is a choice about how you play it.');
  lines.push('This estimate does not look for combos.');
  return lines.join(' ');
};
