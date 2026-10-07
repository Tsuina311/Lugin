#!/usr/bin/env node
/**
 * How many stills-v1 art boxes are human-reviewed.
 * yarn geometry:artbox-status
 */

import { listFixtures } from './lib/corpus.mjs';
import { fixtureArtReviewed, loadStillsV1Frames } from './lib/stills-queue.mjs';

const frames = await loadStillsV1Frames();
const fixtures = await listFixtures();
const byImage = new Map();
for (const fixture of fixtures) {
  if (!byImage.has(fixture.image)) byImage.set(fixture.image, fixture);
}

const counts = { 'auto-accepted': 0, 'auto-edited': 0, manual: 0, missing: 0, unreviewed: 0 };
const remaining = [];
for (const frame of frames) {
  const fixture = byImage.get(frame.image);
  const art = fixture?.cards?.map(card => card.regions?.artBox).find(Boolean) ?? null;
  if (!fixtureArtReviewed(fixture)) {
    if (!art?.quad) counts.missing += 1;
    else counts.unreviewed += 1;
    remaining.push(frame.cardName || frame.image);
    continue;
  }
  counts[art.source] = (counts[art.source] ?? 0) + 1;
}

const reviewed = counts['auto-accepted'] + counts['auto-edited'] + counts.manual;
const lines = [
  `stills-v1 frames: ${frames.length}`,
  `human-reviewed artBox: ${reviewed}`,
  `remaining: ${frames.length - reviewed}`,
  `auto accepted: ${counts['auto-accepted']}`,
  `auto edited: ${counts['auto-edited']}`,
  `manual: ${counts.manual}`,
  `unreviewed proposal: ${counts.unreviewed}`,
  `no art box: ${counts.missing}`,
];
if (remaining.length) {
  lines.push('remaining cards:');
  for (const name of remaining) lines.push(`- ${name}`);
}
if (reviewed === frames.length && frames.length > 0) {
  lines.push('46/46 reviewed. yarn scanner:art-crop-ceiling can measure the manual ceiling.');
} else {
  lines.push('MANUAL_GT_INCOMPLETE. An automatic proposal does not count.');
}
console.log(lines.join('\n'));
