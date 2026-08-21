// The phone's data layer: a local copy, and the same engine the desktop runs.
//
// This used to be a fetch with a refresh button, which was honest while the app
// could only read. It can't stay that way, because the phone is where imports
// will actually happen — someone scans a shoebox into ManaBox on the sofa, not at
// a desk — and an app that pushes without reconciling would overwrite a
// collection the desktop had meanwhile added purchases to.
//
// So it runs `createSyncEngine` over `createWebLocalRepository`, exactly as the
// extension runs it over chrome.storage. The reconciliation rules, the per-domain
// resolution and the conflict copies are one implementation, tested once. What
// differs is only where the local copy lives.
//
// Consequences worth knowing:
//
//   * The UI renders the *local* document, so it works with no signal, and an
//     import survives being closed before it could be pushed.
//   * A push is attempted after every local change and can fail silently into
//     `pending` — that's not an error state, it's a phone in a lift.
//   * The engine writes to Drive, so this app now needs the same read/write
//     scope the extension does.

import { AuthError } from '@/core/sync/auth';
import { createDriveRepository } from '@/core/sync/drive';
import { createSyncEngine } from '@/core/sync/engine';
import type { ApplicationData, DomainKey } from '@/core/sync/model';
import { UnsupportedSchemaError } from '@/core/sync/repository';
import type { CollectionCard, StoredCollection } from '@/lib/collection';
import { adjustCollectionQuantity, adjustPrintingQuantity } from '@/lib/collectionEdit';
import { deckFromImport, newDeck, parseDeckList, type Deck, type DeckFormat } from '@/lib/deck';
import { applyImport, findDuplicates } from '@/lib/duplicates';
import type { ImportDecision, ImportFormat } from '@/lib/import';
import { webGoogleAuth } from '@/platform/web/googleAuth';
import { createWebLocalRepository } from '@/platform/web/localRepository';

export type SyncStatus =
  /** No client id in this build; sync can't be attempted at all. */
  | 'not-configured'
  /** No usable token. Local data is still readable and editable. */
  | 'disconnected'
  /** A flow, a sync or an import is running. */
  | 'busy'
  /** Reconciled with Drive at least once this session. */
  | 'ready'
  | 'error';

export interface SyncState {
  /** Domains the last sync had to resolve; a copy of the loser is in Drive. */
  conflicted: DomainKey[];
  /** This device's document — what the UI renders, online or not. */
  data: ApplicationData | null;
  error: string | null;
  /** Local changes not yet pushed. Expected, not a failure. */
  pending: boolean;
  /** False when no store could be opened: this session only. */
  persistent: boolean;
  status: SyncStatus;
  /** When this device last reconciled. */
  syncedAt: string | null;
}

const configured = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

const local = createWebLocalRepository();
const engine = createSyncEngine({
  local,
  remote: createDriveRepository({ token: webGoogleAuth }),
});

let state: SyncState = {
  conflicted: [],
  data: null,
  error: null,
  pending: false,
  persistent: true,
  status: !configured ? 'not-configured' : webGoogleAuth.isConnected() ? 'busy' : 'disconnected',
  syncedAt: null,
};

const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach(l => l());
const set = (patch: Partial<SyncState>): void => {
  state = { ...state, ...patch };
  emit();
};

const describe = (error: unknown): string => {
  if (error instanceof UnsupportedSchemaError) {
    return 'Your desktop extension is newer than this app. Update this app to read that data.';
  }
  if (error instanceof AuthError) return error.message;
  return error instanceof Error ? error.message : 'Something went wrong';
};

/** Read what this device holds, so the app is usable before any network call. */
const loadLocal = async (): Promise<ApplicationData> => {
  const [data, meta] = await Promise.all([local.read(), local.readMeta()]);
  set({ data, pending: meta.dirtyAt !== null, persistent: local.persistent() });
  return data;
};

/**
 * Reconcile, and report a failure only when it's worth a screen.
 *
 * `quiet` is for syncs the user didn't ask for — the one at startup, and the one
 * chasing an import. Those failing means "not now", and the pending marker
 * already says so; an error banner over freshly imported cards would suggest the
 * import itself hadn't worked, which would be a lie.
 */
