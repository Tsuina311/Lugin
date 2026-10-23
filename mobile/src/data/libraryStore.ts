// The native library: SQLite (or a file, on a binary that predates it), then Drive.
//
// Screens talk to this. They do not talk to SQLite or Google.

import { nativeGoogleAuth } from '../auth/nativeGoogleAuth';
import { loadNativePrices } from '../prices/priceCache';

import { openLibrary, type OpenLibrary } from './openLibrary';

import { AuthError } from '@/core/sync/auth';
import { createDriveRepository } from '@/core/sync/drive';
import { createSyncEngine } from '@/core/sync/engine';
import { emptyData, type ApplicationData, type DomainKey } from '@/core/sync/model';
import { UnsupportedSchemaError } from '@/core/sync/repository';
import type { CollectionCard, StoredCollection } from '@/lib/collection';
import { adjustCollectionQuantity, adjustPrintingQuantity } from '@/lib/collectionEdit';
import {
  decideScanIntake,
  mergeScanCard,
  nameOnlyCard,
  type IntakeStatus,
} from '@/lib/collectionIntake';
import {
  deckFromImport,
  newDeck,
  parseDeckList,
  type Deck,
  type DeckFormat,
  type DeckTagAnalysis,
} from '@/lib/deck';
import { applyImport } from '@/lib/duplicates';
import { collectionFile, deckFile } from '@/lib/export';
import { inspectImport } from '@/lib/import';
import { NO_PRICES, type PriceState } from '@/lib/prices';
import type { LibraryRepository } from '@/platform/sqlite/localRepository';

const EPOCH = new Date(0).toISOString();

export interface SessionMark {
  name: string;
  state: 'added' | 'review';
}

export type LibraryStatus = 'boot' | 'busy' | 'choose-sync' | 'disconnected' | 'error' | 'ready';

export interface LibrarySnapshot {
  configured: boolean;
  conflicted: DomainKey[];
  connected: boolean;
  data: ApplicationData | null;
  error: string | null;
  pending: boolean;
  persistent: boolean;
  prices: PriceState;
  session: SessionMark[];
  status: LibraryStatus;
  storage: 'file' | 'sqlite' | 'starting';
  syncedAt: string | null;
}

const listeners = new Set<() => void>();
let snapshot: LibrarySnapshot = {
  configured: nativeGoogleAuth.configured(),
  conflicted: [],
  connected: false,
  data: null,
  error: null,
  pending: false,
  persistent: true,
  prices: NO_PRICES,
  session: [],
  status: 'boot',
  storage: 'starting',
  syncedAt: null,
};

let opened: OpenLibrary | null = null;
let engine: ReturnType<typeof createSyncEngine> | null = null;
let committedSessionId: number | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let booting: Promise<void> | null = null;
let deckWriteQueue: Promise<void> = Promise.resolve();

const emit = (): void => listeners.forEach(listener => listener());
const set = (patch: Partial<LibrarySnapshot>): void => {
  snapshot = { ...snapshot, ...patch };
  emit();
};

const repo = (): LibraryRepository => {
  if (!opened) throw new Error('Library is not open yet');
  return opened.repo;
};

const describe = (error: unknown): string => {
  if (error instanceof UnsupportedSchemaError) {
    return 'Drive was written by a newer Lugin. Update this app before syncing.';
  }
  if (error instanceof AuthError) return error.message;
  return error instanceof Error ? error.message : 'Something went wrong';
};

const localHasLibrary = (data: ApplicationData): boolean =>
  (data.collection.value?.cards.length ?? 0) > 0 || data.decks.value.length > 0;

const refreshFromDisk = async (): Promise<void> => {
  const local = repo();
  const [data, meta] = await Promise.all([local.read(), local.readMeta()]);
  set({
    data,
    pending: meta.dirtyAt !== null,
    persistent: local.persistent(),
    syncedAt: meta.lastPulledAt,
  });
};

