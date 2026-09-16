/**
 * In-memory registry of verified recognition attempts that survive UI NEXT.
 * High-res pixels are released after terminal + upload finalize.
 */

import type { RecognitionAttempt } from '@/lib/scan/verifiedScan';

const pending = new Map<number, RecognitionAttempt>();
const MAX_LIVE = 8;

export const putAttempt = (attempt: RecognitionAttempt): void => {
  pending.set(attempt.attemptId, attempt);
  while (pending.size > MAX_LIVE) {
    const oldest = [...pending.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!oldest) break;
    if (oldest.terminalStatus == null) break;
    releaseAttempt(oldest.attemptId);
  }
};

export const getAttempt = (attemptId: number): RecognitionAttempt | null =>
  pending.get(attemptId) ?? null;

export const getAttemptByCardSession = (cardSessionId: number): RecognitionAttempt | null => {
  for (const a of pending.values()) {
    if (a.cardSessionId === cardSessionId) return a;
  }
  return null;
};

export const updateAttempt = (
  attemptId: number,
  fn: (a: RecognitionAttempt) => RecognitionAttempt,
): RecognitionAttempt | null => {
  const cur = pending.get(attemptId);
  if (!cur) return null;
  const next = fn(cur);
  pending.set(attemptId, next);
  return next;
};

export const releaseAttempt = (attemptId: number): void => {
  pending.delete(attemptId);
};

export const listPendingAttempts = (): RecognitionAttempt[] => [...pending.values()];
