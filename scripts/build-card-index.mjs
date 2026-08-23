// Distil Scryfall's bulk dump into the card-name index the scanner matches against.
//
//   node scripts/build-card-index.mjs --out dist-web/card-names.json
//   node scripts/build-card-index.mjs --input slice.jsonl --out /tmp/names.json
//   node scripts/build-card-index.mjs --langs en --out /tmp/en-only.json
//
// Why an index at all: OCR does not have to spell a card name correctly, it only
// has to get close enough that the right card wins against every other card. That
// turns transcription into identification, and identification needs the list to
// compare against. Without it the scanner has to ask Scryfall what it just read,
// which costs a round trip per attempt, fails with no signal, and — because
// Scryfall's fuzzy endpoint answers with one card and no score — cannot offer the
// user a choice when the read is genuinely ambiguous.
//
// Localized titles are the other half. A French card prints "Anneau solaire", and
// the scanner has to store "Sol Ring"; mapping one to the other locally is what
// makes a non-English card resolve at all offline.
//
// `all_cards` rather than `default_cards`, because the default dump carries only
// one language per card and the whole point here is the printed titles. It is a
// much larger download, which is why this runs in CI and not on a phone.

import { execSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';

const BULK_INDEX = 'https://api.scryfall.com/bulk-data';
// Scryfall asks for a descriptive agent; an anonymous flood is what they're
// trying to avoid by publishing these files in the first place.
const AGENT = 'Lugin/1.0 (+https://github.com/Tsuina311/Lugin)';

const arg = name => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const out = arg('out');
if (!out) {
  console.error(
    'usage: node scripts/build-card-index.mjs --out <file> [--input <jsonl>] [--langs en,fr,de,it]',
  );
  process.exit(1);
}

/**
 * EN plus the print languages the scanner loads OCR models for. Adding a language
 * here is only useful alongside a Tesseract model that can read it.
 */
const langs = new Set((arg('langs') ?? 'en,fr,de,it').split(',').map(s => s.trim()));

const lines = async () => {
  const input = arg('input');
  if (input) return createInterface({ crlfDelay: Infinity, input: createReadStream(input) });

  const index = await fetch(BULK_INDEX, { headers: { 'User-Agent': AGENT } });
  if (!index.ok) throw new Error(`bulk index: ${index.status} ${index.statusText}`);
  const { data } = await index.json();
  // Only `all_cards` carries printed_name for every language.
  const wanted = langs.size > 1 || !langs.has('en') ? 'all_cards' : 'default_cards';
  const dump = data.find(d => d.type === wanted);
  if (!dump) throw new Error(`no ${wanted} dump in the bulk index`);
  console.log(
    `${wanted} updated ${dump.updated_at}, ` +
      `${(dump.compressed_size / 1e6).toFixed(0)} MB gzipped`,
  );

  const res = await fetch(dump.jsonl_download_uri, { headers: { 'User-Agent': AGENT } });
  if (!res.ok || !res.body) throw new Error(`dump: ${res.status} ${res.statusText}`);
  return createInterface({
    crlfDelay: Infinity,
    input: Readable.fromWeb(res.body).pipe(createGunzip()),
  });
};

/** Canonical English name → position in the output list. */
const names = new Map();
/** lang → printed title → English name. Resolved to positions at the end. */
const printed = new Map();

const nameId = name => {
  const found = names.get(name);
  if (found !== undefined) return found;
  const id = names.size;
  names.set(name, id);
  return id;
};

const addPrinted = (lang, title, english) => {
  const clean = title?.trim();
  if (!clean || clean === english) return;
  if (!printed.has(lang)) printed.set(lang, new Map());
  const bucket = printed.get(lang);
  // First writer wins: the same printed title across many printings is one entry,
  // and a title shared by two cards is a genuine ambiguity we cannot resolve here.
  if (!bucket.has(clean)) bucket.set(clean, english);
};

/** Front face of a multi-face name — what is actually printed in the title bar. */
const frontFace = name => {
  const i = name.indexOf('//');
  return i === -1 ? name : name.slice(0, i).trim();
};

let seen = 0;
let kept = 0;

for await (const line of await lines()) {
  if (!line || line === '[' || line === ']') continue;
  const card = JSON.parse(line.replace(/,\s*$/, ''));
  seen += 1;

  // A collection is paper by definition, and an oversized novelty is not the card
  // anybody is scanning.
  if (!card.games?.includes('paper')) continue;
  if (card.oversized) continue;
  if (!card.name || !langs.has(card.lang)) continue;
  kept += 1;

  // `name` is the English/oracle name on every printing, whatever its language.
  const english = card.name;
  nameId(english);

  // The title bar shows the front face only, so a split or transforming card is
  // read as half of the name we store.
  addPrinted('en', frontFace(english), english);

  if (card.lang !== 'en' && card.printed_name) {
    addPrinted(card.lang, card.printed_name, english);
    addPrinted(card.lang, frontFace(card.printed_name), english);
  }
}

// Sorted so a rebuild of identical data produces identical bytes: diffable, and
// gzip does better on runs of similar keys.
const ordered = [...names.keys()].sort((a, b) => (a < b ? -1 : 1));
const position = new Map(ordered.map((name, i) => [name, i]));

const printedOut = {};
for (const [lang, bucket] of [...printed.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
  const rows = [];
  for (const [title, english] of bucket) {
    const at = position.get(english);
    if (at !== undefined) rows.push([at, title]);
  }
  rows.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1));
  if (rows.length) printedOut[lang] = rows;
}

const snapshot = {
  generated: new Date().toISOString(),
  names: ordered,
  printed: printedOut,
  source: 'scryfall:bulk',
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
  `${seen.toLocaleString()} objects read, ${kept.toLocaleString()} kept\n` +
    `${ordered.length.toLocaleString()} card names\n` +
    Object.entries(printedOut)
      .map(([lang, rows]) => `  ${lang}: ${rows.length.toLocaleString()} printed titles`)
      .join('\n') +
    `\n${out}: ${(written / 1e6).toFixed(1)} MB` +
    (gz ? ` (${(gz / 1e6).toFixed(1)} MB gzipped, which is what a phone downloads)` : ''),
);
