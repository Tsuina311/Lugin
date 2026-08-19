// The hover card preview used by every card list in the overlay.
//
// Hovering a thumbnail pops the full card up next to the cursor. Double-faced
// cards are clickable to flip: if we don't already know the card's faces, the
// first hover resolves them from Scryfall (cache first) and upgrades the popup
// that's already on screen — so the front art appears instantly and the back
// becomes available a moment later.
//
// Faces are cached module-wide, so hovering the same card in another panel (or
// again later) flips immediately.

import { useCallback, useSyncExternalStore, type MouseEvent } from 'react';

import { previewStore } from '@/content/previewStore';
import { cardKey } from '@/lib/cardName';
import { requestScryfall, requestScryfallCached } from '@/lib/messaging';

/** cardKey -> face images. An empty array means "resolved, single-faced". */
const facesByKey = new Map<string, string[]>();
const inFlight = new Set<string>();

const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version += 1;
  for (const l of listeners) l();
};
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getVersion = (): number => version;

/**
 * Resolve a card's faces once and hand them to the live preview. `previewKey`
 * identifies the hovered element so a slow lookup can't hijack a different card
 * the user has since moved to.
 */
/**
 * Take the faces from metadata a panel has already loaded, so hovering a card
 * doesn't ask the background about a card we've just been told everything about.
 * Metadata that names no extra faces settles the question just as well: the card
 * is single-faced, and nothing needs looking up.
 */
export const rememberFaces = (metas: readonly { faceImages?: string[]; name: string }[]): void => {
  for (const meta of metas) {
    const key = cardKey(meta.name);
    if (key && !facesByKey.has(key)) facesByKey.set(key, meta.faceImages ?? []);
  }
};

const resolveFaces = (name: string, previewKey: string): void => {
  const key = cardKey(name);
  if (!key || facesByKey.has(key) || inFlight.has(key)) return;
  inFlight.add(key);
  void (async () => {
    try {
      const [cached] = await requestScryfallCached([name]);
      const card = cached ?? (await requestScryfall([name]))[0];
      const faces = card?.faceImages ?? [];
      facesByKey.set(key, faces);
      if (faces.length >= 2) {
        // setFaces keeps the front already on screen (which may be a specific
        // printing) and only borrows the extra face(s).
        previewStore.setFaces(previewKey, faces);
        // Single-faced cards change nothing on screen, so only two-sided ones
        // are worth re-rendering the (potentially long) lists for.
        emit();
      }
    } catch {
      // Leave it unresolved so a later hover can retry.
    } finally {
      inFlight.delete(key);
    }
  })();
};

interface PreviewHandlers {
  onClick?: (e: MouseEvent) => void;
  onMouseEnter?: (e: MouseEvent) => void;
  onMouseLeave?: () => void;
  onMouseMove?: (e: MouseEvent) => void;
}

export interface CardPreview {
  /** True once we know the card has a second face, so a click will flip it. */
  flippable: boolean;
  /** Spread onto the hover target. Empty when there's no image to show. */
  handlers: PreviewHandlers;
}

/**
 * Returns a function that builds hover-preview props for one card.
 *
 * `key` identifies the hover target (prefix it per panel so the same card in
 * two lists stays distinct), `name` enables the face lookup, and `urls` is what
 * we can already show — pass every known face if you have them (e.g. from
 * `CardMetadata.faceImages`) and the card flips without any lookup.
 */
export const useCardPreview = (): ((key: string, name: string, urls: string[]) => CardPreview) => {
  // Re-render when a lookup resolves, so the flip affordance can appear.
  useSyncExternalStore(subscribe, getVersion, getVersion);

  return useCallback((key: string, name: string, urls: string[]): CardPreview => {
    if (urls.length === 0) return { flippable: false, handlers: {} };

    const known = facesByKey.get(cardKey(name)) ?? [];
    // Keep the caller's front art; only the extra faces come from the lookup.
    const faces = urls.length >= 2 ? urls : known.length >= 2 ? [urls[0], ...known.slice(1)] : urls;
    const flippable = faces.length >= 2;

    return {
      flippable,
      handlers: {
        onClick: (e: MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          const shown = previewStore.getSnapshot();
          if (shown?.key === key) {
            if (shown.pinned) {
              if (shown.urls.length >= 2) previewStore.flip();
              else previewStore.hide();
              return;
            }
            previewStore.pin();
            return;
          }
          previewStore.show(
            { index: 0, key, pinned: true, urls: faces },
            window.innerWidth / 2,
            window.innerHeight / 2,
          );
          if (!flippable) resolveFaces(name, key);
        },
        onMouseEnter: (e: MouseEvent) => {
          previewStore.show({ index: 0, key, urls: faces }, e.clientX, e.clientY);
          if (!flippable) resolveFaces(name, key);
        },
        onMouseLeave: () => {
          if (!previewStore.getSnapshot()?.pinned) previewStore.hide();
        },
        onMouseMove: (e: MouseEvent) => previewStore.move(e.clientX, e.clientY),
      },
    };
  }, []);
};
