#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const latestPath = join(root, '.scan-inbox', 'latest.json');

if (!existsSync(latestPath)) {
  console.log('No inbox upload yet. Run yarn scan:inbox and capture a geometry trace.');
  process.exit(1);
}

const latest = JSON.parse(await readFile(latestPath, 'utf8'));
console.log(`path: ${latest.path}`);
console.log(`type: ${latest.traceType ?? '—'}`);
console.log(`phase: ${latest.scannerPhase ?? '—'}`);
console.log(`session: ${latest.sessionId}`);
console.log(`trace: ${latest.traceId}`);
console.log(`created: ${latest.createdAt}`);

const reportJson = join(root, latest.path, 'report.json');
const geometryJson = join(root, latest.path, 'geometry-trace.json');
const metaJson = join(root, latest.path, 'meta.json');
const pick = existsSync(reportJson)
  ? reportJson
  : existsSync(geometryJson)
    ? geometryJson
    : metaJson;
if (existsSync(pick)) {
  const raw = JSON.parse(await readFile(pick, 'utf8'));
  const samples = raw.samples?.length ?? raw.meta?.sampleCount ?? null;
  const phase = raw.meta?.phase ?? raw.scannerPhase ?? latest.scannerPhase;
  console.log(`file: ${pick.slice(root.length + 1)}`);
  if (samples != null || latest.sampleCount != null) {
    console.log(`samples: ${samples ?? latest.sampleCount}`);
  }
  if (phase) console.log(`report phase: ${phase}`);
}
