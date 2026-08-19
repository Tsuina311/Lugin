// What happens when someone uploads a file? (`yarn test:import`)
//
// Import is the one place where being quietly wrong is worse than failing: a
// misread deck becomes a hundred loose cards in your collection, and a misread
// collection becomes a deck you never built. Both are tedious to undo and easy
// to not notice, so the fixtures here are real export shapes rather than tidy
// invented ones — ManaBox's `// COMMANDER` headers, Excel's byte-order mark,
// tab-separated columns, and card names with commas in them.
//
// Bundled with esbuild like scripts/sync-test.mjs, since src/lib is portable and
// needs no browser to run.

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const { build } = await import(pathToFileURL(join(root, 'node_modules/esbuild/lib/main.js')).href);

const out = await mkdtemp(join(tmpdir(), 'lugin-import-'));
const entry = join(out, 'entry.ts');
await writeFile(
  entry,
  `export * from '${root}src/lib/import';
   export * from '${root}src/lib/deck';
   export * from '${root}src/lib/duplicates';
   export * from '${root}src/lib/export';
   export * from '${root}src/lib/prices';
   export * from '${root}src/lib/arrivedPurchases';
   export * from '${root}src/lib/cardImage';
   export * from '${root}src/lib/purchaseCost';
   export * from '${root}src/lib/purchaseDuplicates';
   export * from '${root}src/lib/sellerStats';
   export * from '${root}src/sites/cardmarket/searchArgs';
   export * from '${root}src/sites/cardmarket/productUrl';
   export * from '${root}src/lib/sets';
   export { cardKey } from '${root}src/lib/cardName';
   export { sellerFrom, sellerSlugFromHref, timelineFrom } from '${root}src/sites/cardmarket/order';
   export { shouldWelcome } from '${root}src/ui/firstRun';
   export * from '${root}src/lib/table';`,
);

const bundle = join(out, 'import.mjs');
await build({
  bundle: true,
  entryPoints: [entry],
  format: 'esm',
  outfile: bundle,
  platform: 'neutral',
  tsconfigRaw: { compilerOptions: { paths: { '@/*': [`${root}src/*`] } } },
});

const {
  addPaid,
  applyImport,
  cardImageUrl,
  cardKey,
  imageUrlFor,
  imagesByName,
  collectionFile,
  collectionToCsv,
  collectionValue,
  deckFile,
  deckFromImport,
  deckToText,
  mergeDeckCards,
  newDeck,
  withFormat,
  findDuplicates,
  inspectImport,
  money,
  parseCardLine,
  parseDeckList,
  parseTable,
  priceOf,
  pruneVerdicts,
  purchaseKey,
  sectionHeader,
  splitPurchases,
  everyPaid,
  withCost,
  arrivedOnly,
  hasArrived,
  inTransitCopies,
  daysSince,
  ordersWithoutSeller,
  buildArgs,
  encodeArgs,
  obfuscate,
  tokenFromArgs,
  productFactsFromImage,
  expansionFromProductUrl,
  buildSetIndex,
  editionIdOf,
  groupEditionsByYear,
  normalizeSetName,
  resolveSet,
  tallyEditions,
  sellerFrom,
  sellerSlugFromHref,
  sellerStats,
  shippingPerCopy,
  shouldWelcome,
  timelineFrom,
} = await import(pathToFileURL(bundle).href);

let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  ${name}\n        ${error.message.split('\n').join('\n        ')}`);
  }
};

const only = inspection => {
  assert.equal(inspection.parts.length, 1, `expected one part, got ${inspection.parts.length}`);
  return inspection.parts[0];
};
const qty = (cards, name) =>
  cards.filter(c => c.name.toLowerCase() === name.toLowerCase()).reduce((n, c) => n + c.quantity, 0);
const section = (deck, name) => deck.find(c => c.name.toLowerCase() === name.toLowerCase())?.section;

// --- ManaBox deck export -----------------------------------------------------
//
// The format from manabox.app/guides/decks/import-export: a commented COMMANDER
// header, then a blank line, then the main deck with no header of its own.

const MANABOX_DECK = `// COMMANDER
1 Niv-Mizzet, Visionary (FDN) 350

1 Counterspell (DSC) 114
1 Jace, Ingenious Mind-Mage (XLN) 280 *F*
4 Lightning Bolt (M10) 146
20 Island

// SIDEBOARD
2 Negate (MOM) 62
`;

check('ManaBox deck: the commented header is a header, not a comment', () => {
  const part = only(inspectImport(MANABOX_DECK));
  assert.equal(part.kind, 'deck');
  assert.equal(part.uncertain, false);
  assert.equal(section(part.deck, 'Niv-Mizzet, Visionary'), 'commander');
});

check('ManaBox deck: the blank line ends the commander block', () => {
  const part = only(inspectImport(MANABOX_DECK));
  assert.equal(section(part.deck, 'Counterspell'), 'main', 'the deck followed the commander');
  assert.equal(section(part.deck, 'Lightning Bolt'), 'main');
  const commanders = part.deck.filter(c => c.section === 'commander');
  assert.equal(commanders.length, 1, `exactly one commander, got ${commanders.length}`);
});

check('ManaBox deck: the sideboard is its own section', () => {
  const part = only(inspectImport(MANABOX_DECK));
  assert.equal(section(part.deck, 'Negate'), 'sideboard');
});

check('ManaBox deck: set, number and foil survive into the collection reading', () => {
  const part = only(inspectImport(MANABOX_DECK));
  const jace = part.cards.find(c => c.name.startsWith('Jace'));
  assert.equal(jace.setCode, 'XLN');
  assert.equal(jace.collectorNumber, '280');
  assert.equal(jace.foil, true, 'the *F* marker means foil');
  const bolt = part.cards.find(c => c.name === 'Lightning Bolt');
  assert.equal(bolt.foil, false);
  assert.equal(bolt.quantity, 4);
});

// --- ManaBox collection CSV --------------------------------------------------

const MANABOX_CSV = `Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Condition,Language,Binder Name,Binder Type
"Erayo, Soratami Ascendant",chk,Champions of Kamigawa,66,normal,rare,1,123,abc-1,0.50,false,false,near_mint,en,Main binder,binder
Sol Ring,ltr,The Lord of the Rings,123,foil,uncommon,2,124,abc-2,1.20,false,false,near_mint,en,Main binder,binder
Rhystic Study,cmr,Commander Legends,90,normal,rare,1,125,abc-3,25.00,false,false,near_mint,en,Talrand deck,deck
"Talrand, Sky Summoner",dtk,Dragons of Tarkir,71,normal,uncommon,1,126,abc-4,0.30,false,false,near_mint,en,Talrand deck,deck
`;

check('ManaBox CSV: recognised as ManaBox, split by binder', () => {
  const inspection = inspectImport(MANABOX_CSV);
  assert.equal(inspection.format, 'manabox-csv');
  assert.equal(inspection.parts.length, 2, 'one part per binder');
});

check('ManaBox CSV: the binder marked "deck" is imported as a deck', () => {
  const inspection = inspectImport(MANABOX_CSV);
  const deck = inspection.parts.find(p => p.label === 'Talrand deck');
  assert.equal(deck.kind, 'deck');
  assert.equal(deck.uncertain, false, 'the file said so outright');
  assert.match(deck.reason, /marks "Talrand deck" as a deck/);
});

check('ManaBox CSV: the ordinary binder is collection', () => {
  const inspection = inspectImport(MANABOX_CSV);
  const binder = inspection.parts.find(p => p.label === 'Main binder');
  assert.equal(binder.kind, 'collection');
  assert.equal(qty(binder.cards, 'Sol Ring'), 2);
  assert.equal(binder.cards.find(c => c.name === 'Sol Ring').foil, true);
});

check('ManaBox CSV: a quoted card name keeps its comma', () => {
  const inspection = inspectImport(MANABOX_CSV);
  const binder = inspection.parts.find(p => p.label === 'Main binder');
  assert.ok(
    binder.cards.some(c => c.name === 'Erayo, Soratami Ascendant'),
    `names read: ${binder.cards.map(c => c.name).join(' | ')}`,
  );
});

check('ManaBox CSV: printing details are carried across', () => {
  const inspection = inspectImport(MANABOX_CSV);
  const binder = inspection.parts.find(p => p.label === 'Main binder');
  const ring = binder.cards.find(c => c.name === 'Sol Ring');
  assert.equal(ring.setCode, 'ltr');
  assert.equal(ring.collectorNumber, '123');
  assert.equal(ring.scryfallId, 'abc-2');
  assert.equal(ring.condition, 'near_mint');
});

// --- delimiters and encodings ------------------------------------------------

check('tab-separated export reads as a table', () => {
  const tsv = 'Name\tSet code\tQuantity\tFoil\nSol Ring\tltr\t3\tfoil\n';
  const part = only(inspectImport(tsv));
  assert.equal(qty(part.cards, 'Sol Ring'), 3);
  assert.equal(part.cards[0].foil, true);
});

check('semicolon export reads as a table', () => {
  const csv = 'Name;Set code;Quantity\nSol Ring;ltr;2\n';
  const part = only(inspectImport(csv));
  assert.equal(qty(part.cards, 'Sol Ring'), 2);
});

check('a byte-order mark does not break the first column', () => {
  const csv = '\uFEFFName,Quantity\r\nSol Ring,2\r\n';
  const part = only(inspectImport(csv));
  assert.equal(qty(part.cards, 'Sol Ring'), 2, 'the Name column was still found');
});

// --- Arena / plain lists -----------------------------------------------------

check('Arena export: About block names the deck, sections are kept', () => {
  const arena = `About
