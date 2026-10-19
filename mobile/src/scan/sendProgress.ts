/** Live picture-send progress for the vNext coach. In memory only. */

export type SendJob = {
  id: string;
  done: number;
  total: number;
  startedAt: number;
  status: 'sending' | 'done' | 'failed';
  detail: string | null;
};

let jobs = new Map<string, SendJob>();
const listeners = new Set<() => void>();

const publish = (job: SendJob): void => {
  jobs.set(job.id, job);
  listeners.forEach(listener => listener());
};

export const subscribeSendJobs = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getSendJobs = (): SendJob[] => [...jobs.values()];

/** Track one upload. `onProgress` is handed to the uploader. */
export const trackSend = (
  id: string,
  total: number,
  run: (onProgress: (done: number, total: number, note: string | null) => void) => Promise<{
    done: number;
    total: number;
    ok: boolean;
    detail: string | null;
  }>,
): Promise<void> => {
  const startedAt = Date.now();
  publish({ id, done: 0, total, startedAt, status: 'sending', detail: null });
  return run((done, nextTotal, note) => {
    publish({
      id,
      done,
      total: Math.max(total, nextTotal),
      startedAt,
      status: 'sending',
      detail: note,
    });
  })
    .then(result => {
      publish({
        id,
        done: result.done,
        total: Math.max(total, result.total),
        startedAt,
        status: result.ok ? 'done' : 'failed',
        detail: result.detail,
      });
    })
    .catch(err => {
      publish({
        id,
        done: 0,
        total,
        startedAt,
        status: 'failed',
        detail: err instanceof Error ? err.message : String(err),
      });
    });
};

export const sendStatusLine = (list: SendJob[], now: number): string | null => {
  if (list.length === 0) return null;
  const active = list.filter(job => job.status === 'sending');
  if (active.length === 0) {
    const ordered = [...list].sort((a, b) => a.startedAt - b.startedAt);
    const latest = ordered[ordered.length - 1];
    if (latest?.status === 'failed') {
      return latest.detail
        ? `Could not send. ${latest.detail}`
        : 'Could not send. Open Settings and tap Retry uploads.';
    }
    const done = list.filter(job => job.status === 'done');
    if (done.length === 0) return null;
    return done.length === 1 ? 'Picture sent.' : `${done.length} pictures sent.`;
  }
  const done = active.reduce((sum, job) => sum + job.done, 0);
  const total = active.reduce((sum, job) => sum + job.total, 0);
  const started = Math.min(...active.map(job => job.startedAt));
  const elapsed = Math.max(1, now - started);
  const pct = total > 0 ? Math.round((100 * done) / total) : 0;
  let timing = '';
  if (done > 0 && done < total) {
    const leftSec = Math.max(1, Math.round(((elapsed / done) * (total - done)) / 1000));
    timing = ` · about ${leftSec}s left`;
  } else if (done === 0) {
    timing = ` · ${Math.max(1, Math.round(elapsed / 1000))}s so far`;
  }
  return `Sending ${done} of ${total} pictures · ${pct}%${timing}`;
};
