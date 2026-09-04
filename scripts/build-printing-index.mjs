#!/usr/bin/env node
/**
 * Build compact printing-index.json from Scryfall default_cards bulk.
 *
 *   node scripts/build-printing-index.mjs --out dist-web/printing-index.json
 *   node scripts/build-printing-index.mjs --limit 500 --out .scan-fixtures/printing-index.json
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

const out = arg('out') ?? join(root, '.scan-fixtures/printing-index.json');
const limit = Number(arg('limit') ?? '0') || 0;
const AGENT = 'Lugin/1.0 (+https://github.com/Tsuina311/Lugin)';
const BULK_INDEX = 'https://api.scryfall.com/bulk-data';

const fetchJson = async url => {
  const res = await fetch(url, { headers: { 'User-Agent': AGENT } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
};

const index = await fetchJson(BULK_INDEX);
const dump = index.data.find(d => d.type === 'default_cards');
if (!dump) throw new Error('no default_cards dump');
console.log(
  `default_cards updated ${dump.updated_at}, ${(dump.compressed_size / 1e6).toFixed(1)} MB gzipped`,
);

const res = await fetch(dump.jsonl_download_uri ?? dump.download_uri, { headers: { 'User-Agent': AGENT } });
if (!res.ok) throw new Error(`download ${res.status}`);
const gunzip = createGunzip();
Readable.fromWeb(res.body).pipe(gunzip);
const rl = createInterface({ input: gunzip, crlfDelay: Infinity });

const entries = [];
let seen = 0;
for await (const line of rl) {
  if (!line.trim()) continue;
  let card;
  try {
    card = JSON.parse(line);
  } catch {
    continue;
  }
  if (!card?.id || !card.set || card.collector_number == null) continue;
  if (card.digital) continue;
  if (card.layout === 'art_series' || card.layout === 'token') continue;
  if (card.oversized) continue;
  // Paper Magic printings only.
  if (Array.isArray(card.games) && !card.games.includes('paper')) continue;

  entries.push({
    setCode: String(card.set).toLowerCase(),
    collectorNumber: String(card.collector_number),
    scryfallId: card.id,
    oracleId: card.oracle_id ?? card.id,
    name: card.name,
    lang: card.lang ?? 'en',
    finishes: Array.isArray(card.finishes) && card.finishes.length ? card.finishes : ['nonfoil'],
    ...(card.illustration_id ? { illustrationId: card.illustration_id } : {}),
    ...(card.layout ? { layout: card.layout } : {}),
    ...(card.set_name ? { setName: card.set_name } : {}),
  });
  seen += 1;
  if (limit && seen >= limit) break;
  if (seen % 25000 === 0) console.log(`… ${seen} printings`);
}

await mkdir(dirname(out), { recursive: true });
const payload = {
  version: 1,
  generated: new Date().toISOString(),
  source: 'scryfall:default_cards',
  sourceUpdatedAt: dump.updated_at,
  entries,
};
await writeFile(out, JSON.stringify(payload));
const bytes = Buffer.byteLength(JSON.stringify(payload));
console.log(
  `wrote ${out}: ${entries.length} printings · ${(bytes / 1e6).toFixed(1)} MB uncompressed`,
);

// Sanity: Chaos Dragon AFC 30 / 030
const chaos = entries.filter(
  e => e.setCode === 'afc' && (e.collectorNumber === '30' || e.collectorNumber === '030'),
);
console.log(
  `sanity AFC/30: ${chaos.length} hit(s) → ${chaos.map(c => c.name).join(', ') || '(none)'}`,
);
