#!/usr/bin/env node
/**
 * Add geometry-test source photos to the corpus for Geometry Lab.
 * The locked card warp is not imported. No detector quad is stored as truth.
 *
 *   node scripts/geometry/import-geometry-test.mjs geometry-test-20261006-150559
 */

import { existsSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { listFixtures, saveFixture, writeManifest } from './lib/corpus.mjs';
import { INBOX_SESSIONS } from './lib/paths.mjs';
import { PRIORITY_QUEUE_PATH } from './lib/queue.mjs';
import { createCard, createFixture } from './lib/schema.mjs';

const sessions = process.argv.slice(2).filter(arg => !arg.startsWith('-'));
if (!sessions.length) {
  console.error('Pass one or more geometry-test session ids.');
  process.exit(1);
}

const pngSize = abs => {
  const buf = readFileSync(abs);
  if (buf.slice(0, 8).toString('binary') !== '\x89PNG\r\n\x1a\n') {
    throw new Error(`not a png: ${abs}`);
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
};

const fixtureIdFor = rel => rel.replace(/^\./, '').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_');

const existing = await listFixtures();
const byImage = new Map(existing.map(fixture => [fixture.image, fixture]));
const queued = [];
let written = 0;
let skipped = 0;

for (const sessionId of sessions) {
  const sessionDir = join(INBOX_SESSIONS, sessionId);
  const summaryPath = join(sessionDir, 'summary', 'summary.json');
  if (!existsSync(summaryPath)) {
    console.error(`missing summary ${sessionId}`);
    continue;
  }
  const bundle = JSON.parse(readFileSync(summaryPath, 'utf8'));
  const items = [...(bundle.items ?? [])].sort((a, b) => a.itemIndex - b.itemIndex);
  for (const item of items) {
    const stem = `geom-${String(item.itemIndex).padStart(3, '0')}`;
    const rel = `.scan-inbox/sessions/${sessionId}/${stem}-source/${stem}-source.png`;
    const abs = join(sessionDir, `${stem}-source`, `${stem}-source.png`);
    if (!existsSync(abs)) {
      skipped += 1;
      continue;
    }
    const prior = byImage.get(rel);
    if (prior?.trusted || prior?.cards?.some(card => card.groundTruthSource === 'manually-reviewed')) {
      skipped += 1;
      continue;
    }
    const size = pngSize(abs);
    const metaRel = `.scan-inbox/sessions/${sessionId}/${stem}-metadata/${stem}-metadata.json`;
    const fixture = prior ?? createFixture({
      id: fixtureIdFor(rel),
      image: rel,
      imageWidth: size.width,
      imageHeight: size.height,
      source: 'unknown',
      seriesId: sessionId,
      captureGroup: sessionId,
      trusted: false,
      label: `${sessionId} ${stem}`,
      notes: '',
      bootstrapNotes: 'Geometry-test source photo. Draw the physical card corners. The locked card warp is not ground truth.',
      cards: [createCard({
        groundTruthQuad: null,
        groundTruthSource: 'none',
      })],
      provenance: {
        metadataPaths: existsSync(join(sessionDir, `${stem}-metadata`, `${stem}-metadata.json`)) ? [metaRel] : [],
      },
    });
    if (!prior) {
      fixture.imageWidth = size.width;
      fixture.imageHeight = size.height;
      await saveFixture(fixture);
      byImage.set(rel, fixture);
      written += 1;
    }
    queued.push(fixture);
  }
}

const all = await listFixtures();
await writeManifest(all);
await writeFile(PRIORITY_QUEUE_PATH, `${JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  note: 'Today\'s geometry-test source photos. Draw the physical card on each source. Regenerating yarn geometry:queue replaces this list.',
  queue: queued.map((fixture, index) => ({
    rank: index + 1,
    id: fixture.id,
    source: fixture.source,
    captureGroup: fixture.captureGroup,
    tags: fixture.tags ?? [],
    bootstrapProvenance: 'none',
    trackRecogDisagreementIoU: null,
    jsNativeIoU: null,
    bootstrapDetectorIoU: null,
    bootstrapDetectorScore: null,
    score: queued.length - index,
    reasons: ['geometry-test source', 'needs human card outline'],
    split: fixture.split ?? null,
    image: fixture.image,
    duplicateOfSeries: false,
    priorityScore: queued.length - index,
  })),
}, null, 2)}\n`);

console.log(`Wrote ${written} fixtures. Already reviewed or missing photo: ${skipped}. Queue ${queued.length}.`);
