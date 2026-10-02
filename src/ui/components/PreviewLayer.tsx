import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';

import { previewStore, type PreviewState } from '@/content/previewStore';

// The full card image that pops up beside the cursor while you hover a
// thumbnail, or enlarged in the center when you click.
//
// Three things keep the hover preview smooth. It subscribes to the preview store
// itself, so starting or ending a hover re-renders this image and nothing else.
// Following the pointer never touches React at all: moves are coalesced into one
// animation frame and applied as a transform straight to the node. And every
// card shown stays mounted (hidden) rather than swapping `src` on one image.
//
// The enlarged card keeps its images the same way. Opening a card again shows
// the image element that already holds it, loaded and decoded, instead of
// starting a new one. Either kind lets an image go once the thumbnail that
// opened it has left the document, since its card is no longer on screen.

/** Distance from the cursor, and the gap kept from the viewport edges. */
const OFFSET = 16;
const MARGIN = 8;
/** Most images each preview holds on to; past it the longest unseen go first. */
const KEEP_HOVER = 16;
const KEEP_PINNED = 32;

/**
 * Scryfall's JPG is a rectangle with the card's corners filled white, so the
 * preview clips that fill off. A Cardmarket photo is already the card, corners
 * included, and the same clip cuts into the frame.
 */
const cornerClip = (url: string): string =>
  url.includes('scryfall.io') || url.includes('api.scryfall.com') ? 'card-frame' : '';

const isCardmarketPhoto = (url: string): boolean => /cardmarket\.com/i.test(url);

/** Scryfall scan of the photo underneath. Stays invisible until fully decoded. */
const SharpCover = ({ src }: { src: string }) => {
  const ref = useRef<HTMLImageElement>(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el?.complete && el.naturalWidth > 0) setReady(true);
  }, [src]);

  return (
    <img
      ref={ref}
      alt=""
      className={ready ? 'card-zoom-sharp is-ready' : 'card-zoom-sharp'}
      decoding="sync"
      draggable={false}
      onLoad={() => setReady(true)}
      src={src}
    />
  );
};

interface KeptImage {
  /** Where it was opened from. Once none of these is in the document, it goes. */
  anchors: Element[];
  url: string;
}

/**
 * `kept` with the face on show moved to the front, or `kept` itself if it's
 * there already. Only that face: a back is fetched when it's flipped to, not
 * on every hover of a double-faced card.
 */
const remember = (kept: KeptImage[], shown: PreviewState | null, limit: number): KeptImage[] => {
  if (!shown) return kept;
  const url = shown.urls[shown.index];
  if (!url) return kept;
  const { anchor } = shown;
  const first = kept[0];
  if (first?.url === url && (!anchor || first.anchors.includes(anchor))) return kept;
  const anchors = kept.find(k => k.url === url)?.anchors ?? [];
  const image = {
    anchors: anchor && !anchors.includes(anchor) ? [...anchors, anchor] : anchors,
    url,
  };
  return [image, ...kept.filter(k => k.url !== url)].slice(0, limit);
};

/**
 * `kept` without the images whose cards have left the document, or `kept`
 * itself if none has. One opened from nowhere in particular has nothing to
 * watch, and only leaves by `remember`'s limit.
 */
const prune = (kept: KeptImage[], shown: PreviewState | null): KeptImage[] => {
  let changed = false;
  const next: KeptImage[] = [];
  for (const image of kept) {
    if (shown?.urls.includes(image.url)) {
      next.push(image);
      continue;
    }
    const anchors = image.anchors.filter(a => a.isConnected);
    if (anchors.length === image.anchors.length) {
      next.push(image);
      continue;
    }
    changed = true;
    if (anchors.length > 0) next.push({ ...image, anchors });
  }
  return changed ? next : kept;
};

/** The images a preview has shown and still holds, newest first. */
const useKeptImages = (shown: PreviewState | null, limit: number): string[] => {
  const [kept, setKept] = useState<KeptImage[]>([]);
  // Derived during render (not in an effect) so a new image is mounted in the
  // same commit as the preview that asked for it.
  const next = remember(kept, shown, limit);

  useEffect(() => {
    const settled = prune(next, shown);
    if (settled !== kept) setKept(settled);
  }, [kept, next, shown]);

  // A card can also leave with no preview event to notice it by: a list
  // re-rendering, a deck closing. Watch the documents its anchor lives in.
  useEffect(() => {
    const roots = new Set<Node>();
    for (const image of kept) for (const anchor of image.anchors) roots.add(anchor.getRootNode());
    if (roots.size === 0) return;
    let timer = 0;
    const observer = new MutationObserver(() => {
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = 0;
        setKept(current => prune(current, previewStore.getSnapshot()));
      }, 250);
    });
    for (const root of roots) observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [kept]);

  return next.map(image => image.url);
};

