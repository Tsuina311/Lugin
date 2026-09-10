#!/usr/bin/env node
/**
 * Build compact type-index.json from Scryfall default_cards / oracle faces.
 *
 *   node scripts/build-type-index.mjs --out .scan-fixtures/type-index.json
 *   node scripts/build-type-index.mjs --limit 2000 --out /tmp/type-index.json
 */
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = name => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const out = arg('out') ?? join(root, '.scan-fixtures/type-index.json');
const limit = Number(arg('limit') ?? '0') || 0;
const AGENT = 'Lugin/1.0 (+https://github.com/Tsuina311/Lugin)';
const BULK_INDEX = 'https://api.scryfall.com/bulk-data';

const fold = s =>
  String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[-—–―]/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const SUPERTYPES = new Set(['basic', 'legendary', 'ongoing', 'snow', 'world']);
const CARD_TYPES = new Set([
  'artifact',
  'battle',
  'conspiracy',
  'creature',
  'dungeon',
  'enchantment',
  'instant',
  'kindred',
  'land',
  'phenomenon',
  'plane',
  'planeswalker',
  'scheme',
  'sorcery',
  'tribal',
  'vanguard',
]);

const fetchJson = async url => {
  const res = await fetch(url, { headers: { 'User-Agent': AGENT } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
};

const index = await fetchJson(BULK_INDEX);
const dump = index.data.find(d => d.type === 'default_cards');
if (!dump) throw new Error('no default_cards dump');

const res = await fetch(dump.jsonl_download_uri ?? dump.download_uri, {
  headers: { 'User-Agent': AGENT },
});
if (!res.ok) throw new Error(`download ${res.status}`);
const gunzip = createGunzip();
Readable.fromWeb(res.body).pipe(gunzip);
const rl = createInterface({ input: gunzip, crlfDelay: Infinity });

const oracleOrdinal = new Map();
const oracles = [];
const cardTypeList = [...CARD_TYPES].sort();
const cardTypeId = new Map(cardTypeList.map((t, i) => [t, i]));
const superList = [...SUPERTYPES].sort();
const superId = new Map(superList.map((t, i) => [t, i]));
const subtypeId = new Map();
const subtypes = [];
const faces = [];
const signatures = Object.create(null);
const printedLines = Object.create(null);
const subtypePostings = Object.create(null);
const seenFace = new Set();

const ensureSubtype = name => {
  if (subtypeId.has(name)) return subtypeId.get(name);
  const id = subtypes.length;
  subtypes.push(name);
  subtypeId.set(name, id);
  return id;
};

const parseTypeLine = line => {
  const norm = fold(line);
  const parts = norm.split(/\s+/).filter(Boolean);
  let cardTypeMask = 0;
  let supertypeMask = 0;
  const subtypeIds = [];
  let afterDash = false;
  // Scryfall uses " — " between types and subtypes.
  const dashIdx = norm.indexOf('  ');
  void dashIdx;
  const rawParts = String(line)
    .split(/[-—–―]/)
    .map(s => s.trim());
  const left = fold(rawParts[0] || '');
  const right = fold(rawParts.slice(1).join(' '));
  for (const w of left.split(' ').filter(Boolean)) {
    if (SUPERTYPES.has(w)) supertypeMask |= 1 << superId.get(w);
    else if (CARD_TYPES.has(w)) cardTypeMask |= 1 << cardTypeId.get(w);
  }
  if (right) {
    // Greedy multi-word not available at build without full vocab — split words,
    // then also register full right as a phrase if multi-word.
    const words = right.split(' ').filter(Boolean);
    if (words.length > 1) subtypeIds.push(ensureSubtype(right));
    for (const w of words) subtypeIds.push(ensureSubtype(w));
  }
  return { cardTypeMask, normalizedTypeLine: norm, subtypeIds: [...new Set(subtypeIds)], supertypeMask };
};

let seen = 0;
for await (const line of rl) {
  if (!line.trim()) continue;
  let card;
  try {
    card = JSON.parse(line);
  } catch {
    continue;
  }
  if (!card?.oracle_id) continue;
  if (card.digital) continue;
  if (card.layout === 'art_series' || card.layout === 'token') continue;
  if (Array.isArray(card.games) && !card.games.includes('paper')) continue;

  const oid = card.oracle_id;
  if (!oracleOrdinal.has(oid)) {
    oracleOrdinal.set(oid, oracles.length);
    oracles.push(oid);
  }
  const oOrd = oracleOrdinal.get(oid);

  const faceList =
    Array.isArray(card.card_faces) && card.card_faces.length
      ? card.card_faces.map((f, i) => ({
          faceIndex: i,
          faceName: f.name,
          printed_type_line: f.printed_type_line,
          type_line: f.type_line || card.type_line,
        }))
      : [
          {
            faceIndex: 0,
            faceName: card.name,
            printed_type_line: card.printed_type_line,
            type_line: card.type_line,
          },
        ];

  for (const f of faceList) {
    if (!f.type_line) continue;
    const key = `${oid}|${f.faceIndex}|${fold(f.type_line)}`;
    if (seenFace.has(key)) continue;
    seenFace.add(key);
    const parsed = parseTypeLine(f.type_line);
    const faceIndex = faces.length;
    const face = {
      cardTypeMask: parsed.cardTypeMask,
      faceIndex: f.faceIndex,
      ...(f.faceName ? { faceName: f.faceName } : {}),
      normalizedTypeLine: parsed.normalizedTypeLine,
      oracleOrdinal: oOrd,
      subtypeIds: parsed.subtypeIds,
      supertypeMask: parsed.supertypeMask,
    };
    if (f.printed_type_line && card.lang && card.lang !== 'en') {
      const pn = fold(f.printed_type_line);
      face.printed = { [card.lang]: pn };
      printedLines[card.lang] = printedLines[card.lang] || Object.create(null);
      const bucket = printedLines[card.lang][pn] || (printedLines[card.lang][pn] = []);
      bucket.push(faceIndex);
    }
    faces.push(face);
    const sig = signatures[parsed.normalizedTypeLine] || (signatures[parsed.normalizedTypeLine] = []);
    sig.push(faceIndex);
    for (const sid of parsed.subtypeIds) {
      const k = String(sid);
      const post = subtypePostings[k] || (subtypePostings[k] = []);
      if (!post.length || post[post.length - 1] !== oOrd) post.push(oOrd);
    }
  }

  seen += 1;
  if (limit && seen >= limit) break;
  if (seen % 25000 === 0) console.log(`… ${seen} cards`);
}

// Sort postings
for (const k of Object.keys(subtypePostings)) {
  subtypePostings[k] = [...new Set(subtypePostings[k])].sort((a, b) => a - b);
}

const payload = {
  version: 1,
  generated: new Date().toISOString(),
  source: dump.download_uri,
  oracles,
  cardTypes: cardTypeList,
  supertypes: superList,
  subtypes,
  faces,
  signatures,
  subtypePostings,
  printedLines,
};

await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(payload)}\n`);
const bytes = Buffer.byteLength(JSON.stringify(payload));
console.log(
  `type-index: ${oracles.length} oracles · ${faces.length} faces · ${subtypes.length} subtypes · ${(bytes / 1e6).toFixed(1)} MB → ${out}`,
);
