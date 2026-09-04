#!/usr/bin/env node
// Query production (or local) art-index.json for named cards.
// Usage:
//   node scripts/scan-art-coverage.mjs
//   node scripts/scan-art-coverage.mjs --url https://…/art-index.json
//   node scripts/scan-art-coverage.mjs --file .scan-fixtures/art-index.json --name "Chaos Dragon"

import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const url = get('--url') ?? 'https://tsuina311.github.io/Lugin/art-index.json';
const file = get('--file');
const names = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--name' && args[i + 1]) names.push(args[++i]);
}
if (!names.length) names.push('Chaos Dragon', 'Pixie Guide');

const raw = file
  ? JSON.parse(await readFile(file, 'utf8'))
  : await (await fetch(url)).json();
const art = raw.art ?? raw;
const entries = art.entries ?? [];
const uniqueOracles = new Set(entries.map((e) => e.oracleId)).size;

console.log(
  JSON.stringify(
    {
      source: file ?? url,
      entries: entries.length,
      uniqueOracles,
      version: art.version ?? raw.version ?? null,
      generated: art.generated ?? raw.generated ?? null,
      cards: names.map((name) => {
        const hits = entries.filter((e) => e.name === name);
        return {
          name,
          present: hits.length > 0,
          descriptorCount: hits.length,
          oracleIds: [...new Set(hits.map((h) => h.oracleId))],
          printingIds: hits.map((h) => h.scryfallId).filter(Boolean),
          sets: [...new Set(hits.map((h) => h.setCode).filter(Boolean))],
        };
      }),
    },
    null,
    2,
  ),
);
