// The extension's side of the sync ports.
//
// This is the only place that knows the app's data is spread across
// chrome.storage.local and the page's localStorage. Nothing moves house to make
// syncing easier: preferences stay exactly where they've always been, and
// connecting a Google account copies their current values up rather than
// migrating them out from under the running app.
//
// Reads come straight from storage; writes go through the stores, so adopting a
// phone's decklist repaints the UI instead of waiting for a reload.

import {
  OVERRIDES_STORAGE_KEY,
  cardImageOverrideStore,
  type CardImageOverride,
} from '@/content/cardImageOverrideStore';
import { collectionStore , setAddPurchasesToCollection, shouldAddPurchasesToCollection } from '@/content/collectionStore';
import { deckStore } from '@/content/deckStore';
import { shippingStore } from '@/content/shippingStore';
import {
  emptyMeta,
  type ApplicationData,
  type DomainKey,
  type SyncMeta,
  type SyncedPreferences,
} from '@/core/sync/model';
import type { LocalRepository } from '@/core/sync/repository';
import type { StoredCollection } from '@/lib/collection';
import type { Deck } from '@/lib/deck';

const COLLECTION_KEY = 'lugin:collection';
const DECKS_KEY = 'lugin:decks';
const SHIPPING_KEY = 'lugin:shipping';
const THEME_KEY = 'lugin:theme';

/** Our own bookkeeping. Never synced: it describes this device, not the user. */
const SYNC_KEY = 'lugin:sync';

/** Fired when a pull changes preferences, for the UI to pick up. */
export const PREFS_APPLIED_EVENT = 'lugin:prefs-applied';

/** Which storage key backs which domain, for stamping local edits. */
const DOMAIN_OF_KEY: Record<string, DomainKey> = {
  [COLLECTION_KEY]: 'collection',
  [DECKS_KEY]: 'decks',
  [OVERRIDES_STORAGE_KEY]: 'printings',
  [SHIPPING_KEY]: 'preferences',
};

interface SyncRecord {
  /**
   * The preferences as of the last read. Preferences live in localStorage,
   * which raises no change events, so a change is noticed by comparing values —
   * cheap for four fields, and it means no preference call site has to know
   * that syncing exists.
   */
  lastPrefs?: SyncedPreferences;
  meta: SyncMeta;
  /** When each domain last changed on this device. */
  stamps: Partial<Record<DomainKey, string>>;
}

const newDeviceId = (): string =>
  typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const readRecord = async (): Promise<SyncRecord> => {
  const stored = await chrome.storage.local.get(SYNC_KEY);
  const raw = stored[SYNC_KEY] as Partial<SyncRecord> | undefined;
  if (raw?.meta?.deviceId) return { lastPrefs: raw.lastPrefs, meta: raw.meta, stamps: raw.stamps ?? {} };
  // First run on this device: mint an id and keep it for good.
  const record: SyncRecord = { meta: emptyMeta(newDeviceId()), stamps: {} };
  await chrome.storage.local.set({ [SYNC_KEY]: record });
  return record;
};

const writeRecord = async (
  patch: Omit<Partial<SyncRecord>, 'meta'> & { meta?: Partial<SyncMeta> },
): Promise<SyncRecord> => {
  const current = await readRecord();
  const next: SyncRecord = {
    ...current,
    ...patch,
    meta: { ...current.meta, ...(patch.meta ?? {}) },
    stamps: { ...current.stamps, ...(patch.stamps ?? {}) },
  };
  await chrome.storage.local.set({ [SYNC_KEY]: next });
  return next;
};

// Writes we made ourselves must not read back as the user editing something.
// chrome.storage raises exactly one change event per `set`, so counting the
// writes we're about to make is enough to tell ours from theirs.
const expected = new Map<string, number>();
const expectSelfWrite = (key: string) => expected.set(key, (expected.get(key) ?? 0) + 1);
const consumeSelfWrite = (key: string): boolean => {
  const n = expected.get(key) ?? 0;
  if (n <= 0) return false;
  expected.set(key, n - 1);
  return true;
};

/**
 * Notice local edits and stamp the domain they belong to.
 *
 * Watching storage rather than the stores themselves means not one existing
 * mutation path has to be edited, and anything added later is covered the day
 * it starts writing to these keys.
 */
export const watchLocalChanges = (now: () => string = () => new Date().toISOString()): void => {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const touched = new Set<DomainKey>();
    for (const key of Object.keys(changes)) {
      const domain = DOMAIN_OF_KEY[key];
      if (!domain) continue;
      if (consumeSelfWrite(key)) continue;
      touched.add(domain);
    }
    if (touched.size === 0) return;
    const at = now();
    const stamps: SyncRecord['stamps'] = {};
    for (const domain of touched) stamps[domain] = at;
    void writeRecord({ meta: { dirtyAt: at }, stamps });
  });
};

