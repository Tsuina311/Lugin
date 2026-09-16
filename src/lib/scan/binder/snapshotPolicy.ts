/**
 * When to take a page-level high-res snapshot for Binder multi-crop.
 * Never at detector frequency.
 */

import { BINDER_PAGE_SNAPSHOT_MIN_MS, type BinderPageSession } from './types';

export const shouldTakeBinderPageSnapshot = (
  session: BinderPageSession,
  now: number,
  opts: { pendingTracks: number; force?: boolean } = { pendingTracks: 0 },
): boolean => {
  if (opts.force) return true;
  const pendingFromSession = session.tracks.filter(
    t => !t.acquired && t.phase !== 'lost',
  ).length;
  const pending = Math.max(opts.pendingTracks, pendingFromSession);
  if (pending <= 0 && session.tracks.length > 0 && session.tracks.every(t => t.acquired || t.phase === 'lost')) {
    return false;
  }
  const last = session.lastPageSnapshotAt;
  if (last == null) return pending > 0 || session.tracks.length === 0;
  if (now - last < BINDER_PAGE_SNAPSHOT_MIN_MS) return false;
  return pending > 0;
};
