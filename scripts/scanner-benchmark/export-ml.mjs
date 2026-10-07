#!/usr/bin/env node
/** yarn scanner:export-ml-dataset — manifest only. Does not copy images or train. */

import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { loadAnnotations } from './lib/annotations.mjs';
import { manifestsDir } from './lib/paths.mjs';

const stills = JSON.parse(await readFile(`${manifestsDir}/stills-v1.json`, 'utf8'));
const ann = await loadAnnotations();
const ident = new Map(ann.identities.map(row => [row.imageId, row]));
const corners = new Map(ann.corners.map(row => [row.imageId, row]));
const tags = new Map();
for (const row of ann.tags) {
  const prev = tags.get(row.imageId) ?? [];
  tags.set(row.imageId, [...prev, ...row.tags]);
}

const rows = stills.items.map(item => ({
  imageId: item.imageId,
  path: item.path,
  sessionId: item.sessionId,
  split: item.split,
  identity: ident.get(item.imageId) ?? { status: 'UNKNOWN' },
  corners: corners.get(item.imageId) ?? null,
  tags: [...new Set(tags.get(item.imageId) ?? [])],
}));

await mkdir(manifestsDir, { recursive: true });
const out = {
  datasetVersion: stills.datasetVersion,
  datasetHash: stills.datasetHash,
  generatedAt: new Date().toISOString(),
  note: 'Paths are repo-relative. Image bytes are not duplicated. Do not train from UNKNOWN rows.',
  rows,
};
await writeFile(`${manifestsDir}/ml-export-v1.json`, `${JSON.stringify(out, null, 2)}\n`);
console.log(`Exported ${rows.length} rows to scanner-benchmark/manifests/ml-export-v1.json`);