const PinnedPreview = ({ shown }: { shown: PreviewState | null }) => {
  const kept = useKeptImages(shown, KEEP_PINNED);
  // Closing hides the dialog but leaves the last card mounted, so opening it
  // again shows the picture that already decoded.
  const [held, setHeld] = useState<PreviewState | null>(null);
  if (shown && shown !== held) setHeld(shown);
  const view = shown ?? held;
  const open = shown != null;
  const active = view ? view.urls[view.index] : undefined;
  const market = !!active && isCardmarketPhoto(active);
  // The scan belongs to the front photo. A flipped face is its own picture.
  const sharp = market && view?.index === 0 ? view.sharp : undefined;
  const flippable = (view?.urls.length ?? 0) >= 2;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') previewStore.hide();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!view || !active) return null;
  if (!market && kept.length === 0) return null;

  const onCardClick = (event: { stopPropagation: () => void }): void => {
    event.stopPropagation();
    if (flippable) previewStore.flip();
  };

  // Closed, it stays in the document out of sight, so its images keep what
  // they've loaded.
  return (
    <div
      aria-label={open ? 'Card preview' : undefined}
      className={
        open
          ? 'pointer-events-auto fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/70 p-4'
          : 'hidden'
      }
      onClick={() => previewStore.hide()}
      role={open ? 'dialog' : undefined}
    >
      {market ? (
        <div
          className={`card-zoom card-zoom-market shadow-pop ${flippable ? 'cursor-flip' : ''}`}
          onClick={onCardClick}
          title={flippable ? 'Click to see the other side' : undefined}
        >
          <img alt="" className="card-zoom-base" decoding="sync" draggable={false} src={active} />
          {sharp ? <SharpCover key={sharp} src={sharp} /> : null}
        </div>
      ) : (
        kept.map(url => (
          <img
            key={url}
            alt=""
            className={`${cornerClip(url)} shadow-pop ${flippable ? 'cursor-flip' : ''}`}
            // Decoded before the frame that shows it, so reopening a card never
            // flashes an empty box first.
            decoding="sync"
            onClick={onCardClick}
            src={url}
            style={{
              display: url === active ? 'block' : 'none',
              // A width, not only a cap. Scryfall's normal file is 488×680 and
              // would fill a 400px cap on its own; Cardmarket's product photo is
              // about 251×356 and would otherwise stay that small.
              maxHeight: '85vh',
              width: 'min(400px, 90vw)',
            }}
            title={flippable ? 'Click to see the other side' : undefined}
          />
        ))
      )}
    </div>
  );
};

const HoverPreview = ({ shown }: { shown: PreviewState | null }) => {
  const mounted = useKeptImages(shown, KEEP_HOVER);
  const active = shown?.urls[shown.index] ?? null;

  const nodes = useRef(new Map<string, HTMLImageElement>());
  const activeRef = useRef<string | null>(null);
  activeRef.current = active;
  const sizeRef = useRef<{ height: number; width: number } | null>(null);

  const place = (x: number, y: number) => {
    const el = activeRef.current ? nodes.current.get(activeRef.current) : null;
    if (!el) return;
    if (!sizeRef.current) {
      sizeRef.current = { height: el.offsetHeight, width: el.offsetWidth };
    }
    const { height, width } = sizeRef.current;
    const left = Math.max(MARGIN, Math.min(x + OFFSET, window.innerWidth - width - MARGIN));
    const top = Math.max(MARGIN, Math.min(y + OFFSET, window.innerHeight - height - MARGIN));
    el.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  };

  useEffect(() => {
    let frame = 0;
    let pending = previewStore.getPosition();
    const unsubscribe = previewStore.subscribePosition(at => {
      pending = at;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        place(pending.x, pending.y);
      });
    });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (!active) return;
    sizeRef.current = null;
    const at = previewStore.getPosition();
    place(at.x, at.y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (mounted.length === 0) return null;

  return (
    <>
      {mounted.map(url => (
        <img
          key={url}
          ref={el => {
            if (el) nodes.current.set(url, el);
            else nodes.current.delete(url);
          }}
          alt=""
          aria-hidden
          className={`${cornerClip(url)} pointer-events-none fixed left-0 top-0 z-[2147483647] shadow-pop will-change-transform`}
          onError={() => {
            if (url === activeRef.current) previewStore.hide();
          }}
          onLoad={() => {
            if (url !== activeRef.current) return;
            sizeRef.current = null;
            const at = previewStore.getPosition();
            place(at.x, at.y);
          }}
          src={url}
          style={{
            display: url === active ? 'block' : 'none',
            maxWidth: 224,
            width: 224,
          }}
        />
      ))}
    </>
  );
};

// Both stay mounted whichever is showing, so neither drops what it holds when
// the other takes over.
export const PreviewLayer = () => {
  const shown = useSyncExternalStore(previewStore.subscribe, previewStore.getSnapshot);
  const pinned = shown?.pinned && shown.urls.length > 0 ? shown : null;

  return (
    <>
      <PinnedPreview shown={pinned} />
      <HoverPreview shown={pinned ? null : shown} />
    </>
  );
};
