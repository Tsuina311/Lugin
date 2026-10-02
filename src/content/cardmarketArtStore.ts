// Cardmarket product id → the Scryfall CDN image of that exact printing.
//
// A purchase remembers Cardmarket's own photo, which is too small to zoom.
// Scryfall has the same printing at full size; this remembers the CDN url so a
// deck doesn't ask again, and doesn't point <img> at the rate-limited API.

import { cdnImageFromId } from '@/lib/cardImage';
import { requestApi } from '@/lib/messaging';

const STORAGE_KEY = 'lugin:cardmarketArt';

/** product id → CDN url, or null when Scryfall has no such product. */
type ArtMap = Record<string, string | null>;

let arts: ArtMap = {};
/** What subscribers last saw. Stays put until `publish`, so a render in between doesn't observe a half-updated map. */
let snapshot: ArtMap = arts;
const listeners = new Set<() => void>();
const inflight = new Set<string>();

let emitTimer: ReturnType<typeof setTimeout> | undefined;

const publish = (): void => {
  snapshot = arts;
  for (const listener of listeners) listener();
};

/** One notice per burst, so a deck of lookups doesn't re-render on every card. */
const emit = (): void => {
  if (emitTimer != null) return;
  emitTimer = setTimeout(() => {
    emitTimer = undefined;
    publish();
    void persist();
  }, 200);
};

const persist = async (): Promise<void> => {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: arts });
  } catch {
    // in-memory state still works this session
  }
};

void chrome.storage.local.get(STORAGE_KEY).then(stored => {
  const raw = stored[STORAGE_KEY] as ArtMap | undefined;
  arts = raw && typeof raw === 'object' ? raw : {};
  publish();
});

const lookup = async (id: string): Promise<void> => {
  try {
    const result = await requestApi({ url: `https://api.scryfall.com/cards/cardmarket/${id}` });
    const card = result.ok ? (JSON.parse(result.body) as { id?: unknown }) : undefined;
    const image = cdnImageFromId(typeof card?.id === 'string' ? card.id : undefined) ?? null;
    arts = { ...arts, [id]: image };
    emit();
  } catch {
    // Leave it unresolved so a later visit can retry.
  } finally {
    inflight.delete(id);
  }
};

export const cardmarketArtStore = {
  /** Resolve any product ids we don't already know. Paced by the Scryfall queue. */
  ensure(ids: readonly string[]): void {
    for (const id of ids) {
      if (!/^\d+$/.test(id) || id in arts || inflight.has(id)) continue;
      inflight.add(id);
      void lookup(id);
    }
  },
  getSnapshot(): ArtMap {
    return snapshot;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
