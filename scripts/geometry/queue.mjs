#!/usr/bin/env node
/**
 * yarn geometry:queue
 *
 * Rank untrusted geometry fixtures for efficient manual review.
 * Does not change the detector.
 *
 *   yarn geometry:queue
 *   yarn geometry:queue --top=50
 *   yarn geometry:queue --limit=30
 */

import { listFixtures } from './lib/corpus.mjs';
import {
  PRIORITY_QUEUE_PATH,
  buildPriorityQueue,
  printQueue,
  savePriorityQueue,
} from './lib/queue.mjs';

const topArg = process.argv.find(a => a.startsWith('--top='));
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const top = topArg ? Number(topArg.slice('--top='.length)) : 50;
const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : 40;

const fixtures = await listFixtures();
if (!fixtures.length) {
  console.error('No fixtures. Run yarn geometry:bootstrap first.');
  process.exit(1);
}

const payload = await buildPriorityQueue(fixtures, { top: Number.isFinite(top) ? top : 50 });
await savePriorityQueue(payload);
printQueue(payload, { limit: Number.isFinite(limit) ? limit : 40 });
void PRIORITY_QUEUE_PATH;
