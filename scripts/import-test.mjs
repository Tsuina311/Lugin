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
  applyImport,
  collectionFile,
  collectionToCsv,
  deckFile,
  deckToText,
  findDuplicates,
  inspectImport,
  parseCardLine,
  parseDeckList,
  parseTable,
  sectionHeader,
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

await rm(out, { force: true, recursive: true });

console.log(failed === 0 ? '\nall import checks passed' : `\n${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