const reconcile = async (quiet: boolean, force = false): Promise<void> => {
  if (!engine) return;
  if (!nativeGoogleAuth.configured()) {
    set({ connected: false, status: snapshot.data ? 'ready' : 'disconnected' });
    return;
  }
  if (!nativeGoogleAuth.isConnected()) {
    set({ connected: false, status: 'disconnected' });
    return;
  }
  const local = repo();
  const meta = await local.readMeta();
  const data = await local.read();
  if (!force && meta.baseRevision == null && localHasLibrary(data)) {
    try {
      const remote = createDriveRepository({ token: nativeGoogleAuth });
      const existing = await remote.load();
      if (existing) {
        set({
          connected: true,
          error: 'This phone and Drive both have a library. Nothing was overwritten.',
          status: 'choose-sync',
        });
        return;
      }
    } catch (error) {
      if (quiet) {
        set({ connected: true, pending: true, status: 'ready' });
        return;
      }
      set({ connected: true, error: describe(error), status: 'error' });
      return;
    }
  }
  set({ error: null, status: 'busy' });
  try {
    const report = await engine.sync();
    await refreshFromDisk();
    set({
      conflicted: report.conflicted,
      connected: true,
      error:
        report.archiveFailures > 0
          ? `${report.archiveFailures} conflict recovery ${
              report.archiveFailures === 1 ? 'copy' : 'copies'
            } could not be saved to Drive.`
          : null,
      status: 'ready',
    });
  } catch (error) {
    if (
      error instanceof AuthError &&
      (error.failure === 'no-session' || error.failure === 'cancelled')
    ) {
      set({ connected: false, status: 'disconnected' });
      return;
    }
    if (quiet) {
      set({ connected: nativeGoogleAuth.isConnected(), pending: true, status: 'ready' });
      return;
    }
    set({ error: describe(error), status: 'error' });
  }
};

const schedulePush = (): void => {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void reconcile(true);
  }, 1500);
};

const editCollection = async (
  update: (cards: readonly CollectionCard[], prev: StoredCollection | null) => StoredCollection,
): Promise<void> => {
  const before = await repo().read();
  const prev = before.collection.value;
  const stored = update(prev?.cards ?? [], prev);
  const data = await repo().edit('collection', stored);
  set({ data, pending: true });
  schedulePush();
};

const editDecks = async (update: (decks: readonly Deck[]) => Deck[]): Promise<void> => {
  let before = snapshot.data;
  if (!before) before = await repo().read();
  const previous = before.decks;
  const value = update(previous.value);
  const optimistic: ApplicationData = {
    ...before,
    decks: { updatedAt: new Date().toISOString(), value },
  };

  // Publish before touching SQLite so taps, adds, and quantity changes paint
  // on the same frame. Writes remain ordered in the background.
  set({ data: optimistic, error: null, pending: true });

  const write = deckWriteQueue
    .catch(() => undefined)
    .then(async () => {
      const data = await repo().edit('decks', value);
      // A newer optimistic deck edit may already be visible. Never replace it
      // with this older write's readback.
      if (snapshot.data?.decks.value === value) set({ data, pending: true });
      schedulePush();
    });
  deckWriteQueue = write.catch(() => undefined);

  try {
    await write;
  } catch (error) {
    // Roll back only when no later optimistic edit superseded this one.
    if (snapshot.data?.decks.value === value) {
      set({
        data: { ...optimistic, decks: previous },
        error: describe(error),
      });
    }
    throw error;
  }
};

const mark = (name: string, state: SessionMark['state']): void => {
  set({ session: [{ name, state }, ...snapshot.session].slice(0, 24) });
};