const reconcile = async (quiet: boolean): Promise<void> => {
  // Terminal, not a silent return: a caller that set 'busy' before calling this
  // would otherwise leave the UI spinning for the rest of the session.
  if (!configured) {
    set({ status: 'not-configured' });
    return;
  }
  if (!webGoogleAuth.isConnected()) {
    set({ status: 'disconnected' });
    return;
  }
  set({ error: null, status: 'busy' });
  try {
    const report = await engine.sync();
    const [data, meta] = await Promise.all([local.read(), local.readMeta()]);
    set({
      conflicted: report.conflicted,
      data,
      pending: meta.dirtyAt !== null,
      status: 'ready',
      syncedAt: meta.lastPulledAt,
    });
  } catch (err) {
    // An expired token isn't an error screen, it's the connect button coming
    // back: renewing one needs a tap on this platform.
    if (err instanceof AuthError && err.failure === 'no-session') {
      set({ status: 'disconnected' });
      return;
    }
    if (quiet) {
      set({ status: state.data ? 'ready' : 'disconnected' });
      return;
    }
    set({ error: describe(err), status: 'error' });
  }
};

// Local data first, then catch up with Drive if this is a reload rather than a
// first visit. Deliberately in that order: the list should appear without
// waiting for a round trip that may not succeed.
void loadLocal().then(() => {
  if (configured && webGoogleAuth.isConnected()) void reconcile(true);
});

let pushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Push once the edits stop, rather than after each one.
 *
 * Building a deck is a burst of small writes — a quantity stepper is somebody
 * tapping "+" four times — and a Drive round trip per tap would be slow, would
 * flap the header between "syncing" and "synced", and would achieve nothing,
 * since only the final state is ever uploaded. The local write already happened;
 * this is only about when the copy leaves the phone.
 */
const schedulePush = (): void => {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void reconcile(true);
  }, 1500);
};

/**
 * Rewrite the deck list locally and mark it for pushing.
 *
 * No 'busy' status: this is an IndexedDB write behind a tap, and a spinner for
 * it would flicker on every keystroke of a deck's name.
 */
const writeDecks = async (update: (decks: readonly Deck[]) => Deck[]): Promise<void> => {
  try {
    const before = await local.read();
    const data = await local.edit('decks', update(before.decks.value));
    set({ data, pending: true });
  } catch (err) {
    set({ error: describe(err), status: 'error' });
    return;
  }
  schedulePush();
};

const writeCollection = async (
  update: (cards: readonly CollectionCard[], prev: StoredCollection | null) => StoredCollection,
): Promise<void> => {
  try {
    const before = await local.read();
    const prev = before.collection.value ?? null;
    const stored = update(prev?.cards ?? [], prev);
    const data = await local.edit('collection', stored);
    set({ data, pending: true });
  } catch (err) {
    set({ error: describe(err), status: 'error' });
    return;
  }
  schedulePush();
};

