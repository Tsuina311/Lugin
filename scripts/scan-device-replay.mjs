#!/usr/bin/env node
// Queue a debug-only ML Kit replay on the paired phone. Does not block host replay.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_PORT } from './scan-inbox/lib.mjs';
import { readReceiverSession } from './scan-inbox/session-file.mjs';
import { resolveFixtureId, listReplayFixtures, promoteSelected } from './scan-replay/corpus.mjs';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const inboxRoot = process.env.SCAN_INBOX_ROOT || join(rootDir, '.scan-inbox');

const query = process.argv.slice(2).find(a => !a.startsWith('--'));
if (!query) {
  console.error('Usage: yarn scan:device-replay <fixture-id>');
  console.error('Phone: Settings → Device replay worker ON, inbox paired, Scanner open.');
  process.exit(1);
}

let fixtures = await listReplayFixtures();
if (!fixtures.length) {
  await promoteSelected();
  fixtures = await listReplayFixtures();
}
const fixtureId = await resolveFixtureId(query);
if (!fixtureId) {
  console.error(`Unknown fixture "${query}"`);
  process.exit(1);
}

const session = await readReceiverSession(inboxRoot);
if (!session) {
  console.error('yarn scan:inbox is not running (no .scan-inbox/.receiver.json)');
  process.exit(1);
}
const base = session.localUrl ?? `http://127.0.0.1:${session.port || DEFAULT_PORT}`;
const headers = {
  Authorization: `Bearer ${session.token}`,
  'Content-Type': 'application/json',
};

const created = await fetch(`${base}/api/replay/jobs`, {
  body: JSON.stringify({ fixtureId, kind: 'recognize-fixture', stage: 'canonical' }),
  headers,
  method: 'POST',
});
const createdJson = await created.json();
if (!created.ok || !createdJson.job?.id) {
  console.error(`enqueue failed: ${created.status} ${JSON.stringify(createdJson)}`);
  process.exit(1);
}
const id = createdJson.job.id;
console.log(`queued ${id} fixture=${fixtureId}`);
console.log('Waiting for phone worker (DEVICE REQUIRED)…');

const deadline = Date.now() + 120_000;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 1500));
  const res = await fetch(`${base}/api/replay/jobs/${id}`, { headers });
  const json = await res.json();
  const job = json.job;
  if (!job) continue;
  if (job.status === 'done') {
    console.log(JSON.stringify(job.result, null, 2));
    process.exit(0);
  }
  if (job.status === 'error') {
    console.error(job.error ?? 'replay error');
    process.exit(1);
  }
}
console.error('timed out waiting for phone worker');
process.exit(1);
