/** The frozen stills-v1 phone frames used by the art-crop ceiling. */

import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { loadAnnotations } from '../../scanner-benchmark/lib/annotations.mjs';
import { confirmedIdentities } from '../../scanner-benchmark/lib/metrics.mjs';
import { isReviewedArtBox } from './frame-regions/annotations.mjs';
import { rootDir } from './paths.mjs';
import { cornersToGtQuad, createCard, createFixture, isCompleteQuad } from './schema.mjs';

const stillsPath = join(rootDir, 'scanner-benchmark/manifests/stills-v1.json');

export const loadStillsV1Frames = async () => {
  const stills = JSON.parse(await readFile(stillsPath, 'utf8'));
  const annotations = await loadAnnotations();
  const confirmed = new Map(confirmedIdentities(annotations.identities).map(row => [row.imageId, row]));
  return stills.items
    .filter(item => confirmed.has(item.imageId))
    .map(item => ({
      image: item.path || item.imageId,
      cardName: confirmed.get(item.imageId).cardName || item.cardName || '',
      autoTags: item.autoTags ?? [],
    }));
};

const sourceFor = image => {
  if (image.includes('/replay/')) return 'replay';
  if (image.includes('/real-photos/')) return 'real-photos';
  if (image.includes('focus-series')) return 'focus-series';
  if (image.includes('/cq-') || image.includes('capture-quality')) return 'capture-quality';
  if (image.includes('swap-test')) return 'swap-test';
  return 'unknown';
};

const fixtureIdFor = image => image.replace(/^\./, '').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_');

/**
 * Order geometry fixtures to the ceiling's 46 frames.
 * Images that are not fixtures yet become in-memory fixtures with the confirmed card quad.
 */
export const orderStillsQueue = async allFixtures => {
  const frames = await loadStillsV1Frames();
  const cornersPath = join(rootDir, 'scanner-benchmark/annotations/corners.json');
  const corners = existsSync(cornersPath) ? JSON.parse(readFileSync(cornersPath, 'utf8')) : [];
  const quadByImage = new Map();
  for (const row of corners) {
    if (row.status !== 'CONFIRMED' || !row.imageId) continue;
    const quad = cornersToGtQuad(row.corners);
    if (isCompleteQuad(quad)) quadByImage.set(row.imageId, quad);
  }
  const byImage = new Map();
  for (const fixture of allFixtures) {
    if (!byImage.has(fixture.image)) byImage.set(fixture.image, fixture);
  }
  const ids = [];
  const extras = [];
  const meta = new Map();
  for (const frame of frames) {
    const existing = byImage.get(frame.image);
    if (existing) {
      if (!existing.label && frame.cardName) existing.label = frame.cardName;
      ids.push(existing.id);
      meta.set(existing.id, frame);
      continue;
    }
    const abs = join(rootDir, frame.image);
    if (!existsSync(abs)) continue;
    let id = fixtureIdFor(frame.image);
    if (allFixtures.some(fixture => fixture.id === id) || extras.some(fixture => fixture.id === id)) {
      id = `${id}__stills`;
    }
    const quad = quadByImage.get(frame.image) ?? null;
    extras.push(createFixture({
      id,
      image: frame.image,
      source: sourceFor(frame.image),
      label: frame.cardName || null,
      tags: frame.autoTags.map(tag => String(tag).toLowerCase()).filter(tag => tag === 'foil' || tag === 'glare'),
      cards: [createCard({
        groundTruthQuad: quad,
        groundTruthSource: quad ? 'existing-annotation' : 'none',
        label: frame.cardName || null,
      })],
      notes: '',
      bootstrapNotes: 'stills-v1 art-box queue. Card quad is the confirmed corner annotation.',
    }));
    ids.push(id);
    meta.set(id, frame);
  }
  return { ids, extras, meta };
};

export const fixtureArtReviewed = fixture =>
  (fixture?.cards ?? []).some(card => isReviewedArtBox(card.regions?.artBox));
