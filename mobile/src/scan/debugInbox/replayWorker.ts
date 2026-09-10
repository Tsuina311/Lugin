// Debug-only: poll the inbox for fixture replay jobs. No arbitrary paths/code.

import { recognizeCapturedCard } from '@/lib/scan/recognizeCaptured';

import { getOrCreateOcrRecognizer } from '../ocrAdapter';
import { loadLabFixture } from '../scannerLab/store';
import { getInboxSettings, isInboxConfigured, loadInboxSettings } from './settings';
import { isSafeId } from './protocol';

const POLL_MS = 3000;

let timer: ReturnType<typeof setInterval> | null = null;
let inflight = false;

export type ReplayWorkerDeps = {
  nameIndex: import('@/lib/scan/matchName').CardNameIndex | null;
};

const authHeaders = (): Record<string, string> => {
  const { token } = getInboxSettings();
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
};

const postResult = async (jobId: string, body: Record<string, unknown>): Promise<void> => {
  const { url } = getInboxSettings();
  await fetch(`${url}/api/replay/jobs/${jobId}/result`, {
    body: JSON.stringify(body),
    headers: authHeaders(),
    method: 'POST',
  });
};

const runJob = async (job: { fixtureId: string; id: string; kind: string }, deps: ReplayWorkerDeps) => {
  if (job.kind !== 'recognize-fixture' || !isSafeId(job.fixtureId) || !isSafeId(job.id)) {
    await postResult(job.id, { error: 'rejected job schema', ok: false });
    return;
  }
  const fixture = await loadLabFixture(job.fixtureId);
  if (!fixture) {
    await postResult(job.id, { error: `unknown fixture ${job.fixtureId}`, ok: false });
    return;
  }
  const quad = fixture.meta.quads.recognition ?? fixture.meta.quads.tracked ?? fixture.meta.quads.raw;
  if (!quad) {
    await postResult(job.id, { error: 'fixture has no quad', ok: false });
    return;
  }
  const captured = await recognizeCapturedCard({
    alreadyWarped: false,
    attemptId: 1,
    captureAt: null,
    nameIndex: deps.nameIndex,
    ocr: getOrCreateOcrRecognizer(),
    recognitionQuad: quad,
    source: fixture.source,
    trackId: 1,
  });
  await postResult(job.id, {
    ok: true,
    result: {
      decision: captured.titleDecode.decision,
      fixtureId: job.fixtureId,
      matchName: captured.matchName,
      matchScore: captured.matchScore,
      ocrText: captured.ocrText,
      status: captured.status,
      titleDecode: captured.titleDecode,
    },
  });
};

const tick = async (getDeps: () => ReplayWorkerDeps) => {
  if (inflight) return;
  await loadInboxSettings();
  const settings = getInboxSettings();
  if (!settings.replayWorker || !isInboxConfigured()) return;
  inflight = true;
  try {
    const res = await fetch(`${settings.url}/api/replay/next`, { headers: authHeaders() });
    const json = (await res.json()) as { job?: { fixtureId: string; id: string; kind: string } | null };
    if (json.job) await runJob(json.job, getDeps());
  } catch {
    // Stay quiet — worker is best-effort debug.
  } finally {
    inflight = false;
  }
};

export const startDeviceReplayWorker = (getDeps: () => ReplayWorkerDeps): (() => void) => {
  if (timer) clearInterval(timer);
  void tick(getDeps);
  timer = setInterval(() => void tick(getDeps), POLL_MS);
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
};
