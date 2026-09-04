// Background upload queue for benchmark scans.
// Never blocks the scanner. Local save always happens first in sessionStore.

import { isBenchmarkToolsEnabled } from './isBenchmarkEnabled';

interface QueueItem {
  seq: number;
  sessionId: string;
}

const queue: QueueItem[] = [];
const queuedKeys = new Set<string>();
let running = false;

const keyOf = (sessionId: string, seq: number) => `${sessionId}:${seq}`;

export const enqueueBenchmarkUpload = (sessionId: string, seq: number): void => {
  if (!isBenchmarkToolsEnabled()) return;
  const k = keyOf(sessionId, seq);
  if (queuedKeys.has(k)) return;
  queuedKeys.add(k);
  queue.push({ seq, sessionId });
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const postScan = async (
  url: string,
  sessionId: string,
  seq: number,
  reportJson: string,
  pngBase64: string | null,
): Promise<void> => {
  const body = {
    kind: 'lugin-benchmark-scan',
    pngBase64,
    report: JSON.parse(reportJson) as unknown,
    seq,
    sessionId,
  };
  const res = await fetch(url, {
    body: JSON.stringify(body),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'LuginBenchmark/1.0',
      'X-Lugin-Benchmark': '1',
    },
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error(`upload HTTP ${res.status}`);
  }
};

export const kickUploadQueue = async (): Promise<void> => {
  if (!isBenchmarkToolsEnabled()) return;
  if (running) return;
  running = true;
  try {
    const store = await import('./sessionStore');
    while (queue.length) {
      const item = queue.shift()!;
      queuedKeys.delete(keyOf(item.sessionId, item.seq));

      const active = store.getActiveBenchmarkSession();
      const ingestionUrl =
        active?.sessionId === item.sessionId ? active.ingestionUrl : null;
      if (!ingestionUrl) {
        await store.updateScanUploadStatus(item.sessionId, item.seq, 'skipped');
        continue;
      }

      await store.updateScanUploadStatus(item.sessionId, item.seq, 'uploading');
      try {
        const files = await store.readSessionScanFiles(item.sessionId, item.seq);
        if (!files.reportJson) throw new Error('report missing');
        await postScan(
          ingestionUrl,
          item.sessionId,
          item.seq,
          files.reportJson,
          files.pngBase64,
        );
        await store.updateScanUploadStatus(item.sessionId, item.seq, 'ok');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await store.updateScanUploadStatus(item.sessionId, item.seq, 'failed', message);
        const session = store.getActiveBenchmarkSession();
        const scan = session?.scans.find(s => s.seq === item.seq);
        if (scan && scan.uploadAttempts < 5) {
          await sleep(Math.min(30_000, 1000 * 2 ** Math.min(scan.uploadAttempts, 4)));
          enqueueBenchmarkUpload(item.sessionId, item.seq);
        }
      }
    }
  } finally {
    running = false;
    if (queue.length) void kickUploadQueue();
  }
};

/** Re-queue all failed uploads for the active session. */
export const retryFailedBenchmarkUploads = async (): Promise<number> => {
  if (!isBenchmarkToolsEnabled()) return 0;
  const store = await import('./sessionStore');
  const session = store.getActiveBenchmarkSession();
  if (!session?.ingestionUrl) return 0;
  let n = 0;
  for (const scan of session.scans) {
    if (scan.uploadStatus === 'failed' || scan.uploadStatus === 'pending') {
      enqueueBenchmarkUpload(session.sessionId, scan.seq);
      n += 1;
    }
  }
  void kickUploadQueue();
  return n;
};

/** Test hook — expose queue length. */
export const peekUploadQueueLength = (): number => queue.length;
