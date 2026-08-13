// Turning the document into JSON and, more importantly, back again.
//
// Everything read here came off the network and was written by some other
// version of this app on some other device, so none of it is trusted. Reading
// answers with a result rather than throwing, and a document we can't read
// leaves local data untouched — the one rule the whole design hangs on.

import {
  DOMAINS,
  SYNC_SCHEMA_VERSION,
  emptyData,
  type ApplicationData,
  type Domain,
  type DomainKey,
  type SyncedApplicationState,
  type SyncedPreferences,
} from './model';

import type { CollectionCard, StoredCollection } from '@/lib/collection';


export type ReadResult =
  | { ok: true; state: SyncedApplicationState }
  | { detail: string; ok: false; reason: 'malformed' }
  | { found: number; ok: false; reason: 'unsupported-schema' };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** An ISO timestamp, or nothing. Anything unparseable counts as nothing. */
const readStamp = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

/**
 * One domain, or the fallback if it's missing or unreadable.
 *
 * A domain the writer didn't know about (an older app, a partial document)
 * isn't an error: it reads as the local fallback stamped at the epoch, so the
 * other side's copy always wins and nothing is invented.
 */
const readDomain = <T>(
  raw: unknown,
  fallback: Domain<T>,
  value: (v: unknown) => T | undefined,
): Domain<T> => {
  if (!isObject(raw)) return fallback;
  const at = readStamp(raw.updatedAt);
  const parsed = value(raw.value);
  if (at == null || parsed === undefined) return fallback;
  return { updatedAt: at, value: parsed };
};

const readCollection = (v: unknown): StoredCollection | null | undefined => {
  if (v === null) return null;
  if (!isObject(v) || !Array.isArray(v.cards)) return undefined;
  const cards: CollectionCard[] = [];
  for (const c of v.cards) {
    if (!isObject(c) || typeof c.name !== 'string' || c.name === '') continue;
    const quantity = Number(c.quantity);
    cards.push({
      ...c,
      foil: c.foil === true,
      name: c.name,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    });
  }
  return {
    cards,
    format: v.format === 'manabox' ? 'manabox' : 'list',
    importedAt: typeof v.importedAt === 'number' ? v.importedAt : 0,
    source: typeof v.source === 'string' ? v.source : '',
  };
};

const readDecks = (v: unknown): ApplicationData['decks']['value'] | undefined => {
  if (!Array.isArray(v)) return undefined;
  return v.filter(
    (d): d is ApplicationData['decks']['value'][number] =>
      isObject(d) && typeof d.id === 'string' && Array.isArray(d.cards),
  );
};

const readPrintings = (v: unknown): ApplicationData['printings']['value'] | undefined => {
  if (!isObject(v)) return undefined;
  const out: ApplicationData['printings']['value'] = {};
  for (const [key, val] of Object.entries(v)) if (isObject(val)) out[key] = val;
  return out;
};

const readPreferences = (v: unknown): SyncedPreferences | undefined => {
  if (!isObject(v)) return undefined;
  return {
    addPurchasesToCollection: v.addPurchasesToCollection === true,
    homeCountry: typeof v.homeCountry === 'number' ? v.homeCountry : null,
    theme: v.theme === 'site' ? 'site' : 'dark',
  };
};

/** The most recent stamp across the domains — the document's own `updatedAt`. */
export const latestStamp = (data: ApplicationData): string =>
  DOMAINS.map(d => data[d].updatedAt).sort()[DOMAINS.length - 1];

export const toSyncedState = (data: ApplicationData, deviceId: string): SyncedApplicationState => ({
  data,
  deviceId,
  schemaVersion: SYNC_SCHEMA_VERSION,
  updatedAt: latestStamp(data),
});

export const serialize = (state: SyncedApplicationState): string => JSON.stringify(state);

/**
 * Read a document written elsewhere.
 *
 * A version from the future is refused outright rather than read as far as it
 * makes sense: half-understanding a newer document and writing the result back
 * is how the newer device loses data it was told was saved.
 */
export const readSyncedState = (raw: unknown): ReadResult => {
  const source: unknown =
    typeof raw === 'string'
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return undefined;
          }
        })()
      : raw;

  if (!isObject(source)) return { detail: 'not a JSON object', ok: false, reason: 'malformed' };

  const version = source.schemaVersion;
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    return { detail: 'no schema version', ok: false, reason: 'malformed' };
  }
  if (version > SYNC_SCHEMA_VERSION) return { found: version, ok: false, reason: 'unsupported-schema' };

  const blank = emptyData(new Date(0).toISOString());
  const data = isObject(source.data) ? source.data : {};
  const state: SyncedApplicationState = {
    data: {
      collection: readDomain(data.collection, blank.collection, readCollection),
      decks: readDomain(data.decks, blank.decks, readDecks),
      preferences: readDomain(data.preferences, blank.preferences, readPreferences),
      printings: readDomain(data.printings, blank.printings, readPrintings),
    },
    deviceId: typeof source.deviceId === 'string' ? source.deviceId : 'unknown',
    schemaVersion: version,
    updatedAt: readStamp(source.updatedAt) ?? new Date(0).toISOString(),
  };
  return { ok: true, state };
};

/** Domains where two documents disagree, so only what moved gets written. */
export const changedDomains = (a: ApplicationData, b: ApplicationData): DomainKey[] =>
  DOMAINS.filter(d => a[d].updatedAt !== b[d].updatedAt);