Name Mono Blue Tempo

Deck
4 Spectral Sailor (M20) 74
4 Brazen Borrower (ELD) 39

Sideboard
2 Negate (M20) 69
`;
  const part = only(inspectImport(arena));
  assert.equal(part.kind, 'deck');
  assert.equal(part.label, 'Mono Blue Tempo');
  assert.equal(section(part.deck, 'Negate'), 'sideboard');
  assert.equal(qty(part.cards, 'Spectral Sailor'), 4);
});

check('a short bare list is a collection, and says it is unsure', () => {
  const part = only(inspectImport('2 Sol Ring\nLightning Bolt\n3x Counterspell\n'));
  assert.equal(part.kind, 'collection');
  assert.equal(part.uncertain, true);
  assert.equal(qty(part.cards, 'Counterspell'), 3);
});

check('a 100-card singleton list is guessed to be a deck, but flagged', () => {
  const cards = Array.from({ length: 99 }, (_, i) => `1 Card Number ${i + 1}`).join('\n');
  const part = only(inspectImport(`1 Talrand, Sky Summoner\n${cards}\n`));
  assert.equal(part.kind, 'deck');
  assert.equal(part.uncertain, true, 'nothing in the file actually said so');
});

check('a lone deck exported as a spreadsheet is filed as a deck', () => {
  // What one deck exported on its own looks like: card columns, no binder named.
  // Filing this in the collection would be the wrong default — a deck read as
  // loose cards is invisible afterwards without counting by hand.
  const rows = Array.from(
    { length: 99 },
    (_, i) => `Card Number ${i + 1},cmr,${i + 1},normal,1`,
  ).join('\n');
  const part = only(
    inspectImport(`Name,Set code,Collector number,Foil,Quantity\n${rows}\n"Talrand, Sky Summoner",dtk,71,normal,1\n`),
  );
  assert.equal(part.kind, 'deck');
  assert.equal(part.uncertain, true, 'the file never said so');
  assert.match(part.reason, /deck-shaped/);
  assert.equal(part.deck.length, 100, 'and it is readable as a decklist');
});

check('a binder ManaBox marked as a binder stays a collection, deck-shaped or not', () => {
  // The same 60 singleton rows, but the file distinguishes binders from decks —
  // so its saying "binder" outranks anything the shape suggests.
  const rows = Array.from(
    { length: 60 },
    (_, i) => `Card Number ${i + 1},cmr,${i + 1},normal,1,Trade binder,binder`,
  ).join('\n');
  const part = only(
    inspectImport(`Name,Set code,Collector number,Foil,Quantity,Binder Name,Binder Type\n${rows}\n`),
  );
  assert.equal(part.kind, 'collection');
  assert.equal(part.label, 'Trade binder');
});

check('a big pile of duplicates is a collection, not a deck', () => {
  const cards = Array.from({ length: 60 }, (_, i) => `9 Card Number ${i + 1}`).join('\n');
  const part = only(inspectImport(cards));
  assert.equal(part.kind, 'collection', 'nine copies of everything is nobody\u2019s deck');
});

check('a decklist whose card name contains a comma is not read as a table', () => {
  const list = `1 Erayo, Soratami Ascendant
