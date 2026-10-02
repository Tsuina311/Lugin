// The hover card preview used by every card list in the overlay.
//
// Hovering a thumbnail pops the full card up next to the cursor. A click pins
// that image in the center; clicking the centered image flips a double-faced
// card, and clicking the dimmed page closes it. The thumbnail itself never
// flips. If we don't already know the card's faces, the first hover resolves
// them from Scryfall (cache first) and upgrades the popup that's already on
// screen — so the front art appears instantly and the back becomes available
// a moment later.
//
// Faces are cached module-wide, so hovering the same card in another panel (or
// again later) flips immediately.

import { useCallback, useSyncExternalStore, type MouseEvent } from 'react';

import { previewStore } from '@/content/previewStore';
import { cardKey, frontFaceName, stripVersion } from '@/lib/cardName';
import { fetchRemote } from '@/lib/fetchRemote';
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

const isExtension = (): boolean => typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);

/** Per-face scans. Split and adventure cards share one image, so they stay out. */
const faceImagesOf = (card: {
  card_faces?: Array<{ image_uris?: Record<string, string> }>;
}): string[] => {
  const urls = (card.card_faces ?? [])
    .map(face => face.image_uris?.normal ?? face.image_uris?.large ?? face.image_uris?.small)
    .filter((url): url is string => typeof url === 'string');
  return urls.length >= 2 ? urls : [];
};

/** The other side of a Scryfall CDN scan, if this URL is one side of a printing. */
const otherCdnFace = (url: string): string | undefined => {
  const match = url.match(
    /^(https:\/\/cards\.scryfall\.io\/[^/?#]+)\/(front|back)\/([0-9a-f]\/[0-9a-f]\/[0-9a-f-]{36}\.[a-z]+)(?:[?#].*)?$/i,
  );
  if (!match) return undefined;
  const side = match[2].toLowerCase() === 'front' ? 'back' : 'front';
  return `${match[1]}/${side}/${match[3]}`;
};

const idFromImageUrl = (url: string): string | undefined => {
  const cdn = url.match(
    /cards\.scryfall\.io\/[^/]+\/(?:front|back)\/[0-9a-f]\/[0-9a-f]\/([0-9a-f-]{36})/i,
  );
  if (cdn) return cdn[1];
  const api = url.match(/api\.scryfall\.com\/cards\/([0-9a-f-]{36})/i);
  return api?.[1];
};

const productFromImageUrl = (url: string): string | undefined =>
  url.match(/api\.scryfall\.com\/cards\/cardmarket\/(\d+)/i)?.[1] ??
  url.match(/product-images[^/]*\/\d+\/[A-Za-z0-9]+\/(\d+)\//i)?.[1];

const imageExists = (url: string): Promise<boolean> =>
  new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0);
    img.onerror = () => resolve(false);
    img.src = url;
  });

/** null when the request failed, so a later tap can try again. */
const fetchFaceImages = async (url: string): Promise<string[] | null> => {
  const res = await fetchRemote(url, 'application/json');
  if (!res.ok) return null;
  try {
    return faceImagesOf(JSON.parse(res.body) as { card_faces?: Array<{ image_uris?: Record<string, string> }> });
  } catch {
    return null;
  }
};

/**
 * Both faces, or an empty list when the card has one picture. null means we
 * never got an answer. The picture on screen is tried first (its Scryfall id,
 * or the CDN file for the other side), then the card's name.
 */
const lookupFaces = async (name: string, frontUrl?: string): Promise<string[] | null> => {
  if (frontUrl) {
    const other = otherCdnFace(frontUrl);
    if (other && (await imageExists(other))) return [frontUrl, other];
    const id = idFromImageUrl(frontUrl);
    if (id) {
      const faces = await fetchFaceImages(`https://api.scryfall.com/cards/${id}`);
      if (faces) return faces;
    }
    const product = productFromImageUrl(frontUrl);
    if (product) {
      const faces = await fetchFaceImages(`https://api.scryfall.com/cards/cardmarket/${product}`);
      if (faces) return faces;
    }
  }
  if (isExtension()) {
    const [cached] = await requestScryfallCached([name]);
    const card = cached ?? (await requestScryfall([name]))[0];
    return card?.faceImages ?? [];
  }
  const front = stripVersion(frontFaceName(name));
  if (!front) return [];
  const exact = await fetchFaceImages(
    `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(front)}`,
  );
  if (exact) return exact;
  return fetchFaceImages(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(front)}`);
};

const jobs = new Map<string, Promise<string[] | null>>();

const ensureFaces = (name: string, previewKey: string, frontUrl?: string): Promise<string[] | null> => {
  const key = cardKey(name);
  if (!key) return Promise.resolve([]);
  const known = facesByKey.get(key);
  if (known) {
    if (known.length >= 2) previewStore.setFaces(previewKey, known);
    return Promise.resolve(known);
  }
  const running = jobs.get(key);
  if (running) return running;
  const job = lookupFaces(name, frontUrl)
    .then(faces => {
      if (!faces) return null;
      facesByKey.set(key, faces);
      if (faces.length >= 2) {
        // setFaces keeps the front already on screen and only borrows the rest.
        previewStore.setFaces(previewKey, faces);
        emit();
      }
      return faces;
    })
    .catch(() => null)
    .finally(() => {
      jobs.delete(key);
    });
  jobs.set(key, job);
  return job;
};

const resolveFaces = (name: string, previewKey: string, frontUrl?: string): void => {
  if (!cardKey(name) || facesByKey.has(cardKey(name)) || inFlight.has(cardKey(name))) return;
  const key = cardKey(name);
  inFlight.add(key);
  void ensureFaces(name, previewKey, frontUrl).finally(() => {
    inFlight.delete(key);
  });
};

let flipping = false;

/** Tap on the enlarged card: show the other side, looking it up first if needed. */
export const flipZoomedCard = async (): Promise<void> => {
  if (flipping) return;
  const shown = previewStore.getSnapshot();
  if (!shown?.pinned) return;
  flipping = true;
  try {
    if (shown.urls.length < 2 && shown.name) {
      await ensureFaces(shown.name, shown.key, shown.urls[0]);
    }
    const now = previewStore.getSnapshot();
    if (!now?.pinned || now.key !== shown.key || now.urls.length < 2) return;
    previewStore.flip();
  } finally {
    flipping = false;
  }
};

interface PreviewHandlers {
  onClick?: (e: MouseEvent) => void;
  onMouseEnter?: (e: MouseEvent) => void;
  onMouseLeave?: () => void;
  onMouseMove?: (e: MouseEvent) => void;
}

export interface CardPreview {
  /** True once we know the card has a second face. The centered preview flips. */
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
              previewStore.hide();
              return;
            }
            previewStore.pin();
            return;
          }
          previewStore.show(
            { anchor: e.currentTarget, index: 0, key, name, pinned: true, urls: faces },
            window.innerWidth / 2,
            window.innerHeight / 2,
          );
          if (!flippable) resolveFaces(name, key, urls[0]);
        },
        onMouseEnter: (e: MouseEvent) => {
          previewStore.show(
            { anchor: e.currentTarget, index: 0, key, name, urls: faces },
            e.clientX,
            e.clientY,
          );
          if (!flippable) resolveFaces(name, key, urls[0]);
        },
        onMouseLeave: () => {
          if (!previewStore.getSnapshot()?.pinned) previewStore.hide();
        },
        onMouseMove: (e: MouseEvent) => previewStore.move(e.clientX, e.clientY),
      },
    };
  }, []);
};