export const libraryStore = {
  addCollectionCard: async (card: CollectionCard): Promise<void> => {
    await editCollection((cards, prev) => ({
      cards: applyImport([...cards], [{ ...card, quantity: Math.max(1, card.quantity) }], []),
      format: prev?.format ?? 'list',
      importedAt: prev?.importedAt ?? Date.now(),
      source: prev?.source ?? 'manual',
    }));
    mark(card.name, 'added');
  },

  addCollectionText: async (text: string): Promise<number> => {
    const parsed = parseDeckList(text);
    if (parsed.cards.length === 0) return 0;
    const incoming: CollectionCard[] = parsed.cards.map(card => ({
      foil: false,
      name: card.name,
      quantity: card.quantity,
      source: 'import',
    }));
    await editCollection((cards, prev) => ({
      cards: applyImport([...cards], incoming, []),
      format: prev?.format ?? 'list',
      importedAt: prev?.importedAt ?? Date.now(),
      source: prev?.source ?? 'manual',
    }));
    for (const card of incoming) mark(card.name, 'added');
    return incoming.length;
  },

  addManualCard: async (name: string): Promise<boolean> => {
    const card = nameOnlyCard(name);
    if (!card.name) return false;
    await editCollection((cards, prev) => ({
      cards: mergeScanCard(cards, card),
      format: prev?.format ?? 'list',
      importedAt: prev?.importedAt ?? Date.now(),
      source: prev?.source ?? 'manual',
    }));
    mark(card.name, 'added');
    return true;
  },

  addScan: async (input: {
    card: CollectionCard | null;
    liveSessionId: number | null;
    ownerSessionId: number | null;
    status: IntakeStatus;
  }): Promise<string> => {
    const decision = decideScanIntake({ ...input, committedSessionId });
    if (!decision.ok) {
      if (decision.reason === 'withheld') mark(input.card?.name || 'Unknown', 'review');
      if (decision.reason === 'stale')
        return 'That result is no longer the card in front of the camera';
      if (decision.reason === 'duplicate-tap') return 'Already added';
      if (decision.reason === 'withheld') return 'Not added — confirm the card first';
      return 'No card to add';
    }
    await editCollection((cards, prev) => ({
      cards: mergeScanCard(cards, decision.card),
      format: prev?.format ?? 'list',
      importedAt: prev?.importedAt ?? Date.now(),
      source: prev?.source ?? 'scan',
    }));
    committedSessionId = decision.sessionId;
    mark(decision.card.name, 'added');
    return `Added ${decision.card.name}`;
  },

  boot: (): Promise<void> => {
    booting ??= (async () => {
      opened = await openLibrary();
      engine = createSyncEngine({
        local: opened.repo,
        remote: createDriveRepository({ token: nativeGoogleAuth }),
      });
      await refreshFromDisk();
      let connected = false;
      try {
        await nativeGoogleAuth.getToken();
        connected = true;
      } catch {
        connected = false;
      }
      set({
        configured: nativeGoogleAuth.configured(),
        connected,
        status: connected ? 'ready' : 'disconnected',
        storage: opened.storage,
      });
      void loadNativePrices().then(prices => set({ prices }));
      if (connected) void reconcile(true);
    })();
    return booting;
  },

  completeAuthUrl: (url: string): Promise<void> => nativeGoogleAuth.completeUrl(url),

  connect: async (): Promise<void> => {
    set({ error: null, status: 'busy' });
    try {
      await nativeGoogleAuth.connect();
      set({ connected: true });
      await reconcile(false);
    } catch (error) {
      if (error instanceof AuthError && error.failure === 'cancelled') {
        set({ status: 'disconnected' });
        return;
      }
      set({ error: describe(error), status: 'error' });
    }
  },

  createDeck: async (
    format: DeckFormat,
    name?: string,
    commanderName?: string,
  ): Promise<string> => {
    const created = newDeck({ format, name: name || commanderName });
    const deck: Deck = commanderName
      ? {
          ...created,
          cards: [{ name: commanderName, quantity: 1, section: 'commander' }],
        }
      : created;
    await editDecks(decks => [deck, ...decks]);
    return deck.id;
  },

  deletePrinting: async (identity: string): Promise<void> => {
    await libraryStore.setPrintingQuantity(identity, 0);
  },

  disconnect: async (): Promise<void> => {
    await nativeGoogleAuth.disconnect();
    set({ conflicted: [], connected: false, error: null, status: 'disconnected', syncedAt: null });
  },

  getSnapshot: (): LibrarySnapshot => snapshot,

  importDeckList: async (text: string): Promise<string | null> => {
    const parsed = parseDeckList(text);
    const deck = deckFromImport(parsed.cards, { name: parsed.name, source: 'paste' });
    if (!deck) return null;
    await editDecks(decks => [deck, ...decks]);
    return deck.id;
  },

  importPasted: async (text: string): Promise<string> => {
    const inspection = inspectImport(text);
    if (inspection.parts.length === 0) return 'Nothing to import';
    let collectionCards = (await repo().read()).collection.value?.cards ?? [];
    let decks = (await repo().read()).decks.value;
    let collectionTouched = false;
    const created: Deck[] = [];
    for (const part of inspection.parts) {
      if (part.kind === 'collection') {
        collectionCards = applyImport(collectionCards, part.cards, []);
        collectionTouched = true;
      } else {
        const deck = deckFromImport(part.deck, { name: part.label, source: 'paste' });
        if (deck) created.push(deck);
      }
    }
    if (collectionTouched) {
      await editCollection(() => ({
        cards: collectionCards,
        format: inspection.format === 'plain-list' ? 'list' : 'manabox',
        importedAt: Date.now(),
        source: 'paste',
      }));
    }
    if (created.length > 0) {
      await editDecks(existing => [...created, ...existing]);
      decks = created;
    }
    return collectionTouched
      ? `Imported ${collectionCards.length} collection rows`
      : `Imported ${decks.length} deck${decks.length === 1 ? '' : 's'}`;
  },

  removeDeck: async (id: string): Promise<void> => {
    await editDecks(decks => decks.filter(deck => deck.id !== id));
  },

  replacePhoneWithDrive: async (): Promise<void> => {
    const local = repo();
    const blank = emptyData(EPOCH);
    await local.write(blank, ['collection', 'decks', 'preferences', 'printings']);
    await local.writeMeta({ base: {}, baseRevision: null, dirtyAt: null });
    await refreshFromDisk();
    await reconcile(false);
  },

  setPrintingQuantity: async (identity: string, quantity: number): Promise<void> => {
    await editCollection((cards, prev) => ({
      cards: adjustPrintingQuantity(cards, identity, quantity),
      format: prev?.format ?? 'list',
      importedAt: prev?.importedAt ?? Date.now(),
      source: prev?.source ?? 'manual',
    }));
  },

  setQuantity: async (key: string, quantity: number, displayName?: string): Promise<void> => {
    await editCollection((cards, prev) => ({
      cards: adjustCollectionQuantity(cards, key, quantity, displayName),
      format: prev?.format ?? 'list',
      importedAt: prev?.importedAt ?? Date.now(),
      source: prev?.source ?? 'manual',
    }));
  },

  shareCollection: async (): Promise<void> => {
    const cards = snapshot.data?.collection.value?.cards ?? [];
    await shareText(collectionFile({ cards }));
  },

  shareDeck: async (deck: Deck): Promise<void> => {
    await shareText(deckFile(deck));
  },

  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  syncNow: (): void => {
    void reconcile(false);
  },

  updateDeck: async (id: string, update: (deck: Deck) => Deck): Promise<void> => {
    await editDecks(decks =>
      decks.map(deck => (deck.id === id ? { ...update(deck), updatedAt: Date.now() } : deck)),
    );
  },

  /**
   * Persist derived tag checks without making the deck look user-edited.
   * The cache still joins the normal SQLite/Drive document for the next launch.
   */
  updateDeckTagAnalysis: async (id: string, tagAnalysis: DeckTagAnalysis): Promise<void> => {
    await editDecks(decks =>
      decks.map(deck => (deck.id === id ? { ...deck, tagAnalysis } : deck)),
    );
  },

  uploadPhoneCopy: async (): Promise<void> => {
    await reconcile(false, true);
  },
};

const shareText = async (file: { name: string; text: string }): Promise<void> => {
  const FileSystem = await import('expo-file-system/legacy');
  const Sharing = await import('expo-sharing');
  const root = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
  if (!root) throw new Error('No place to write the export');
  const path = `${root}${file.name}`;
  await FileSystem.writeAsStringAsync(path, file.text);
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path);
};
