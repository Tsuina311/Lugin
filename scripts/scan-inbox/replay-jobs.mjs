import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { isSafeId, sanitizeId } from './lib.mjs';

const KINDS = new Set(['recognize-fixture']);
const STAGES = new Set(['canonical']);

export const jobsDir = root => join(root, 'replay-jobs');

export const makeJobId = () => `job-${randomBytes(6).toString('hex')}`;

export const parseReplayJobBody = raw => {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'invalid job' };
  const fixtureId = sanitizeId(raw.fixtureId);
  if (!fixtureId) return { ok: false, reason: 'invalid fixtureId' };
  const kind = raw.kind ?? 'recognize-fixture';
  if (!KINDS.has(kind)) return { ok: false, reason: 'unknown job kind' };
  const stage = raw.stage ?? 'canonical';
  if (!STAGES.has(stage)) return { ok: false, reason: 'unknown stage' };
  return { fixtureId, kind, ok: true, stage };
};

export const writeJob = async (root, job) => {
  const dir = jobsDir(root);
  await mkdir(dir, { recursive: true });
  const id = isSafeId(job.id) ? job.id : makeJobId();
  const record = {
    createdAt: job.createdAt ?? new Date().toISOString(),
    error: job.error ?? null,
    fixtureId: job.fixtureId,
    id,
    kind: job.kind,
    result: job.result ?? null,
    stage: job.stage,
    status: job.status ?? 'queued',
    updatedAt: new Date().toISOString(),
  };
  await writeFile(join(dir, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`);
  return record;
};

export const readJob = async (root, id) => {
  if (!isSafeId(id)) return null;
  const path = join(jobsDir(root), `${id}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, 'utf8'));
};

export const nextQueuedJob = async root => {
  const dir = jobsDir(root);
  if (!existsSync(dir)) return null;
  const names = (await readdir(dir)).filter(n => n.endsWith('.json')).sort();
  for (const name of names) {
    const job = JSON.parse(await readFile(join(dir, name), 'utf8'));
    if (job.status === 'queued') return job;
  }
  return null;
};
