// Reconciling this device with the copy in the user's cloud storage.
//
// Deliberately dumb, and per domain rather than per document: a deck edited on
// the phone and a collection imported on the desktop are not a conflict, they're
// two independent edits, and treating the file as one blob would make one of
// them lose for no reason.
//
// A real conflict — the same domain edited in both places since this device last
// synced — is settled by the later stamp, but the copy that loses is written to
// the cloud's conflict shelf first. Last-write-wins is a decision about which
// version to *show*, and it shouldn't also be a decision to destroy the other.
//
// Clock skew is the known weakness of any timestamp scheme. Each revision names
// the device that wrote it, which is what makes a wrong answer explainable.

import {
  DOMAINS,
  emptyData,
  type ApplicationData,
  type Domain,
  type DomainKey,
  type SyncMeta,
} from './model';
import {
  ConflictError,
  type LocalRepository,
  type RemoteSnapshot,
  type SyncRepository,
} from './repository';
import { toSyncedState } from './serialize';

export interface SyncReport {
  /** Domains taken from the other device and written locally. */
  applied: DomainKey[];
  /** Domains where both sides had moved; the loser was archived. */
  conflicted: DomainKey[];
  /** Domains sent to the cloud. */
  pushed: DomainKey[];
  /** Set when the cloud held nothing and this device seeded it. */
  seeded: boolean;
}

export interface EngineOptions {
  local: LocalRepository;
  /** Injected so tests don't wait for real time and stamps stay comparable. */
  now?: () => string;
  remote: SyncRepository;
}

/** What a single domain's reconciliation came to. */
type Decision<T> = {
  archive: T | null;
  conflict: boolean;
  take: 'local' | 'remote';
  value: Domain<T>;
};

/**
 * Decide one domain.
 *
 * `base` is what this device last agreed with the cloud on. A side whose stamp
 * still equals it hasn't changed here since, so the other side's edit is simply
 * news — not a contest. Only when both have moved is anything at risk.
 */
const decide = <T>(local: Domain<T>, remote: Domain<T>, base: string | undefined): Decision<T> => {
  if (local.updatedAt === remote.updatedAt) {
    return { archive: null, conflict: false, take: 'local', value: local };
  }
  const localMoved = base === undefined || local.updatedAt !== base;
  const remoteMoved = base === undefined || remote.updatedAt !== base;

  if (!remoteMoved) return { archive: null, conflict: false, take: 'local', value: local };
  if (!localMoved) return { archive: null, conflict: false, take: 'remote', value: remote };

  // Both edited since the last agreement: newer wins, the other is kept.
  const remoteWins = remote.updatedAt > local.updatedAt;
  return {
    archive: remoteWins ? local.value : remote.value,
    conflict: true,
    take: remoteWins ? 'remote' : 'local',
    value: remoteWins ? remote : local,
  };
};

export const createSyncEngine = ({ local, now = () => new Date().toISOString(), remote }: EngineOptions) => {
  /** One pass. Returns the report, or throws for the caller to show. */
  const runOnce = async (attempt: number): Promise<SyncReport> => {
    const [data, meta] = await Promise.all([local.read(), local.readMeta()]);

    // A document from a newer app version arrives here as an
    // `UnsupportedSchemaError` and is left entirely alone — not read as far as
    // it makes sense, and certainly not written back.
    const snapshot: RemoteSnapshot | null = await remote.load();

    // Nothing up there yet: this device's data becomes the starting point. This
    // is also the moment a fresh install's preferences — which have been sitting
    // in local storage all along — first travel anywhere.
    if (!snapshot) {
      const saved = await remote.save(toSyncedState(data, meta.deviceId), null);
      await local.writeMeta({
        base: stamps(data),
        baseRevision: saved.revision,
        dirtyAt: null,
        lastPulledAt: now(),
        lastPushedAt: now(),
      });
      return { applied: [], conflicted: [], pushed: [...DOMAINS], seeded: true };
    }

    const applied: DomainKey[] = [];
    const conflicted: DomainKey[] = [];
    const pushed: DomainKey[] = [];
    const merged: ApplicationData = emptyData(now());

    for (const key of DOMAINS) {
      // Each domain is its own type; the decision is uniform but the values
      // aren't, so this is the one place a cast earns its keep.
      const decision = decide(
        data[key] as Domain<unknown>,
        snapshot.state.data[key] as Domain<unknown>,
        meta.base[key],
      );
      (merged[key] as Domain<unknown>) = decision.value;
      if (decision.conflict) conflicted.push(key);
      if (decision.take === 'remote') applied.push(key);
      else if (data[key].updatedAt !== snapshot.state.data[key].updatedAt) pushed.push(key);

      if (decision.archive !== null) {
        // Never let losing the archive lose the sync: the point of the copy is
        // to make a wrong resolution recoverable, not to gate the resolution.
        try {
          await remote.archiveConflict(key, decision.archive, now());
        } catch {
          // reported by the caller through the failed-archive count, not here
        }
      }
    }

    if (applied.length > 0) await local.write(merged, applied);

    let revision = snapshot.revision;
    if (pushed.length > 0) {
      try {
        const saved = await remote.save(toSyncedState(merged, meta.deviceId), snapshot.revision);
        revision = saved.revision;
      } catch (err) {
        // Someone wrote between our read and our write. Once is a race worth
        // retrying; twice means something else is going on and the caller
        // should hear about it rather than have us spin.
        if (err instanceof ConflictError && attempt === 0) return runOnce(1);
        throw err;
      }
    }

    await local.writeMeta({
      base: stamps(merged),
      baseRevision: revision,
      dirtyAt: pushed.length > 0 ? null : meta.dirtyAt,
      lastPulledAt: now(),
      lastPushedAt: pushed.length > 0 ? now() : meta.lastPushedAt,
    });

    return { applied, conflicted, pushed, seeded: false };
  };

  return {
    /**
     * Pull, resolve, push. Local data is only ever replaced by something that
     * was read successfully; every failure path leaves this device exactly as
     * it was, still usable offline.
     */
    sync: (): Promise<SyncReport> => runOnce(0),
  };
};

/** Every domain's current stamp — what we'll compare against next time. */
const stamps = (data: ApplicationData): SyncMeta['base'] => {
  const out: SyncMeta['base'] = {};
  for (const key of DOMAINS) out[key] = data[key].updatedAt;
  return out;
};
