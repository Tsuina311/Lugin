#!/usr/bin/env node
/**
 * yarn scan:continuous-report [session-prefix]
 * Summarize Continuous Single Scan diagnostic uploads in .scan-inbox.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const inboxRoot = join(rootDir, '.scan-inbox/sessions');
const prefix = process.argv[2] ?? 'continuous-session-';

const sessions = existsSync(inboxRoot)
  ? readdirSync(inboxRoot)
      .filter(n => n.startsWith(prefix))
      .sort()
  : [];

if (!sessions.length) {
  console.log(`No sessions matching ${prefix}* under ${inboxRoot}`);
  console.log('Continuous diagnostics appear after Auto-upload is enabled on device.');
  process.exit(0);
}

const byParent = new Map();
for (const id of sessions) {
  const dir = join(inboxRoot, id);
  let meta = {};
  for (const rel of ['metadata/metadata.json', 'metadata.json']) {
    const p = join(dir, rel);
    if (existsSync(p)) {
      try {
        meta = JSON.parse(readFileSync(p, 'utf8'));
      } catch {
        meta = { parseError: true };
      }
      break;
    }
  }
  const parent = meta.parentSessionId ?? id.split('--')[0];
  if (!byParent.has(parent)) byParent.set(parent, []);
  byParent.get(parent).push({ id, meta, dir });
}

const latestParent = [...byParent.keys()].sort().at(-1);
const tracks = byParent.get(latestParent) ?? [];

console.log(`\n=== Continuous report: ${latestParent} ===`);
console.log(`tracks/uploads: ${tracks.length}\n`);

const row = (label, value) => console.log(`  ${label.padEnd(24)} ${value}`);

for (const t of tracks) {
  const m = t.meta;
  console.log(`--- ${m.trackId ?? m.childId ?? t.id} ---`);
  row('identity', m.publishedIdentity ?? m.finalCard ?? '—');
  row('source', m.publishSource ?? '—');
  row('confidence', m.confidence ?? '—');
  row('CLIP ms', m.timing?.encoderMs ?? m.timing?.clipMs ?? '—');
  row('search ms', m.timing?.searchMs ?? '—');
  row('OCR ms', m.timing?.ocrMs ?? '—');
  row('identity ms', m.timing?.identityMs ?? m.timing?.totalMs ?? '—');
  row('crop', m.artCropVariant ?? 'PRIMARY');
  row('top1', m.visualTop1 ?? '—');
  row('margin', m.visualMargin ?? '—');
  console.log('');
}

const published = tracks.filter(t => t.meta.publishedIdentity || t.meta.finalCard).length;
row('published', `${published}/${tracks.length}`);
console.log('');
