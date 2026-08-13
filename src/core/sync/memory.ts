// Both ports, backed by nothing but variables.
//
// These exist so the reconciliation rules can be tested without a browser or a
// Google account, and so a second device is just a second object — which is the
// only practical way to exercise "we both edited it".

import { emptyData, emptyMeta, type ApplicationData, type DomainKey, type SyncMeta } from './model';
import {
  ConflictError,
  type LocalRepository,
  type RemoteSnapshot,
  type SyncRepository,
} from './repository';
import { readSyncedState, serialize } from './serialize';

/** A stand-in for the user's cloud storage: one document, one revision counter. */
export class InMemorySyncRepository implements SyncRepository {
  /** Everything a resolution decided to overwrite, for tests to assert on. */
  readonly archived: { at: string; domain: DomainKey; value: unknown }[] = [];
  /** The document as JSON, so tests exercise the same parsing the real one does. */
  private document: string | null = null;
  private revision = 0;

  constructor(initial?: string) {
    if (initial !== undefined) {
      this.document = initial;
      this.revision = 1;
    }
  }

  archiveConflict(domain: DomainKey, value: unknown, at: string): Promise<void> {
    this.archived.push({ at, domain, value });
    return Promise.resolve();
  }

  load(): Promise<RemoteSnapshot | null> {
    if (this.document === null) return Promise.resolve(null);
    const read = readSyncedState(this.document);
    if (!read.ok) throw new Error(`unreadable document: ${read.reason}`);
    return Promise.resolve({ revision: String(this.revision), state: read.state });
  }

  save(state: Parameters<SyncRepository['save']>[0], base: string | null): Promise<RemoteSnapshot> {
    const current = this.document === null ? null : String(this.revision);
    if (current !== base) {
      throw new ConflictError(this.document === null ? null : { revision: current!, state });
    }
    this.document = serialize(state);
    this.revision += 1;
    return Promise.resolve({ revision: String(this.revision), state });
  }

  /** What another device would see. */
  peek(): string | null {
    return this.document;
  }
}

/** A device's own copy, and what it remembers about the last reconciliation. */
export class InMemoryLocalRepository implements LocalRepository {
  /** Which domains each `write` touched, so tests can prove nothing else was. */
  readonly writes: DomainKey[][] = [];
  private data: ApplicationData;
  private meta: SyncMeta;

  constructor(deviceId: string, data?: ApplicationData) {
    this.data = data ?? emptyData(new Date(0).toISOString());
    this.meta = emptyMeta(deviceId);
  }

  /** Edit a domain the way the app would, stamping it as this device's work. */
  edit<K extends DomainKey>(domain: K, value: ApplicationData[K]['value'], at: string): void {
    this.data = { ...this.data, [domain]: { updatedAt: at, value } };
  }

  read(): Promise<ApplicationData> {
    return Promise.resolve(this.data);
  }

  readMeta(): Promise<SyncMeta> {
    return Promise.resolve(this.meta);
  }

  snapshot(): ApplicationData {
    return this.data;
  }

  write(data: ApplicationData, changed: readonly DomainKey[]): Promise<void> {
    this.writes.push([...changed]);
    const next = { ...this.data };
    for (const key of changed) (next[key] as ApplicationData[DomainKey]) = data[key];
    this.data = next;
    return Promise.resolve();
  }

  writeMeta(patch: Partial<SyncMeta>): Promise<void> {
    this.meta = { ...this.meta, ...patch };
    return Promise.resolve();
  }
}