const currentPrefs = async (): Promise<SyncedPreferences> => {
  const stored = await chrome.storage.local.get(SHIPPING_KEY);
  const shipping = stored[SHIPPING_KEY] as { toCountry?: number | null } | undefined;
  let theme: SyncedPreferences['theme'] = 'dark';
  try {
    if (localStorage.getItem(THEME_KEY) === 'site') theme = 'site';
  } catch {
    // a page that denies storage just gets the default
  }
  return {
    addPurchasesToCollection: shouldAddPurchasesToCollection(),
    homeCountry: shipping?.toCountry ?? null,
    theme,
  };
};

const samePrefs = (a: SyncedPreferences | undefined, b: SyncedPreferences): boolean =>
  a !== undefined &&
  a.addPurchasesToCollection === b.addPurchasesToCollection &&
  a.homeCountry === b.homeCountry &&
  a.theme === b.theme;

export const createChromeLocalRepository = (
  now: () => string = () => new Date().toISOString(),
): LocalRepository => ({
  async read(): Promise<ApplicationData> {
    const [stored, record, prefs] = await Promise.all([
      chrome.storage.local.get([COLLECTION_KEY, DECKS_KEY, OVERRIDES_STORAGE_KEY]),
      readRecord(),
      currentPrefs(),
    ]);

    // Preferences changed while nothing was watching: stamp them now, once.
    let stamps = record.stamps;
    if (!samePrefs(record.lastPrefs, prefs)) {
      const at = record.lastPrefs === undefined ? (stamps.preferences ?? now()) : now();
      stamps = { ...stamps, preferences: at };
      await writeRecord({ lastPrefs: prefs, stamps: { preferences: at } });
    }

    // A domain with no stamp has never been written here. The epoch makes it
    // lose to anything the other device has, which is what "nothing of mine to
    // protect" should mean.
    const never = new Date(0).toISOString();
    const at = (domain: DomainKey) => stamps[domain] ?? never;

    return {
      collection: {
        updatedAt: at('collection'),
        value: (stored[COLLECTION_KEY] as StoredCollection | undefined) ?? null,
      },
      decks: { updatedAt: at('decks'), value: (stored[DECKS_KEY] as Deck[] | undefined) ?? [] },
      preferences: { updatedAt: at('preferences'), value: prefs },
      printings: {
        updatedAt: at('printings'),
        value: (stored[OVERRIDES_STORAGE_KEY] as Record<string, CardImageOverride> | undefined) ?? {},
      },
    };
  },

  async readMeta(): Promise<SyncMeta> {
    return (await readRecord()).meta;
  },

  async write(data: ApplicationData, changed: readonly DomainKey[]): Promise<void> {
    for (const domain of changed) {
      switch (domain) {
        case 'collection':
          expectSelfWrite(COLLECTION_KEY);
          await collectionStore.replaceAll(data.collection.value);
          break;
        case 'decks':
          expectSelfWrite(DECKS_KEY);
          await deckStore.replaceAll(data.decks.value);
          break;
        case 'printings':
          expectSelfWrite(OVERRIDES_STORAGE_KEY);
          await cardImageOverrideStore.replaceAll(data.printings.value);
          break;
        case 'preferences':
          await applyPrefs(data.preferences.value);
          break;
      }
    }
    // Adopted data is not this device's edit: its stamp is the one it arrived
    // with, so the next sync doesn't mistake it for something to push back.
    const stamps: SyncRecord['stamps'] = {};
    for (const domain of changed) stamps[domain] = data[domain].updatedAt;
    const lastPrefs = changed.includes('preferences') ? data.preferences.value : undefined;
    await writeRecord(lastPrefs ? { lastPrefs, stamps } : { stamps });
  },

  async writeMeta(patch: Partial<SyncMeta>): Promise<void> {
    await writeRecord({ meta: patch });
  },
});

/** Put preferences back where the app reads them from. */
const applyPrefs = async (prefs: SyncedPreferences): Promise<void> => {
  setAddPurchasesToCollection(prefs.addPurchasesToCollection);
  try {
    localStorage.setItem(THEME_KEY, prefs.theme);
  } catch {
    // ignore storage failures
  }
  // Shipping is the one preference in chrome.storage, so it's the one that can
  // be mistaken for a local edit. `setToCountry` does nothing when the value
  // already matches, and claiming a write that never happens would swallow the
  // user's next real one — so only claim it when something will actually change.
  const stored = await chrome.storage.local.get(SHIPPING_KEY);
  const shipping = stored[SHIPPING_KEY] as { toCountry?: number | null } | undefined;
  if (prefs.homeCountry !== null && (shipping?.toCountry ?? null) !== prefs.homeCountry) {
    expectSelfWrite(SHIPPING_KEY);
    await shippingStore.setToCountry(prefs.homeCountry);
  }
  // The theme is read into React state at mount, so say so out loud.
  try {
    window.dispatchEvent(new CustomEvent(PREFS_APPLIED_EVENT, { detail: prefs }));
  } catch {
    // no window (worker context) — nothing is listening there anyway
  }
};
