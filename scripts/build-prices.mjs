// Distil Scryfall's daily bulk dump into a price snapshot the app can hold.
//
//   node scripts/build-prices.mjs --out dist-web/prices.json
//   node scripts/build-prices.mjs --input fixture.jsonl --out /tmp/prices.json
//
// Why a snapshot at all: prices are the one thing you want for *every* card you
// own at once. Asking per card is what makes the extension's trend lookup take
// minutes — one page fetch each, paced so as not to hammer Cardmarket — and no
// amount of caching fixes the first run. ManaBox feels instant because it never
// asks per card: it holds a price table locally and sums it. This is that table.
//
// Scryfall publishes the whole card database daily and asks that bulk consumers
// use these files rather than the per-card API, so this is the sanctioned route.
// The dump is ~80 MB gzipped, which is nothing in CI and impossible on a phone —
// hence distilling: everything except the prices is thrown away, leaving a couple
// of megabytes that a phone downloads once a day.
//
// Two indexes come out, because collections arrive knowing different things:
//
//   printings: "set|collector number" -> the exact printing you own.
//   names:     a loose card name      -> the *cheapest* paper printing of it.
//
// The name index only exists for rows that never had a printing — a collection
// imported from a bare list. Cheapest rather than average or newest so that an
// inexact total reads as a floor: better to under-claim what someone owns than to
// invent value they can't sell.

import { execSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { createGunzip } from 'node:zlib';

const BULK_INDEX = 'https://api.scryfall.com/bulk-data';
// Scryfall asks for a descriptive agent; an anonymous flood is what they're
// trying to avoid by publishing these files in the first place.
const AGENT = 'Lugin/1.0 (+https://github.com/Tsuina311/lugin)';

const arg = name => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const out = arg('out');
if (!out) {
  console.error('usage: node scripts/build-prices.mjs --out <file> [--input <jsonl>]');
  process.exit(1);
}

// The client and this script have to agree on how a name becomes a key, or the
// name index silently misses everything. So it uses the app's own function
// rather than a re-implementation that can drift.
const root = new URL('..', import.meta.url).pathname;
const { build } = await import(pathToFileURL(join(root, 'node_modules/esbuild/lib/main.js')).href);
const tmp = await mkdtemp(join(tmpdir(), 'lugin-prices-'));
await writeFile(join(tmp, 'entry.ts'), `export * from '${root}src/lib/cardName';`);
await build({
  bundle: true,
  entryPoints: [join(tmp, 'entry.ts')],
  format: 'esm',
  outfile: join(tmp, 'cardName.mjs'),
  platform: 'neutral',
});
const { looseKey } = await import(pathToFileURL(join(tmp, 'cardName.mjs')).href);

/** Cents, or 0 for "no price" — no card costs nothing, so 0 is unambiguous. */
const cents = value => {
  const n = Number.parseFloat(value ?? '');
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
};

const lines = async () => {
  const input = arg('input');
  if (input) return createInterface({ crlfDelay: Infinity, input: createReadStream(input) });

  const index = await fetch(BULK_INDEX, { headers: { 'User-Agent': AGENT } });
  if (!index.ok) throw new Error(`bulk index: ${index.status} ${index.statusText}`);
  const { data } = await index.json();
  const dump = data.find(d => d.type === 'default_cards');
  if (!dump) throw new Error('no default_cards dump in the bulk index');
  console.log(
    `default_cards updated ${dump.updated_at}, ${(dump.compressed_size / 1e6).toFixed(1)} MB gzipped`,
  );

  const res = await fetch(dump.jsonl_download_uri, { headers: { 'User-Agent': AGENT } });
  if (!res.ok || !res.body) throw new Error(`dump: ${res.status} ${res.statusText}`);
  return createInterface({
    crlfDelay: Infinity,
    input: Readable.fromWeb(res.body).pipe(createGunzip()),
  });
};

const printings = new Map();
const names = new Map();
let seen = 0;
let paper = 0;

/** Keep the cheaper of two entries per slot, treating 0 as "nothing yet". */
const cheaper = (into, key, row) => {
  const prev = into.get(key);
  if (!prev) {
    into.set(key, [...row]);
    return;
  }
  for (let i = 0; i < row.length; i += 1) {
    if (row[i] > 0 && (prev[i] === 0 || row[i] < prev[i])) prev[i] = row[i];
  }
};

for await (const line of await lines()) {
  if (!line || line === '[' || line === ']') continue;
  const card = JSON.parse(line.replace(/,\s*$/, ''));
  seen += 1;
  // Digital-only printings have prices too, in a currency you cannot spend on
  // cardboard. A collection is paper by definition.
  if (!card.games?.includes('paper')) continue;
  paper += 1;

  const prices = card.prices ?? {};
  // Etched counts as foil: the importers fold "etched" into the foil flag, so a
  // price index that kept them apart would have nothing to answer with.
  const row = [
    cents(prices.eur),
    cents(prices.eur_foil) || cents(prices.eur_etched),
    cents(prices.usd),
    cents(prices.usd_foil) || cents(prices.usd_etched),
  ];
  if (row.every(v => v === 0)) continue;

  if (card.set && card.collector_number) {
    printings.set(`${card.set}|${card.collector_number}`.toLowerCase(), row);
  }
  if (card.name) cheaper(names, looseKey(card.name), row);
}

// Sorted so a rebuild of the same data produces the same bytes: it makes the
// file diffable and gives gzip a better run of similar keys.
const sorted = map => Object.fromEntries([...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));

const snapshot = {
  currency: ['eur', 'eur_foil', 'usd', 'usd_foil'],
  generated: new Date().toISOString(),
  names: sorted(names),
  printings: sorted(printings),
  source: 'scryfall:default_cards',
  unit: 'cents',
  version: 1,
};

await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(snapshot));
const written = (await readFile(out)).length;
const gz = (() => {
  try {
    return Number(execSync(`gzip -c ${JSON.stringify(out)} | wc -c`).toString().trim());
  } catch {
    return 0;
  }
})();

console.log(
  `${seen.toLocaleString()} cards read, ${paper.toLocaleString()} paper\n` +
    `${Object.keys(snapshot.printings).length.toLocaleString()} printings, ` +
    `${Object.keys(snapshot.names).length.toLocaleString()} names\n` +
    `${out}: ${(written / 1e6).toFixed(1)} MB` +
    (gz ? ` (${(gz / 1e6).toFixed(1)} MB gzipped, which is what a phone downloads)` : ''),
);
