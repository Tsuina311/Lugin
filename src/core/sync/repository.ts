// What the sync engine is allowed to assume about storage, on either side.
//
// Two ports, deliberately narrow. `SyncRepository` is the user's cloud — Google
// Drive's appDataFolder in the real one, a Map in tests. `LocalRepository` is
// whatever the device keeps its own copy in: chrome.storage today, a phone's
// store later. Neither is allowed to be a database the UI reads from; the app
// runs off local state and syncs when it can.

import type {
  ApplicationData,
  DomainKey,
  Revision,
  SyncMeta,
  SyncedApplicationState,
} from './model';

/** A document as fetched, with the revision it was fetched at. */
export interface RemoteSnapshot {
  revision: Revision;
  state: SyncedApplicationState;
}

/**
 * Raised when the remote moved on since the revision a write was based on —
 * the other device got there first. The caller re-reads and resolves rather
 * than overwriting work it never saw.
 */
export class ConflictError extends Error {
  constructor(readonly remote: RemoteSnapshot | null) {
    super('The stored data changed since this device last read it');
    this.name = 'ConflictError';
  }
}

/** Raised when the cloud holds a document written by a newer app version. */
export class UnsupportedSchemaError extends Error {
  constructor(readonly found: number) {
    super(`This data was written by a newer version (schema ${found})`);
    this.name = 'UnsupportedSchemaError';
  }
}

export interface SyncRepository {
  /**
   * Keep a copy of something about to be overwritten, so a resolution that
   * picks wrong is still recoverable. Never throws the caller off course: a
   * failed archive must not stop the sync it was protecting.
   */
  archiveConflict(domain: DomainKey, value: unknown, at: string): Promise<void>;

  /** The stored document, or null when the user has never synced. */
  load(): Promise<RemoteSnapshot | null>;

  /**
   * Write the document. `base` is the revision this write was derived from —
   * null meaning "there was nothing there". Throws `ConflictError` when the
   * remote is at some other revision.
   */
  save(state: SyncedApplicationState, base: Revision | null): Promise<RemoteSnapshot>;
}

export interface LocalRepository {
  /** This device's own copy, with a stamp per domain. */
  read(): Promise<ApplicationData>;

  readMeta(): Promise<SyncMeta>;

  /**
   * Adopt data that came from another device. Only `changed` is written, so a
   * deck edit doesn't rewrite a 20,000-row collection, and writes made here
   * must not read back as fresh local edits.
   */
  write(data: ApplicationData, changed: readonly DomainKey[]): Promise<void>;

  writeMeta(patch: Partial<SyncMeta>): Promise<void>;
}
