import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';

import { previewStore } from '@/content/previewStore';

// The full card image that pops up beside the cursor while you hover a
// thumbnail.
//
// Three things keep it smooth. It subscribes to the preview store itself, so
// starting or ending a hover re-renders this image and nothing else — App used
// to subscribe, which re-rendered the whole active panel. Following the pointer
// never touches React at all: moves are coalesced into one animation frame and
// applied as a transform straight to the node, so a circling mouse costs a
// compositor update instead of a render of every visible row. And every card
// hovered stays mounted (hidden) rather than the one image having its `src`
// swapped: swapping drops the old image and asks for the new one, which shows as
// a fresh request every time you alternate between two cards. A mounted image is
// just shown again.

/** Distance from the cursor, and the gap kept from the viewport edges. */
const OFFSET = 16;
const MARGIN = 8;
/** How many cards stay mounted. Enough to cover moving along a row and back. */
const KEEP = 8;

export const PreviewLayer = () => {
  const shown = useSyncExternalStore(previewStore.subscribe, previewStore.getSnapshot);
  const active = shown ? (shown.urls[shown.index] ?? null) : null;

  // The cards we hold, newest first. Derived during render (not in an effect) so
  // a card appears in the same commit as the hover that asked for it.
  const [kept, setKept] = useState<string[]>([]);
  const mounted = active && !kept.includes(active) ? [active, ...kept].slice(0, KEEP) : kept;
  useEffect(() => {
    if (mounted !== kept) setKept(mounted);
  }, [kept, mounted]);

  const nodes = useRef(new Map<string, HTMLImageElement>());
  const activeRef = useRef<string | null>(null);
  activeRef.current = active;
  // The active card's size, measured once per card rather than every frame:
  // reading layout inside the move loop is what makes it stutter.
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

  // Pointer follow, one write per frame no matter how many events arrive.
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

  // A new card is a new size, and it must be in place before it's visible.
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
          className="pointer-events-none fixed left-0 top-0 z-[2147483647] w-[224px] rounded-md border border-line-strong shadow-pop will-change-transform"
          onError={() => previewStore.hide()}
          onLoad={() => {
            // Height only exists once the image has decoded; re-measure and settle.
            if (url !== activeRef.current) return;
            sizeRef.current = null;
            const at = previewStore.getPosition();
            place(at.x, at.y);
          }}
          src={url}
          style={{ display: url === active ? 'block' : 'none' }}
        />
      ))}
    </>
  );
};
