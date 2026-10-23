#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const esbuild = createRequire(join(root, 'package.json'))('esbuild');
const built = await esbuild.build({
  bundle: true,
  format: 'cjs',
  platform: 'node',
  stdin: {
    contents: `
      export { matchesDeckTagQuery } from './src/lib/deckTagMatch.ts';
      export { DECK_TAGS } from './src/lib/deckTags.ts';
    `,
    resolveDir: root,
  },
  write: false,
});
const module = { exports: {} };
new Function('module', 'exports', 'require', built.outputFiles[0].text)(
  module,
  module.exports,
  createRequire(import.meta.url),
);
const { DECK_TAGS, matchesDeckTagQuery } = module.exports;
const query = id => DECK_TAGS.find(tag => tag.id === id)?.query ?? '';

// Every locally supported catalogue query must tokenize/compile without hanging
// or throwing, even when the empty card does not match it.
for (const tag of DECK_TAGS) {
  if (tag.query.includes('otag:')) continue;
  assert.doesNotThrow(() =>
    matchesDeckTagQuery({ name: 'Blank', oracleText: '', typeLine: '' }, tag.query),
  );
}

const madness = {
  keywords: ['Flying', 'Madness'],
  name: 'Kitchen Imp',
  oracleText: 'Flying\nMadness {B}',
  typeLine: 'Creature — Imp',
};
assert.equal(matchesDeckTagQuery(madness, query('madness')), true);
assert.equal(matchesDeckTagQuery(madness, query('lifegain')), false);

const drawTrigger = {
  keywords: [],
  name: 'Niv-Mizzet, Parun',
  oracleText: 'Whenever you draw a card, Niv-Mizzet, Parun deals 1 damage to any target.',
  typeLine: 'Legendary Creature — Dragon Wizard',
};
assert.equal(matchesDeckTagQuery(drawTrigger, query('draw')), true);
assert.equal(matchesDeckTagQuery(drawTrigger, query('draw-trigger')), true);
assert.equal(matchesDeckTagQuery(drawTrigger, query('tribe-dragon')), true);

const wardDiscard = {
  keywords: ['Flying', 'Ward'],
  name: 'Maha, Its Feathers Night',
  oracleText: 'Flying, trample\nWard—Discard a card.',
  typeLine: 'Legendary Creature — Elemental Bird',
};
assert.equal(matchesDeckTagQuery(wardDiscard, query('self-discard')), false);

const treasure = {
  keywords: [],
  name: 'Big Score',
  oracleText:
    'As an additional cost to cast this spell, discard a card.\nDraw two cards and create two Treasure tokens.',
  typeLine: 'Instant',
};
assert.equal(matchesDeckTagQuery(treasure, query('treasure')), true);
assert.equal(matchesDeckTagQuery(treasure, query('self-discard')), true);

console.log('deck-tag local match ok');