1 Talrand, Sky Summoner
1 Niv-Mizzet, Parun
`;
  const inspection = inspectImport(list);
  assert.notEqual(inspection.format, 'table', 'a comma in a name is not a column boundary');
  const part = only(inspection);
  assert.ok(
    part.cards.some(c => c.name === 'Erayo, Soratami Ascendant'),
    `names read: ${part.cards.map(c => c.name).join(' | ')}`,
  );
});

check('an empty file reports nothing rather than throwing', () => {
  assert.equal(inspectImport('').format, 'empty');
  assert.equal(inspectImport('   \n\n').format, 'empty');
  assert.deepEqual(inspectImport('').parts, []);
});

// --- the pieces underneath ---------------------------------------------------

check('parseCardLine reads quantity, set, number and finish', () => {
  assert.deepEqual(parseCardLine('4 Lightning Bolt (M10) 146 *F*'), {
    collectorNumber: '146',
    foil: true,
    name: 'Lightning Bolt',
    quantity: 4,
    setCode: 'M10',
  });
  assert.deepEqual(parseCardLine('Sol Ring'), {
    collectorNumber: undefined,
    foil: false,
    name: 'Sol Ring',
    quantity: 1,
    setCode: undefined,
  });
  assert.equal(parseCardLine('   '), null);
});

check('parseCardLine handles the bracket spelling of a printing', () => {
  const line = parseCardLine('2 Brazen Borrower [ELD] #39');
  assert.equal(line.setCode, 'ELD');
  assert.equal(line.collectorNumber, '39');
  assert.equal(line.name, 'Brazen Borrower');
});

check('sectionHeader sees through comment and banner decoration', () => {
  assert.equal(sectionHeader('// COMMANDER'), 'commander');
  assert.equal(sectionHeader('== SIDEBOARD =='), 'sideboard');
  assert.equal(sectionHeader('Deck'), 'main');
  assert.equal(sectionHeader('Mainboard'), 'main');
  assert.equal(sectionHeader('1 Sol Ring'), null);
  assert.equal(sectionHeader('// just a note'), null);
});

check('parseDeckList still merges duplicate lines within a section', () => {
  const { cards } = parseDeckList('2 Sol Ring\n1 Sol Ring\nSideboard\n1 Sol Ring\n');
  const main = cards.filter(c => c.section === 'main');
  assert.equal(main.length, 1);
  assert.equal(main[0].quantity, 3);
  assert.equal(cards.filter(c => c.section === 'sideboard')[0].quantity, 1);
});

check('parseTable refuses a single-column file', () => {
  assert.equal(parseTable('Sol Ring\nLightning Bolt\n'), null);
});

// --- duplicates --------------------------------------------------------------

const card = (name, extra = {}) => ({ foil: false, name, quantity: 1, ...extra });

check('a Scryfall id match is exact', () => {
  const existing = [card('Sol Ring', { scryfallId: 'abc', source: 'purchases' })];
  const { candidates, fresh } = findDuplicates([card('Sol Ring', { scryfallId: 'abc' })], existing);
  assert.equal(fresh.length, 0);
  assert.equal(candidates[0].strength, 'exact');
  assert.match(candidates[0].reason, /Scryfall id/);
});

check('a foil and a regular copy are never paired', () => {
  const existing = [card('Sol Ring', { foil: true, setCode: 'ltr' })];
  const { candidates, fresh } = findDuplicates([card('Sol Ring', { setCode: 'ltr' })], existing);
  assert.equal(candidates.length, 0, 'different finishes are different cards');
  assert.equal(fresh.length, 1, 'so the regular copy is simply added');
});

check('a foil is still matched against the same foil', () => {
  const existing = [card('Sol Ring', { foil: true, setCode: 'ltr' })];
  const { candidates } = findDuplicates([card('Sol Ring', { foil: true, setCode: 'ltr' })], existing);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].strength, 'exact');
});

check('a Scryfall id shared across finishes is not a match either', () => {
  // ManaBox gives a foil and a non-foil of one printing the same Scryfall id,
  // so the id alone must not be allowed to pair them.
  const existing = [card('Sol Ring', { foil: true, scryfallId: 'abc' })];
  const { candidates, fresh } = findDuplicates([card('Sol Ring', { scryfallId: 'abc' })], existing);
  assert.equal(candidates.length, 0);
  assert.equal(fresh.length, 1);
});

check('an unrelated card is fresh, not a candidate', () => {
  const { candidates, fresh } = findDuplicates([card('Rhystic Study')], [card('Sol Ring')]);
  assert.equal(candidates.length, 0);
  assert.equal(fresh.length, 1);
});

check('one existing row cannot answer for two incoming copies', () => {
  const existing = [card('Sol Ring', { setCode: 'ltr' })];
  const incoming = [card('Sol Ring', { setCode: 'ltr' }), card('Sol Ring', { setCode: 'ltr' })];
  const { candidates, fresh } = findDuplicates(incoming, existing);
  assert.equal(candidates.length, 1, 'only the first copy can match the one row you own');
  assert.equal(fresh.length, 1, 'the second copy is genuinely new');
});

check('applyImport drops what the user called a duplicate', () => {
  const existing = [card('Sol Ring', { quantity: 2, source: 'purchases' })];
  const incoming = [card('Sol Ring', { quantity: 3 }), card('Rhystic Study')];
  const out = applyImport(existing, incoming, [0]);
  assert.equal(out.length, 2, 'the duplicate was not added');
  assert.equal(qty(out, 'Sol Ring'), 2, 'the purchase row is untouched');
  assert.equal(qty(out, 'Rhystic Study'), 1);
});

check('applyImport adds what the user said was separate', () => {
  const existing = [card('Sol Ring', { quantity: 2, source: 'purchases' })];
  const out = applyImport(existing, [card('Sol Ring', { quantity: 3 })], []);
  assert.equal(qty(out, 'Sol Ring'), 5, 'two owned plus three imported');
  assert.equal(out.length, 2, 'kept as its own row, so purchase bookkeeping survives');
  assert.equal(out.find(c => c.source === 'import').quantity, 3);
});

check('applyImport merges into a previous import of the same printing', () => {
  const existing = [card('Sol Ring', { quantity: 1, setCode: 'ltr', source: 'import' })];
  const out = applyImport(existing, [card('Sol Ring', { quantity: 2, setCode: 'ltr' })], []);
  assert.equal(out.length, 1, 'no second row for the same printing');
  assert.equal(out[0].quantity, 3);
});

check('applyImport never mutates what it was given', () => {
  const existing = [card('Sol Ring', { quantity: 2, source: 'import' })];
  const snapshot = JSON.stringify(existing);
  applyImport(existing, [card('Sol Ring', { quantity: 5 })], []);
  assert.equal(JSON.stringify(existing), snapshot);
});

check('a whole ManaBox binder re-imported twice is all duplicates', () => {
  const inspection = inspectImport(MANABOX_CSV);
  const binder = inspection.parts.find(p => p.label === 'Main binder');
  const first = applyImport([], binder.cards, []);
  const { candidates, fresh } = findDuplicates(binder.cards, first);
  assert.equal(fresh.length, 0, 'nothing in the file is new the second time');
  assert.ok(
    candidates.every(c => c.strength === 'exact'),
    'and every pairing is exact, not a guess',
  );
});

// --- export, and back again --------------------------------------------------
//
// The exports exist to be read by ManaBox, which we can't run here. What we can
// check is that our own importer — written against ManaBox's real formats, with
// the fixtures above as evidence — reads back exactly what we wrote. A round trip
// that loses a commander or a foil marker would lose it in ManaBox too.

check('a deck exported as text comes back as the same deck', () => {
  const deck = only(inspectImport(MANABOX_DECK)).deck;
  const part = only(inspectImport(deckToText({ cards: deck })));
  assert.equal(part.kind, 'deck', 'and is still recognised as a deck, not a pile of cards');
  assert.equal(part.uncertain, false);
  const sorted = list => [...list].sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(sorted(part.deck), sorted(deck));
});

check('the commander survives the round trip', () => {
  const text = deckToText({
    cards: [
      { name: 'Talrand, Sky Summoner', quantity: 1, section: 'commander' },
      { name: 'Island', quantity: 30, section: 'main' },
      { name: 'Negate', quantity: 2, section: 'sideboard' },
    ],
  });
  const part = only(inspectImport(text));
  assert.equal(section(part.deck, 'Talrand, Sky Summoner'), 'commander', 'a comma in the name too');
  assert.equal(section(part.deck, 'Island'), 'main');
  assert.equal(section(part.deck, 'Negate'), 'sideboard');
});

check('a deck with no commander exports without an empty header', () => {
  const text = deckToText({ cards: [{ name: 'Island', quantity: 30, section: 'main' }] });
  assert.equal(text, '30 Island\n');
});

check('a collection exported as CSV comes back card for card', () => {
  const binder = inspectImport(MANABOX_CSV).parts.find(p => p.label === 'Main binder');
  const csv = collectionToCsv(binder.cards);
  const back = only(inspectImport(csv));
  assert.equal(back.kind, 'collection', 'and is not mistaken for a deck on the way in');
  assert.equal(back.cards.length, binder.cards.length);
  // Printing, finish and count are what a re-import hinges on; the rest is
  // detail ManaBox will fill in from the set and number itself.
  const trip = cards =>
    cards
      .map(c => `${c.name}|${c.setCode}|${c.collectorNumber}|${c.foil}|${c.quantity}`)
      .sort();
  assert.deepEqual(trip(back.cards), trip(binder.cards));
});

check('an exported collection re-imported into Lugin is all exact duplicates', () => {
  const binder = inspectImport(MANABOX_CSV).parts.find(p => p.label === 'Main binder');
  const owned = applyImport([], binder.cards, []);
  const { candidates, fresh } = findDuplicates(only(inspectImport(collectionToCsv(owned))).cards, owned);
  assert.equal(fresh.length, 0, 'a round trip invents no cards');
  assert.ok(candidates.every(c => c.strength === 'exact'));
});

check('a quoted name and an empty column do not shift the row', () => {
  // "Erayo, Soratami Ascendant" has the comma; a nameless set and no condition
  // are the columns a list-sourced row leaves blank.
  const cards = [
    { collectorNumber: '66', foil: false, name: 'Erayo, Soratami Ascendant', quantity: 1, setCode: 'chk' },
    { foil: true, name: 'Sol Ring', quantity: 2, setCode: 'ltr' },
  ];
  const back = only(inspectImport(collectionToCsv(cards))).cards;
  const erayo = back.find(c => c.name.startsWith('Erayo'));
  assert.equal(erayo.name, 'Erayo, Soratami Ascendant', 'the quoted comma stayed in the name');
  assert.equal(erayo.setCode.toLowerCase(), 'chk');
  assert.equal(back.find(c => c.name === 'Sol Ring').foil, true);
});

check('a collection of bare names is exported as a list, not an unusable CSV', () => {
  // ManaBox needs a set code or a Scryfall id to place a CSV row, so names alone
  // have to go as text or they arrive as nothing.
  const file = collectionFile({ cards: [{ foil: false, name: 'Sol Ring', quantity: 2 }] });
  assert.equal(file.mime, 'text/plain');
  assert.match(file.name, /\.txt$/);
  const back = only(inspectImport(file.text));
  assert.equal(qty(back.cards, 'Sol Ring'), 2);
});

check('a collection we know the printings of goes as CSV', () => {
  const file = collectionFile(
    { cards: [{ foil: false, name: 'Sol Ring', quantity: 2, setCode: 'ltr' }] },
    Date.UTC(2026, 7, 14),
  );
  assert.equal(file.mime, 'text/csv');
  assert.equal(file.name, 'lugin-collection-2026-08-14.csv');
});

check('a deck filename is the deck name, safe for a phone', () => {
  const file = deckFile({
    cards: [{ name: 'Island', quantity: 1, section: 'main' }],
    name: 'Talrand / Sky: Summoner!',
  });
  assert.equal(file.name, 'talrand-sky-summoner.txt');
});

// --- what it cost, and what it's worth ---------------------------------------

check('ManaBox CSV: the purchase price is kept, not dropped', () => {
  const binder = inspectImport(MANABOX_CSV).parts.find(p => p.label === 'Main binder');
  const sol = binder.cards.find(c => c.name === 'Sol Ring');
  assert.equal(sol.purchasePrice, 1.2, 'the column ManaBox writes on every scanned row');
  const erayo = binder.cards.find(c => c.name.startsWith('Erayo'));
  assert.equal(erayo.purchasePrice, 0.5);
});

check('a price written the European way is still a number', () => {
  const part = only(
    inspectImport('Name,Quantity,Purchase price\nSol Ring,1,"1,20 €"\n'),
  );
  assert.equal(part.cards[0].purchasePrice, 1.2);
});

check('a cost basis survives the round trip out and back', () => {
  const before = [
    { foil: false, name: 'Sol Ring', purchasePrice: 1.2, quantity: 2, setCode: 'ltr' },
  ];
  const back = only(inspectImport(collectionToCsv(before))).cards;
  assert.equal(back[0].purchasePrice, 1.2);
});

// A snapshot in the shape scripts/build-prices.mjs writes: cents, and 0 for
// "no price" — which is unambiguous, since no card is free.
const SNAPSHOT = {
  currency: ['eur', 'eur_foil', 'usd', 'usd_foil'],
  generated: '2026-08-14T09:05:00.000Z',
  names: { solring: [80, 450, 95, 500] },
  printings: {
    'dtk|71': [30, 0, 40, 0],
    'ltr|123': [120, 450, 140, 500],
  },
  source: 'scryfall:default_cards',
  unit: 'cents',
  version: 1,
};

const owned = (over = {}) => ({ foil: false, name: 'Sol Ring', quantity: 1, ...over });

check('a printing is priced by its own printing', () => {
  const price = priceOf(owned({ collectorNumber: '123', setCode: 'ltr' }), SNAPSHOT);
  assert.deepEqual(price, { cents: 120, exact: true });
});

check('a foil is priced as a foil', () => {
  const price = priceOf(owned({ collectorNumber: '123', foil: true, setCode: 'ltr' }), SNAPSHOT);
  assert.equal(price.cents, 450);
});

check('a foil with no foil price falls back, and says it is not exact', () => {
  // Better a low number than none: dropping the card would understate the total
  // by more than quoting the non-foil does.
  const price = priceOf(
    owned({ collectorNumber: '71', foil: true, name: 'Talrand, Sky Summoner', setCode: 'dtk' }),
    SNAPSHOT,
  );
  assert.deepEqual(price, { cents: 30, exact: false });
});

check('a bare name is priced by name, and flagged as a guess', () => {
  const price = priceOf(owned(), SNAPSHOT);
  assert.deepEqual(price, { cents: 80, exact: false }, 'the cheapest printing, so a floor');
});

check('a card nobody has a price for is not priced', () => {
  assert.equal(priceOf(owned({ name: 'Not A Real Card' }), SNAPSHOT), null);
});

check('the same card costs more in dollars', () => {
  const card = owned({ collectorNumber: '123', setCode: 'ltr' });
  assert.equal(priceOf(card, SNAPSHOT, 'usd').cents, 140);
});

check('quantities count: four copies are worth four', () => {
  const value = collectionValue(
    [owned({ collectorNumber: '123', quantity: 4, setCode: 'ltr' })],
    SNAPSHOT,
  );
  assert.equal(value.cents, 480);
  assert.equal(value.copies, 4);
  assert.equal(value.unpricedCopies, 0);
});

check('what could not be priced is reported, not silently dropped', () => {
  const value = collectionValue(
    [
      owned({ collectorNumber: '123', setCode: 'ltr' }),
      owned({ name: 'Not A Real Card', quantity: 3 }),
      owned({ name: 'Sol Ring', quantity: 2 }),
    ],
    SNAPSHOT,
  );
  assert.equal(value.cents, 120 + 160);
  assert.equal(value.unpricedCopies, 3, 'the three nobody can price');
  assert.equal(value.approxCopies, 2, 'and the two priced by name only');
});

check('the gain compares only the copies that recorded a price paid', () => {
  // One card bought at 1,00 and now worth 1,20; another with no recorded cost.
  // Counting the second card's value against the first card's cost would invent
  // a profit out of a card nobody knows the price of.
  const value = collectionValue(
    [
      owned({ collectorNumber: '123', purchasePrice: 1, setCode: 'ltr' }),
      owned({ collectorNumber: '123', quantity: 5, setCode: 'ltr' }),
    ],
    SNAPSHOT,
  );
  assert.equal(value.cents, 120 * 6, 'the whole lot is still valued');
  assert.equal(value.cost, 100);
  assert.equal(value.costValue, 120);
  assert.equal(value.gain, 20, 'only the copy with a basis');
  assert.equal(value.costCopies, 1);
});

check('a collection nobody recorded a cost for has no gain, rather than a gain of everything', () => {
  const value = collectionValue([owned({ collectorNumber: '123', setCode: 'ltr' })], SNAPSHOT);
  assert.equal(value.gain, null);
});

check('no snapshot yet means no numbers, not zeroes that look like an answer', () => {
  const value = collectionValue([owned({ collectorNumber: '123', setCode: 'ltr' })], null);
  assert.equal(value.cents, 0);
  assert.equal(value.copies, 0);
});

check('merging two lots of one printing blends what they cost', () => {
  // Two at 1,00 plus three at 2,00 is five at 1,60 — not five at either price.
  const existing = [owned({ purchasePrice: 1, quantity: 2, setCode: 'ltr', source: 'import' })];
  const merged = applyImport(existing, [owned({ purchasePrice: 2, quantity: 3, setCode: 'ltr' })], []);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].quantity, 5);
  assert.equal(merged[0].purchasePrice, 1.6);
});

check('merging into a lot with no recorded cost adopts the one there is', () => {
  const existing = [owned({ quantity: 1, setCode: 'ltr', source: 'import' })];
  const merged = applyImport(existing, [owned({ purchasePrice: 2, quantity: 1, setCode: 'ltr' })], []);
  assert.equal(merged[0].purchasePrice, 2);
});

check('money reads as money', () => {
  assert.equal(money(1234), '12,34 €');
  assert.equal(money(1234, 'usd'), '$12.34');
});

// ---------------------------------------------------------------------------
// Cost basis derived from Cardmarket orders
//
// These back the purchase sync's `purchasePrice`. Worth testing rather than
// eyeballing: every failure mode here produces a plausible-looking number, and a
// portfolio gain nobody can sanity-check is a portfolio gain nobody will question.
// ---------------------------------------------------------------------------

check('one order line is its own unit cost', () => {
  assert.deepEqual(withCost(everyPaid([{ price: 2.5, qty: 1 }])), { purchasePrice: 2.5 });
});

check('two order lines at different prices average by quantity', () => {
  // Two at 1,00 plus three at 2,00 is five at 1,60 — the same blend as an import.
  const paid = everyPaid([
    { price: 1, qty: 2 },
    { price: 2, qty: 3 },
  ]);
  assert.deepEqual(withCost(paid), { purchasePrice: 1.6 });
});

check('a line with no price is not a free copy', () => {
  // 5,00 for the one copy we know about. Averaging over both copies would report
  // 2,50 and invent a 100% gain out of a missing field.
  const paid = everyPaid([{ price: 5, qty: 1 }, { qty: 1 }]);
  assert.equal(paid.qty, 1);
  assert.deepEqual(withCost(paid), { purchasePrice: 5 });
});

check('no price anywhere leaves no basis, rather than a basis of zero', () => {
  assert.deepEqual(withCost(everyPaid([{ qty: 3 }])), {});
  assert.deepEqual(withCost(everyPaid([])), {});
  assert.deepEqual(withCost(undefined), {});
});

check('a free order line is treated as unrecorded, not as a cost of zero', () => {
  // Cardmarket shows 0,00 on gifts and corrections; a real card with a real basis
  // must not be dragged toward zero by one.
  assert.deepEqual(withCost(everyPaid([{ price: 0, qty: 1 }])), {});
});

check('a basis is rounded to the cent', () => {
  // Three copies for a euro is 0,3333… and would otherwise surface as a gain of a
  // fraction of a cent on a card nobody touched.
  assert.deepEqual(withCost(everyPaid([{ price: 1, qty: 3 }, { price: 0, qty: 0 }])), {
    purchasePrice: 1,
  });
  const thirds = withCost({ qty: 3, spent: 1 });
  assert.equal(thirds.purchasePrice, 0.33);
});

check('order lines are kept apart per printing', () => {
  // The same card bought in two editions must not blend into one basis: each row
  // in the collection is one printing and is valued as one.
  const paid = new Map();
  addPaid(paid, 'ltr|n', { price: 1 }, 1);
  addPaid(paid, 'cmr|n', { price: 9 }, 1);
  addPaid(paid, 'ltr|n', { price: 3 }, 1);
  assert.deepEqual(withCost(paid.get('ltr|n')), { purchasePrice: 2 });
  assert.deepEqual(withCost(paid.get('cmr|n')), { purchasePrice: 9 });
});

check('a nonsense price is ignored rather than propagated', () => {
  const paid = new Map();
  addPaid(paid, 'k', { price: Number.NaN }, 1);
  addPaid(paid, 'k', { price: Number.POSITIVE_INFINITY }, 1);
  assert.equal(paid.get('k'), undefined);
});

// ---------------------------------------------------------------------------
// What counts as arrived
// ---------------------------------------------------------------------------

/** Two copies delivered, one still in the post, one from before states existed. */
const DELIVERY = {
  cards: {
    'sol ring': {
      count: 4,
      name: 'Sol Ring',
      purchases: [
        { orderId: 'here', price: 1.5, qty: 2 },
        { orderId: 'posted', price: 2, qty: 1 },
        { orderId: 'ancient', price: 1, qty: 1 },
      ],
    },
    'black lotus': {
      count: 1,
      name: 'Black Lotus',
      purchases: [{ orderId: 'posted', price: 25000, qty: 1 }],
    },
  },
  orders: {
    ancient: {},
    here: { state: 'Arrived' },
    posted: { state: 'Sent' },
  },
};

check('a card in the post is not in your collection', () => {
  const arrived = arrivedOnly(DELIVERY);
  assert.equal(arrived.cards['black lotus'], undefined, 'its only copy is still in transit');
  assert.equal(arrived.cards['sol ring'].count, 3, '2 delivered + 1 from before states existed');
});

check('counts are recomputed, not carried over', () => {
  // `count` is the total ever bought. Trusting it would credit the collection
  // with copies that are still in a padded envelope.
  assert.equal(DELIVERY.cards['sol ring'].count, 4);
  assert.equal(arrivedOnly(DELIVERY).cards['sol ring'].count, 3);
});

check('an order with no known state counts as arrived', () => {
  // Unknown is overwhelmingly "old order, indexed before states were captured".
  // Reading it as undelivered would quietly empty a collection.
  assert.equal(hasArrived(undefined), true);
  assert.equal(hasArrived(''), true);
  assert.equal(hasArrived('Arrived'), true);
  assert.equal(hasArrived('Paid'), false, 'paid for is not the same as received');
  assert.equal(hasArrived('Sent'), false);
  assert.equal(hasArrived('NotArrived'), false, 'a disputed order least of all');
});

check('an index synced before states existed keeps every card', () => {
  const old = { cards: DELIVERY.cards };
  assert.equal(Object.keys(arrivedOnly(old).cards).length, 2);
  assert.equal(arrivedOnly(old).cards['sol ring'].count, 4);
});

check('a card with no order lines at all is kept on its total', () => {
  const odd = { cards: { x: { count: 3, name: 'X' } }, orders: {} };
  assert.equal(arrivedOnly(odd).cards.x.count, 3);
});

check('what is still travelling can be counted, so the UI can say so', () => {
  assert.equal(inTransitCopies(DELIVERY), 2, 'one Sol Ring and the Lotus');
  assert.equal(inTransitCopies({ cards: {} }), 0);
});

check('filtering leaves the rest of the index alone', () => {
  const arrived = arrivedOnly(DELIVERY);
  assert.deepEqual(arrived.orders, DELIVERY.orders);
  assert.deepEqual(DELIVERY.cards['sol ring'].purchases.length, 3, 'input is not mutated');
});

// ---------------------------------------------------------------------------
// Who you buy from, rolled up from order history
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;
const AUG = Date.parse('2026-08-01');

/** Two orders from Alice, one from Bob, and one whose seller was never captured. */
const HISTORY = {
  cards: {
    'sol ring': {
      count: 3,
      name: 'Sol Ring',
      purchases: [
        { orderId: 'a1', price: 1.5, qty: 2 },
        { orderId: 'b1', price: 2, qty: 1 },
      ],
    },
    'llanowar elves': {
      count: 4,
      name: 'Llanowar Elves',
      purchases: [
        { orderId: 'a2', price: 0.25, qty: 3 },
        { orderId: 'ghost', price: 9, qty: 1 },
      ],
    },
  },
  orders: {
    a1: { paidTs: AUG, seller: 'Alice', sellerSlug: 'alice', sellerUrl: '/en/Magic/Users/alice', sentTs: AUG + DAY },
    a2: { paidTs: AUG + 10 * DAY, seller: 'Alice', sellerSlug: 'alice', sentTs: AUG + 15 * DAY },
    b1: { paidTs: AUG + 2 * DAY, seller: 'Bob', sellerSlug: 'bob' },
    ghost: { paidTs: AUG },
  },
  shipping: { a1: 1.2, a2: 1.3, b1: 5 },
};

check('sellers are ranked by how often you bought from them', () => {
  const stats = sellerStats(HISTORY);
  assert.equal(stats.length, 2, 'the order with no seller forms no seller');
  assert.equal(stats[0].slug, 'alice');
  assert.equal(stats[0].orders, 2);
  assert.equal(stats[1].slug, 'bob');
});

check('spend excludes postage, and postage is its own figure', () => {
  const [alice] = sellerStats(HISTORY);
  // 2 × 1,50 + 3 × 0,25 = 3,75 on cards; 1,20 + 1,30 = 2,50 of postage.
  assert.equal(alice.spent, 3.75);
  assert.equal(alice.shipping, 2.5);
  assert.equal(alice.copies, 5);
  assert.equal(alice.cards, 2, 'distinct cards, not copies');
});

check('postage per copy is what a cheap-shipping seller is actually worth', () => {
  const [alice, bob] = sellerStats(HISTORY);
  assert.equal(shippingPerCopy(alice), 0.5);
  // Bob charges 5,00 to send a single card, which is the whole point of the metric.
  assert.equal(shippingPerCopy(bob), 5);
});

check('handling time is the median of paid-to-sent, in days', () => {
  const [alice] = sellerStats(HISTORY);
  // One order shipped next day, one after five: the median of two is their mean.
  assert.equal(alice.handlingDays, 3);
  assert.equal(alice.handlingSamples, 2);
});

check('a seller who never showed a dispatch date reports no handling time', () => {
  const [, bob] = sellerStats(HISTORY);
  assert.equal(bob.handlingDays, null, 'not zero, which would read as same-day');
  assert.equal(bob.handlingSamples, 0);
});

check('one observation is reported as one observation', () => {
  const stats = sellerStats({
    cards: {},
    orders: { x: { paidTs: AUG, sellerSlug: 's', sentTs: AUG + 2 * DAY } },
  });
  assert.equal(stats[0].handlingDays, 2);
  assert.equal(stats[0].handlingSamples, 1, 'so the UI can refuse to call it a rate');
});

check('a dispatch before payment is discarded rather than counted as negative', () => {
  const stats = sellerStats({
    cards: {},
    orders: { x: { paidTs: AUG, sellerSlug: 's', sentTs: AUG - 5 * DAY } },
  });
  assert.equal(stats[0].handlingDays, null);
});

check('first and last purchase bracket the history', () => {
  const [alice] = sellerStats(HISTORY);
  assert.equal(alice.sinceTs, AUG);
  assert.equal(alice.lastTs, AUG + 10 * DAY);
  assert.equal(daysSince(alice.lastTs, AUG + 12 * DAY), 2);
});

check('a seller with an order but no readable card rows still appears', () => {
  const stats = sellerStats({ cards: {}, orders: { x: { sellerSlug: 'ghost-shop' } } });
  assert.equal(stats.length, 1);
  assert.equal(stats[0].orders, 1);
  assert.equal(stats[0].spent, 0);
});

check('orders whose seller is unknown are counted, so a re-sync can be offered', () => {
  assert.equal(ordersWithoutSeller(HISTORY), 1);
  assert.equal(ordersWithoutSeller({ cards: {} }), 0);
});

check('a history synced before sellers existed yields no sellers and no crash', () => {
  const old = { cards: HISTORY.cards, shipping: HISTORY.shipping };
  assert.deepEqual(sellerStats(old), []);
  assert.equal(ordersWithoutSeller(old), 4);
});

check('the display name falls back to the slug rather than showing blank', () => {
  const stats = sellerStats({ cards: {}, orders: { x: { sellerSlug: 'quietshop' } } });
  assert.equal(stats[0].name, 'quietshop');
});

// ---------------------------------------------------------------------------
// Reading the seller and the timeline off an order page
// ---------------------------------------------------------------------------

check('a seller is identified by slug, not by the locale in the URL', () => {
  assert.equal(sellerSlugFromHref('/en/Magic/Users/FKTRD'), 'FKTRD');
  assert.equal(sellerSlugFromHref('/fr/Magic/Users/FKTRD/Offers'), 'FKTRD');
  assert.equal(sellerSlugFromHref('/de/Magic/Users/FKTRD?foo=1#x'), 'FKTRD');
  assert.equal(sellerSlugFromHref('/en/Magic/Products/Singles'), undefined);
  assert.equal(sellerSlugFromHref(null), undefined);
});

check('an escaped slug is decoded, so the name matches what is displayed', () => {
  assert.equal(sellerSlugFromHref('/en/Magic/Users/Mr%20Cards'), 'Mr Cards');
});

check('an icon-only seller link still yields a usable name', () => {
  assert.equal(sellerFrom('/en/Magic/Users/shop', '  ').name, 'shop');
  assert.equal(sellerFrom('/en/Magic/Users/shop', '>').name, 'shop', 'one glyph is not a name');
  assert.equal(sellerFrom('/en/Magic/Users/shop', ' Card Shop ').name, 'Card Shop');
});

const paidSent = (paid, sent) => timelineFrom([`Paid: ${paid}`, `Sent: ${sent}`]);

check('paid and sent dates come off the timeline', () => {
  const t = paidSent('01.08.2026', '03.08.2026');
  assert.equal(t.date, '01.08.2026');
  assert.equal(t.ts, Date.parse('2026-08-01'));
  assert.equal(t.sentTs, Date.parse('2026-08-03'));
});

check('the timeline is read in every locale Cardmarket serves', () => {
  for (const [paidLabel, sentLabel] of [
    ['Paid', 'Sent'],
    ['Bezahlt', 'Versandt'],
    ['Payé', 'Envoyé'],
    ['Payée', 'Expédiée'],
    ['Pagato', 'Spedito'],
    ['Pagado', 'Enviado'],
    ['Betaald', 'Verzonden'],
  ]) {
    const t = timelineFrom([`${paidLabel}: 01.08.2026`, `${sentLabel}: 04.08.2026`]);
    assert.equal(t.ts, Date.parse('2026-08-01'), `paid in ${paidLabel}`);
    assert.equal(t.sentTs, Date.parse('2026-08-04'), `sent in ${sentLabel}`);
  }
});

check('a date is only taken from the box that labels it', () => {
  // Arrival is later than dispatch; reading it as the dispatch would flatter the
  // seller's handling time with the postal service's transit.
  const t = timelineFrom(['Paid: 01.08.2026', 'Sent: 02.08.2026', 'Arrived: 09.08.2026']);
  assert.equal(t.sentTs, Date.parse('2026-08-02'));
});

check('an unrecognized layout still dates the order from the first date it finds', () => {
  const t = timelineFrom(['Something unfamiliar'], 'Ordered 01.08.2026');
  assert.equal(t.date, '01.08.2026');
  assert.equal(t.sentTs, undefined);
});

check('a dispatch earlier than payment is refused rather than stored', () => {
  assert.equal(paidSent('05.08.2026', '01.08.2026').sentTs, undefined);
});

check('a same-day dispatch is kept, and is genuinely zero days', () => {
  const t = paidSent('05.08.2026', '05.08.2026');
  assert.equal(t.sentTs, t.ts);
});

check('an order with no dates yields no dates', () => {
  assert.deepEqual(timelineFrom([]), {});
});

// ---------------------------------------------------------------------------
// Whether to greet someone
// ---------------------------------------------------------------------------

const FRESH = {
  collection: false,
  hydrated: true,
  purchases: false,
  wants: false,
  welcomed: false,
};

check('a brand new user is welcomed', () => {
  assert.equal(shouldWelcome(FRESH), true);
});

check('nothing is decided until storage has answered', () => {
  // The whole point: before hydration a returning user looks identical to a new
  // one, so the honest answer is "not yet" rather than "welcome".
  assert.equal(shouldWelcome({ ...FRESH, hydrated: false }), null);
  assert.equal(shouldWelcome({ ...FRESH, hydrated: false, wants: true }), null);
});

check('any one source of data means the app, not a greeting', () => {
  assert.equal(shouldWelcome({ ...FRESH, wants: true }), false);
  assert.equal(shouldWelcome({ ...FRESH, purchases: true }), false);
  assert.equal(shouldWelcome({ ...FRESH, collection: true }), false, 'an upload is data too');
});

check('a skip sticks, even though the user still has nothing', () => {
  assert.equal(shouldWelcome({ ...FRESH, welcomed: true }), false);
});

// --- purchases meeting a collection ------------------------------------------
//
// The fold-in used to append its rows to whatever was already there, so a card
// scanned into ManaBox *and* bought on Cardmarket was counted twice — and the
// count looked perfectly normal, which is what made it worth testing.

/** As the fold-in derives them: an edition name and a product id, never a set code. */
const bought = (name, extra = {}) => ({
  foil: false,
  name,
  quantity: 1,
  setName: 'The Lord of the Rings',
  source: 'purchases',
  ...extra,
});

/** As ManaBox exports them: a set code, a collector number, sometimes a set name. */
const scanned = (name, extra = {}) => ({
  collectorNumber: '1',
  foil: false,
  name,
  quantity: 1,
  setCode: 'ltr',
  setName: 'The Lord of the Rings',
  source: 'import',
  ...extra,
});

check('a bought card and the same scanned card are paired on the set name', () => {
  // Neither side shares a set *code*, so without the name tier this could only
  // ever be graded "maybe" — true but useless for deciding.
  const { candidates } = findDuplicates([bought('Sol Ring')], [scanned('Sol Ring')]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].strength, 'likely');
  assert.match(candidates[0].reason, /The Lord of the Rings/);
});

check('two rows that both omit a set are not "the same set"', () => {
  const { candidates } = findDuplicates(
    [card('Sol Ring')],
    [card('Sol Ring', { source: 'purchases' })],
  );
  assert.equal(candidates.length, 1, 'they still meet on name and finish');
  assert.equal(candidates[0].strength, 'possible', 'but neither row earned a set match');
});

check('an unanswered collision is withheld, not added', () => {
  const { add, held } = splitPurchases([bought('Sol Ring')], [scanned('Sol Ring')], {});
  assert.equal(add.length, 0, 'nothing grows the collection before you answer');
  assert.equal(held.length, 1);
  assert.equal(held[0].incoming.name, 'Sol Ring');
});

check('a purchase matching nothing you own is added without asking', () => {
  const { add, held } = splitPurchases([bought('Rhystic Study')], [scanned('Sol Ring')], {});
  assert.equal(held.length, 0);
  assert.deepEqual(add.map(c => c.name), ['Rhystic Study']);
});

check('"I already own it" drops the purchase for good', () => {
  const row = bought('Sol Ring');
  const decided = { [purchaseKey(row)]: 'own' };
  const { add, held } = splitPurchases([row], [scanned('Sol Ring')], decided);
  assert.equal(add.length, 0);
  assert.equal(held.length, 0, 'and the question is not asked again');
});

check('"that is a different copy" adds it and stops asking', () => {
  const row = bought('Sol Ring');
  const decided = { [purchaseKey(row)]: 'separate' };
  const { add, held } = splitPurchases([row], [scanned('Sol Ring')], decided);
  assert.deepEqual(add.map(c => c.name), ['Sol Ring']);
  assert.equal(held.length, 0);
});

check('buying a third copy does not reopen a settled question', () => {
  // The key has to survive re-derivation, which is the only reason answers can
  // be remembered at all — the fold-in rebuilds every purchase row each sync.
  assert.equal(purchaseKey(bought('Sol Ring', { quantity: 1 })), purchaseKey(bought('Sol Ring', { quantity: 3 })));
});

check('a foil purchase is a separate question from the regular one', () => {
  assert.notEqual(purchaseKey(bought('Sol Ring')), purchaseKey(bought('Sol Ring', { foil: true })));
});

check('purchase rows are never matched against each other', () => {
  // `owned` is the rows the fold-in is *not* replacing. Handing it the previous
  // purchase rows would pair every card with its own past self and withhold the
  // whole history, so the store filters them out first; this pins the shape.
  const rows = [bought('Sol Ring'), bought('Rhystic Study')];
  const { add, held } = splitPurchases(rows, [], {});
  assert.equal(held.length, 0);
  assert.equal(add.length, 2);
});

check('answers about purchases no longer in the history are forgotten', () => {
  const stale = purchaseKey(bought('Black Lotus'));
  const live = purchaseKey(bought('Sol Ring'));
  const pruned = pruneVerdicts({ [stale]: 'own', [live]: 'separate' }, [bought('Sol Ring')]);
  assert.deepEqual(pruned, { [live]: 'separate' });
});

check('two copies bought of a card you own ask once, about both copies', () => {
  const { add, held } = splitPurchases([bought('Sol Ring', { quantity: 2 })], [scanned('Sol Ring')], {});
  assert.equal(add.length, 0);
  assert.equal(held.length, 1);
  assert.equal(held[0].incoming.quantity, 2, 'the row is one question, whatever it holds');
});

// --- which picture is this card ----------------------------------------------
//
// Every source a row can come from knows a different amount about the printing,
// and the wrong rung of the ladder means a picture of somebody else's copy.

const ID = '0123abcd-4567-89ef-0123-456789abcdef';

check('a Scryfall id goes straight to the image CDN, not the API', () => {
  // The API route is a redirect and a rate-limited call every single time; the
  // CDN file is cached by the browser. Same picture, very different cost.
  const url = cardImageUrl({ name: 'Sol Ring', scryfallId: ID });
  assert.match(url, /^https:\/\/cards\.scryfall\.io\/normal\/front\/0\/1\//);
  assert.ok(url.endsWith(`${ID}.jpg`));
});

check('a malformed Scryfall id is ignored rather than built into a broken URL', () => {
  const url = cardImageUrl({ name: 'Sol Ring', scryfallId: 'not-an-id' });
  assert.doesNotMatch(url, /cards\.scryfall\.io/);
  assert.match(url, /named\?exact=Sol%20Ring/);
});

check('a Cardmarket product id outranks a set code', () => {
  // Both name a printing, but the product id is what the purchase actually was.
  const url = cardImageUrl({
    collectorNumber: '1',
    name: 'Sol Ring',
    productId: '12345',
    setCode: 'ltr',
  });
  assert.match(url, /\/cards\/cardmarket\/12345\?/);
});

check('set and collector number pin the printing when there is no id', () => {
  const url = cardImageUrl({ collectorNumber: '279', name: 'Sol Ring', setCode: 'M21' });
  assert.match(url, /\/cards\/m21\/279\?/, 'and the set code is lowercased for the path');
});

check('a set code with no collector number is not enough to name a printing', () => {
  // Scryfall would need both; falling through to the name is the honest answer.
  const url = cardImageUrl({ name: 'Sol Ring', setCode: 'ltr' });
  assert.match(url, /named\?exact=/);
});

check('a card known only by name still has a picture', () => {
  assert.match(cardImageUrl({ name: 'Lim-Dûl’s Vault' }), /named\?exact=Lim-D/);
});

check('a deck card borrows the picture of the copy you own', () => {
  // A deck row is only ever a name; the collection is what knows which printing
  // of it is in your binder.
  const images = imagesByName([
    { collectorNumber: '263', name: 'Sol Ring', setCode: 'c21' },
    { name: 'Llanowar Elves', scryfallId: '0000a0a0-0000-4000-8000-000000000000' },
  ]);
  assert.match(images.get(cardKey('Sol Ring')), /\/cards\/c21\/263\?/);
  assert.match(images.get(cardKey('Llanowar Elves')), /^https:\/\/cards\.scryfall\.io\//);
});

check('a rank a row cannot cash in does not beat one that can', () => {
  // A bare set code resolves to nothing better than a name lookup, so it must not
  // outrank a row carrying a real image URL.
  const images = imagesByName([
    { name: 'Sol Ring', setCode: 'c21' },
    { imageUrl: 'https://product-images.s3.cardmarket.com/1/C21/1.jpg', name: 'Sol Ring' },
  ]);
  assert.equal(images.get(cardKey('Sol Ring')), 'https://product-images.s3.cardmarket.com/1/C21/1.jpg');
});

check('the printing that pins itself down hardest supplies the picture', () => {
  // Four copies of one card from four sources: the Scryfall id wins, whatever
  // order the rows happen to arrive in.
  const rows = [
    { name: 'Sol Ring' },
    { name: 'Sol Ring', scryfallId: '0000a0a0-0000-4000-8000-000000000000' },
    { name: 'Sol Ring', productId: '265584' },
    { name: 'Sol Ring', setCode: 'c21', collectorNumber: '263' },
  ];
  const forward = imagesByName(rows).get(cardKey('Sol Ring'));
  const backward = imagesByName([...rows].reverse()).get(cardKey('Sol Ring'));
  assert.match(forward, /^https:\/\/cards\.scryfall\.io\//);
  assert.equal(forward, backward);
});

check('a card you do not own is still worth a name-only picture', () => {
  // Which is the whole point of the fallback: most of a deck being built is not
  // in the collection yet.
  assert.equal(imagesByName([{ name: 'Sol Ring' }]).get(cardKey('Rhystic Study')), undefined);
  assert.match(imageUrlFor(undefined, 'Rhystic Study'), /cards\/named\?exact=Rhystic%20Study/);
});

check('a row that identifies nothing at all yields no URL', () => {
  assert.equal(cardImageUrl({}), undefined);
});

// --- building a deck ----------------------------------------------------------
//
// "New deck" exists on the desktop and on the phone, and the two have to produce
// the same object: a deck made on one device is opened on the other.

check('a new deck is empty, Commander, and stamped once', () => {
  const deck = newDeck({ at: 1000 });
  assert.deepEqual(deck.cards, []);
  assert.equal(deck.format, 'commander');
  assert.equal(deck.source, 'manual');
  assert.equal(deck.createdAt, 1000);
  assert.equal(deck.updatedAt, 1000, 'a deck nobody has touched was not edited after it was made');
});

check('a deck with no name given still has one', () => {
  assert.equal(newDeck({}).name, 'New deck');
  assert.equal(newDeck({ name: '   ' }).name, 'New deck', 'and whitespace is not a name');
  assert.equal(newDeck({ name: '  Tokens ' }).name, 'Tokens');
});

check('two decks made in the same millisecond are still two decks', () => {
  assert.notEqual(newDeck({ at: 1 }).id, newDeck({ at: 1 }).id);
});

check('leaving Commander rescues the command zone instead of hiding it', () => {
  // The cards are still in the deck and still counted, so a format switch that
  // left them in a zone the UI no longer draws would look like theft.
  const deck = {
    cards: [
      { name: 'Talrand', quantity: 1, section: 'commander' },
      { name: 'Sol Ring', quantity: 1, section: 'main' },
    ],
    format: 'commander',
  };
  const moved = withFormat(deck, 'modern');
  assert.equal(moved.format, 'modern');
  assert.deepEqual(moved.cards.map(c => c.section), ['main', 'main']);
});

check('a format that keeps a command zone leaves the commander alone', () => {
  const deck = { cards: [{ name: 'Talrand', quantity: 1, section: 'commander' }], format: 'commander' };
  assert.equal(withFormat(deck, 'commander').cards[0].section, 'commander');
});

check('adding a card you already run bumps the row rather than repeating it', () => {
  const merged = mergeDeckCards(
    [{ name: 'Lightning Bolt', quantity: 3, section: 'main' }],
    [{ name: 'lightning bolt', quantity: 1, section: 'main' }],
  );
  assert.equal(merged.length, 1, 'a decklist exported after this must not say Bolt twice');
  assert.equal(merged[0].quantity, 4);
});

check('the same card in another zone is a different row', () => {
  const merged = mergeDeckCards(
    [{ name: 'Lightning Bolt', quantity: 3, section: 'main' }],
    [{ name: 'Lightning Bolt', quantity: 2, section: 'sideboard' }],
  );
  assert.equal(merged.length, 2);
});

check('merging never mutates the deck it was given', () => {
  const before = [{ name: 'Sol Ring', quantity: 1, section: 'main' }];
  mergeDeckCards(before, [{ name: 'Sol Ring', quantity: 4, section: 'main' }]);
  assert.equal(before[0].quantity, 1);
});

check('a pasted list becomes a deck through the same parser the desktop uses', () => {
  const { cards } = parseDeckList('// Commander\n1 Talrand\n\n2 Sol Ring\n2 Sol Ring');
  const deck = deckFromImport(cards, { at: 5, source: 'pasted list' });
  assert.equal(deck.format, 'commander', 'because the list named a commander');
  assert.equal(deck.cards.find(c => c.section === 'commander').name, 'Talrand');
  assert.equal(
    deck.cards.find(c => c.section === 'main').quantity,
    4,
    'and a card listed twice is one row',
  );
});

// --- speaking Cardmarket's search protocol -----------------------------------
//
// Every check below is anchored to one real request captured from the site's own
// search box while typing "abru". Reproducing it byte for byte is the whole
// contract: there is no error we would recognise if we got it subtly wrong, only
// a search that silently returns nothing.

const CAPTURED_TOKEN = '383c7b04684168c6f3d5012a88c08c0d5060059da4cc386cd85ac8cf021f5175';
const CAPTURED_ARGS =
  '%08%2B5%3F%29%3E%2A%003%04%03%11%07%0DLMBZRX%0FZ%0C_DGJGECN%14N%1FI%1FIMOM%E1%B9%BA%E0%B4' +
  '%BD%E5%B7%EC%BC%BA%BD%BC%BD%BB%B6%F4%F0%A6%F0%F7%A6%AE%A1%FB%FD%A2%AE%FD%FE%A6%FC%C6%91%90' +
  '%92%C2%90%97%90%9D%2A%2A%2AeyJzZWFyY2hTdHJpbmciOiJhYnJ1Iiwic2VhcmNoTW9kZSI6InYyIiwicHJvZHV' +
  'jdENhdGVnb3J5SWRzIjpudWxsLCJyZXNwb25zaXZlIjoiMSJ9';

/** The scrambled half of an `args` value, back as the bytes that were sent. */
const scrambledHalf = args =>
  args
    .slice(0, args.indexOf('%2A%2A%2A'))
    .replace(/%([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

check('a built search request is byte-identical to the one the site sends', () => {
  assert.equal(buildArgs(CAPTURED_TOKEN, { searchString: 'abru' }), CAPTURED_ARGS);
});

check('the scramble is its own inverse', () => {
  const plain = 'Product_Search***deadbeef';
  assert.equal(obfuscate(obfuscate(plain)), plain);
});

check('the scrambled half really is the action name and the session token', () => {
  // Documents what the format *is*, so the next person does not have to break it
  // again to find out.
  assert.equal(obfuscate(scrambledHalf(CAPTURED_ARGS)), `Product_Search***${CAPTURED_TOKEN}`);
  assert.equal(tokenFromArgs(CAPTURED_ARGS), CAPTURED_TOKEN);
});

check('high bytes go out raw, not as UTF-8', () => {
  // The trap: encodeURIComponent turns this one byte into two (%C3%A1), which
  // shifts every later character of the scramble and voids the token.
  assert.equal(encodeArgs(String.fromCharCode(0xe1)), '%E1');
  assert.equal(encodeURIComponent(String.fromCharCode(0xe1)), '%C3%A1');
});

check('base64 padding and symbols survive form encoding', () => {
  // A raw '+' in a form body arrives at the server as a space, so a search whose
  // parameters happened to encode with one would silently lose it.
  assert.equal(encodeArgs('a+b/c='), 'a%2Bb%2Fc%3D');
});

check('a search term with an accent still produces a token the server accepts', () => {
  // Only the scrambled half is length-sensitive; the term rides in base64. This
  // guards the seam between the two.
  const args = buildArgs(CAPTURED_TOKEN, { searchString: 'Æther' });
  assert.equal(obfuscate(scrambledHalf(args)), `Product_Search***${CAPTURED_TOKEN}`);
});

check('a suggestion is pinned to its printing through the image URL', () => {
  assert.deepEqual(
    productFactsFromImage('https://product-images.s3.cardmarket.com/1/RTR/258288/258288.jpg'),
    { productId: '258288', setCode: 'RTR' },
  );
});

check('promo set codes with digits survive', () => {
  assert.equal(
    productFactsFromImage('https://product-images.s3.cardmarket.com/1/MB2/784551/784551.jpg')
      .setCode,
    'MB2',
  );
});

check('a thumbnail we cannot read leaves the printing unpinned rather than guessed', () => {
  // Better a suggestion that only knows its name than one confidently attached
  // to the wrong expansion.
  assert.deepEqual(productFactsFromImage(undefined), {});
  assert.deepEqual(productFactsFromImage('/img/placeholder.svg'), {});
});

// ---------------------------------------------------------------------------
// Editions: dating a set, and reconciling three catalogues' spellings of it
// ---------------------------------------------------------------------------

// A slice of Scryfall's catalogue, chosen for the cases that actually caused
// trouble: a colon in a real name, a set with a Cardmarket-only offshoot, and a
// year with several releases to order.
const SETS = buildSetIndex([
  { code: 'lea', name: 'Limited Edition Alpha', releasedAt: '1993-08-05' },
  { code: 'rtr', name: 'Return to Ravnica', releasedAt: '2012-10-05' },
  { code: 'grn', name: 'Guilds of Ravnica', releasedAt: '2018-10-05' },
  { code: 'pgrn', name: 'Guilds of Ravnica Promos', releasedAt: '2018-10-05' },
  { code: 'sld', name: 'Secret Lair Drop', releasedAt: '2019-12-02' },
  { code: 'tsr', name: 'Time Spiral Remastered', releasedAt: '2021-03-19' },
  { code: 'vow', name: 'Innistrad: Crimson Vow', releasedAt: '2021-11-19' },
  { code: 'mkm', name: 'Murders at Karlov Manor', releasedAt: '2024-02-09' },
  { code: 'pip', name: 'Fallout', releasedAt: '2024-03-08' },
  { code: 'otj', name: 'Outlaws of Thunder Junction', releasedAt: '2024-04-19' },
  { code: 'blb', name: 'Bloomburrow', releasedAt: '2024-08-02' },
]);

check('normalising a set name folds case, accents and punctuation', () => {
  // Shared with expansionIconStore, which keys its sprites on this.
  assert.equal(normalizeSetName('Innistrad: Crimson Vow'), 'innistrad crimson vow');
  assert.equal(normalizeSetName('Jumpstart 2022'), 'jumpstart 2022');
});

check('a set code beats whatever the row calls the expansion', () => {
  // A localised Cardmarket page names the set in German; the code still pins it.
  assert.equal(
    resolveSet(SETS, { setCode: 'MKM', setName: 'Mord im Karlov Manor' })?.name,
    'Murders at Karlov Manor',
  );
});

check('punctuation does not stop a name matching', () => {
  // Cardmarket writes the colon, ManaBox exports drop it.
  assert.equal(resolveSet(SETS, { setName: 'Innistrad Crimson Vow' })?.code, 'vow');
});

check('a Cardmarket sub-expansion falls back to its parent set', () => {
  assert.equal(resolveSet(SETS, { setName: 'Time Spiral Remastered: Extras' })?.code, 'tsr');
});

check('printings of one set file together however the row spells it', () => {
  assert.equal(editionIdOf(SETS, { setName: 'Time Spiral Remastered' }), 'tsr');
  assert.equal(editionIdOf(SETS, { setName: 'Time Spiral Remastered: Extras' }), 'tsr');
});

check('the oldest sets, which Cardmarket renames outright, still date', () => {
  // "Alpha" and "Limited Edition Alpha" share no words to match on, and these
  // are the expensive printings people most want to filter down to.
  assert.equal(resolveSet(SETS, { setName: 'Alpha' })?.code, 'lea');
});

check('a crossover set matches once its Cardmarket label comes off', () => {
  assert.equal(resolveSet(SETS, { setName: 'Universes Beyond: Fallout' })?.code, 'pip');
});

check('every Secret Lair superdrop leads back to the one Scryfall set', () => {
  // Cardmarket sells each drop as its own expansion; Scryfall keeps one.
  const drop = 'Secret Lair Drop Series: Back to School Superdrop';
  assert.equal(resolveSet(SETS, { setName: drop })?.code, 'sld');
});

check('a set genuinely named "Promos" is itself, not its parent', () => {
  // The loosening rules must never outrank the name as written.
  assert.equal(resolveSet(SETS, { setName: 'Guilds of Ravnica: Promos' })?.code, 'pgrn');
  assert.equal(resolveSet(SETS, { setName: 'Guilds of Ravnica: Tokens' })?.code, 'grn');
});

check('an expansion Scryfall has never heard of stays filterable', () => {
  const odd = { setName: 'Some Cardmarket Oddity' };
  assert.equal(resolveSet(SETS, odd), undefined);
  assert.equal(editionIdOf(SETS, odd), 'some cardmarket oddity');
});

check('editions group by year, newest first within each year', () => {
  const years = groupEditionsByYear(
    tallyEditions(
      [
        { setName: 'Bloomburrow' },
        { setName: 'Return to Ravnica' },
        { setName: 'Murders at Karlov Manor' },
        { setName: 'Outlaws of Thunder Junction' },
        { setName: 'Murders at Karlov Manor' },
      ],
      SETS,
    ),
  );
  assert.deepEqual(
    years.map(y => y.year),
    [2024, 2012],
  );
  assert.deepEqual(
    years[0].editions.map(e => `${e.label} ${e.count}`),
    ['Bloomburrow 1', 'Outlaws of Thunder Junction 1', 'Murders at Karlov Manor 2'],
  );
  assert.equal(years[0].count, 4);
});

check('editions we cannot date sort last rather than disappearing', () => {
  const years = groupEditionsByYear(
    tallyEditions([{ setName: 'Some Cardmarket Oddity' }, { setName: 'Bloomburrow' }], SETS),
  );
  assert.deepEqual(
    years.map(y => y.year),
    [2024, null],
  );
  assert.equal(years[1].editions[0].label, 'Some Cardmarket Oddity');
});

check('an empty catalogue degrades to one alphabetical group, not an empty filter', () => {
  // What the UI shows before the worker's copy of the catalogue arrives.
  const none = buildSetIndex([]);
  const years = groupEditionsByYear(
    tallyEditions([{ setName: 'Bloomburrow' }, { setName: 'Alliances' }], none),
  );
  assert.deepEqual(
    years.map(y => y.year),
    [null],
  );
  assert.deepEqual(
    years[0].editions.map(e => e.label),
    ['Bloomburrow', 'Alliances'],
  );
});

check('a product URL names its expansion', () => {
  assert.equal(
    expansionFromProductUrl('/en/Magic/Products/Singles/Return-to-Ravnica/Abrupt-Decay?language=1'),
    'Return to Ravnica',
  );
  assert.equal(
    expansionFromProductUrl('/en/Magic/Products/Singles/Guilds-of-Ravnica-Guild-Kits/Abrupt-Decay'),
    'Guilds of Ravnica Guild Kits',
  );
});

check('an expansion page is not mistaken for a card in a set', () => {
  assert.equal(expansionFromProductUrl('/en/Magic/Products/Singles/Return-to-Ravnica'), undefined);
  assert.equal(expansionFromProductUrl(undefined), undefined);
});

check('an expansion read off a URL resolves to a dated set', () => {
  // The whole chain a search-results row goes through: href to slug to set.
  const setName = expansionFromProductUrl(
    '/en/Magic/Products/Singles/Time-Spiral-Remastered-Extras/Abrupt-Decay?language=1,2,5',
  );
  assert.equal(setName, 'Time Spiral Remastered Extras');
  assert.equal(resolveSet(SETS, { setName })?.releasedAt, '2021-03-19');
});

await rm(out, { force: true, recursive: true });

console.log(failed === 0 ? '\nall import checks passed' : `\n${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
