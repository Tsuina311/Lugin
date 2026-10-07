#!/usr/bin/env node
/**
 * yarn geometry:frame-report
 *
 * Scores saved frame-region annotations against their original auto proposals.
 * Does not run the detector and does not touch the production scanner.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { listFixtures } from './lib/corpus.mjs';
import { collectFrameRecords, renderFrameReport, summarizeRecords } from './lib/frame-regions/report.mjs';
import { BENCHMARKS_ROOT } from './lib/paths.mjs';

const fixtures = await listFixtures();
const records = collectFrameRecords(fixtures);
const markdown = renderFrameReport(records, { fixtureCount: fixtures.length });
mkdirSync(BENCHMARKS_ROOT, { recursive: true });
const out = join(BENCHMARKS_ROOT, 'frame-regions-report.md');
const jsonOut = join(BENCHMARKS_ROOT, 'frame-regions-report.json');
writeFileSync(out, markdown);
writeFileSync(jsonOut, `${JSON.stringify({ fixtureCount: fixtures.length, summary: summarizeRecords(records) }, null, 2)}\n`);
process.stdout.write(markdown);
console.log(`wrote ${out}`);