export const syncStore = {
  /**
   * Drop scanned cards into the local collection, merging exact printings.
   *
   * Same path as an import without the review sheet: a scan that already matches
   * set + number + foil bumps quantity instead of adding a twin row.
   */
  async addCards(incoming: CollectionCard[], source = 'scan'): Promise<void> {
    if (incoming.length === 0) return;
    set({ error: null, status: 'busy' });
    try {
      const before = await local.read();
      const existing = before.collection.value?.cards ?? [];
      const { candidates } = findDuplicates(existing, incoming);
      const cards = applyImport(
        existing,
        incoming,
        candidates.map(c => c.index),
      );
      const stored: StoredCollection = {
        cards,
        format: before.collection.value?.format ?? 'list',
        importedAt: Date.now(),
        source,
      };
      const data = await local.edit('collection', stored);
      set({ data, pending: true });
    } catch (err) {
      set({ error: describe(err), status: 'error' });
      return;
    }
    await reconcile(true);
  },

  connect(): void {
    set({ error: null, status: 'busy' });
    // Kept in the tap's call stack: the popup is only allowed because a person
    // just touched something.
    webGoogleAuth.connect().then(
      () => void reconcile(false),
      (err: unknown) => {
        if (err instanceof AuthError && err.failure === 'cancelled') {
          set({ status: 'disconnected' });
          return;
        }
        set({ error: describe(err), status: 'error' });
      },
    );
  },

  /** Start an empty deck and return its id, so the caller can open it. */
  async createDeck(format: DeckFormat, name?: string): Promise<string> {
    const deck = newDeck({ format, name });
    await writeDecks(decks => [deck, ...decks]);
    return deck.id;
  },

  disconnect(): void {
    void webGoogleAuth.disconnect().finally(() => {
      set({ conflicted: [], error: null, status: 'disconnected', syncedAt: null });
    });
  },

  getSnapshot: (): SyncState => state,

  
  /**
   * Apply a reviewed import to this device, then try to push it.
   *
   * Written locally first and unconditionally: the file is on this phone, the
   * user has just approved what to do with it, and whether Drive is reachable in
   * the next second has nothing to do with either.
   */
async importDecisions(
    decisions: ImportDecision[],
    options: { format: ImportFormat; source: string },
  ): Promise<void> {
    set({ error: null, status: 'busy' });
    try {
      const before = await local.read();
      let data = before;

      const intoCollection = decisions.filter(d => d.kind === 'collection');
      if (intoCollection.length > 0) {
        let cards = before.collection.value?.cards ?? [];
        for (const decision of intoCollection) {
          cards = applyImport(cards, decision.cards, decision.duplicates);
        }
        const stored: StoredCollection = {
          cards,
          // Keep the established format once there is one: after a merge that
          // label describes the collection, not the last file to land in it.
          format:
            before.collection.value?.format ?? (options.format === 'plain-list' ? 'list' : 'manabox'),
          importedAt: Date.now(),
          source: options.source,
        };
        data = await local.edit('collection', stored);
      }

      const newDecks = decisions
        .filter(d => d.kind === 'deck')
        .map(d => deckFromImport(d.deck, { name: d.label, source: options.source }))
        .filter((d): d is NonNullable<typeof d> => d !== null);
      if (newDecks.length > 0) {
        data = await local.edit('decks', [...newDecks, ...data.decks.value]);
      }

      set({ data, pending: true });
    } catch (err) {
      set({ error: describe(err), status: 'error' });
      return;
    }
    await reconcile(true);
  },

  
  
/**
   * File a pasted or uploaded decklist as a new deck, returning its id — or null
   * when the text held no cards, which the caller says in place rather than as a
   * sync error, because nothing about syncing went wrong.
   */
async importDeckList(text: string, source: string): Promise<string | null> {
    const { cards, name } = parseDeckList(text);
    const deck = deckFromImport(cards, { name, source });
    if (!deck) return null;
    await writeDecks(decks => [deck, ...decks]);
    return deck.id;
  },

  
  
async removeDeck(id: string): Promise<void> {
    await writeDecks(decks => decks.filter(deck => deck.id !== id));
  },

  /** Set total copies for one card name (all printings rolled up). */
  async setCollectionQuantity(key: string, quantity: number, displayName?: string): Promise<void> {
    await writeCollection((cards, prev) => ({
      cards: adjustCollectionQuantity(cards, key, quantity, displayName),
      format: prev?.format ?? 'list',
      importedAt: prev?.importedAt ?? Date.now(),
      source: prev?.source ?? 'manual',
    }));
  },

  /** Set copies for one printing; other printings of the same card are unchanged. */
  async setPrintingQuantity(identity: string, quantity: number): Promise<void> {
    await writeCollection((cards, prev) => ({
      cards: adjustPrintingQuantity(cards, identity, quantity),
      format: prev?.format ?? 'list',
      importedAt: prev?.importedAt ?? Date.now(),
      source: prev?.source ?? 'manual',
    }));
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** The user asked, so a failure is worth showing. */
  syncNow(): void {
    void reconcile(false);
  },

  /** Change one deck. `updatedAt` is stamped here so no caller can forget it. */
  async updateDeck(id: string, update: (deck: Deck) => Deck): Promise<void> {
    await writeDecks(decks =>
      decks.map(deck => (deck.id === id ? { ...update(deck), updatedAt: Date.now() } : deck)),
    );
  },
};
