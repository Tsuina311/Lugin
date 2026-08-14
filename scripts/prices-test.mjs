// Does the price snapshot say what we think it says? (`yarn test:prices`)
//
// Worth testing because every failure here is silent and expensive: a snapshot
// that quietly includes Arena printings, or reads dollars into the euro slot, or
// drops foils, produces a collection value that looks entirely plausible and is
// wrong. Nobody double-checks a number they can't see the working for.
//
// Runs the real script against a fixture instead of importing its internals, so
// the argument parsing and the file it writes are covered too.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dir = await mkdtemp(join(tmpdir(), 'lugin-prices-test-'));

// One card in two paper printings and one digital, a card whose only foil is
// etched, and a card with no prices at all.
const BULK = [
  {
    collector_number: '123',
    games: ['paper'],
    name: 'Sol Ring',
    prices: { eur: '1.20', eur_foil: '4.50', usd: '1.40', usd_foil: '5.00' },
    set: 'LTR',
  },
  {
    collector_number: '472',
    games: ['paper'],
    name: 'Sol Ring',
    prices: { eur: '0.80', usd: '0.95' },
    set: 'cmr',
  },
  { collector_number: '1', games: ['arena'], name: 'Sol Ring', prices: { eur: '0.01' }, set: 'ath' },
  {
    collector_number: '71',
    games: ['paper', 'arena'],
    name: 'Talrand, Sky Summoner',
    prices: { eur: '0.30', eur_etched: '9.00' },
    set: 'dtk',
  },
  { collector_number: '9', games: ['paper'], name: 'Pricelessness', prices: {}, set: 'xxx' },
];

const input = join(dir, 'bulk.jsonl');
const out = join(dir, 'prices.json');
await writeFile(input, `${BULK.map(card => JSON.stringify(card)).join('\n')}\n`);
execFileSync('node', [join(root, 'scripts/build-prices.mjs'), '--input', input, '--out', out], {
  stdio: 'ignore',
});
const snapshot = JSON.parse(await readFile(out, 'utf8'));

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

check('prices are cents, not euros', () => {
  // Floats would drift on a 20,000-row sum, and "1.2" is not a price anyone can
  // add up twice and get the same answer for.
  assert.deepEqual(snapshot.printings['ltr|123'], [120, 450, 140, 500]);
  assert.equal(snapshot.unit, 'cents');
});

check('the set code is a key regardless of how the dump cased it', () => {
  assert.ok(snapshot.printings['ltr|123'], 'LTR was uppercase in the dump');
  assert.ok(snapshot.printings['cmr|472']);
});

check('a digital-only printing is not in a paper collection', () => {
  assert.equal(snapshot.printings['ath|1'], undefined, 'nobody owns cardboard from Arena');
});

check('a card that is also on Arena still counts as paper', () => {
  assert.ok(snapshot.printings['dtk|71'], 'it says paper as well');
});

check('an etched foil is a foil, since that is all the importers can tell', () => {
  assert.equal(snapshot.printings['dtk|71'][1], 900);
});

check('a printing with no prices at all is left out', () => {
  assert.equal(snapshot.printings['xxx|9'], undefined);
  assert.equal(snapshot.names.pricelessness, undefined);
});

check('a missing price is 0, which no card costs', () => {
  assert.equal(snapshot.printings['cmr|472'][1], 0, 'no foil price in the dump');
});

check('the name index holds the cheapest printing, so a guess reads as a floor', () => {
  assert.equal(snapshot.names.solring[0], 80, 'the cmr copy, not the ltr one');
});

check('the name key is the app\u2019s own loose key', () => {
  // Punctuation and case are what differ between a ManaBox export and Scryfall's
  // spelling, so the key has to survive both. A drift here means the name index
  // matches nothing and every list-imported collection is worth zero.
  assert.ok(snapshot.names.talrandskysummoner, Object.keys(snapshot.names).join(', '));
});

check('the file says where it came from and when', () => {
  assert.equal(snapshot.source, 'scryfall:default_cards');
  assert.equal(snapshot.version, 1);
  assert.ok(Number.isFinite(Date.parse(snapshot.generated)));
  assert.deepEqual(snapshot.currency, ['eur', 'eur_foil', 'usd', 'usd_foil']);
});

check('rebuilding the same dump gives the same bytes, apart from the timestamp', () => {
  // Sorted keys, so a daily rebuild is diffable and gzip has a good run at it.
  const second = join(dir, 'again.json');
  execFileSync('node', [join(root, 'scripts/build-prices.mjs'), '--input', input, '--out', second], {
    stdio: 'ignore',
  });
  const drop = text => text.replace(/"generated":"[^"]+",/, '');
  assert.equal(drop(readFileSync(out, 'utf8')), drop(readFileSync(second, 'utf8')));
});

console.log(failed === 0 ? '\nall price checks passed' : `\n${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
