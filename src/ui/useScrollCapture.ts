import { useEffect, useRef, useState, type RefObject } from 'react';

// Who the wheel belongs to while the overlay is open: the overlay from the
// moment it's opened or pressed, the page once the page is clicked. Kept for the
// tab's session, so a link followed from either side lands with scrolling still
// where the click was.
const FOCUS_KEY = 'lugin:scrollFocus';
type Focus = 'overlay' | 'page';

const LOCK_ATTR = 'data-lugin-scroll-lock';
const LOCK_STYLE_ID = 'lugin-scroll-lock';

/** Pixels per line, for wheels that report their deltas in lines. */
const LINE_HEIGHT = 40;

const readFocus = (): Focus => {
  try {
    return sessionStorage.getItem(FOCUS_KEY) === 'overlay' ? 'overlay' : 'page';
  } catch {
    return 'page';
  }
};

/**
 * The rule the lock switches on. It goes in the page's own document, not the
 * overlay's shadow root, because it styles the page. `overscroll-behavior` also
 * keeps a sideways swipe from turning into "back".
 */
const installLockStyle = () => {
  if (document.getElementById(LOCK_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = LOCK_STYLE_ID;
  style.textContent = [
    `html[${LOCK_ATTR}] { overflow: hidden !important; overscroll-behavior: none !important; }`,
    // Keeps the track of a scrollbar the page had, so the page doesn't reflow.
    `html[${LOCK_ATTR}='gutter'] { scrollbar-gutter: stable !important; }`,
  ].join('\n');
  (document.head ?? document.documentElement).append(style);
};

/** The nearest element at or above `node` with something to scroll vertically. */
const scrollerAt = (node: EventTarget | null): Element | null => {
  for (let el = node instanceof Element ? node : null; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
      return el;
    }
  }
  return null;
};

/**
 * While the user is working in the overlay, the page behind it doesn't scroll:
 * not when a list in the overlay runs out, not from the keyboard, and not when
 * the wheel turns over the page beside the panel, which scrolls the overlay's
 * list instead. Full screen holds it throughout: the page is out of sight.
 *
 * `panel` is the overlay's outermost element. Everything in its shadow root
 * counts as the overlay, the card zoom included.
 */
export const useScrollCapture = ({
  full,
  open,
  panel,
}: {
  full: boolean;
  open: boolean;
  panel: RefObject<HTMLElement | null>;
}) => {
  const [focus, setFocus] = useState<Focus>(readFocus);
  // The list the user last pressed or scrolled in: where a wheel over the page goes.
  const lastScroller = useRef<Element | null>(null);

  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) setFocus('overlay');
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    try {
      sessionStorage.setItem(FOCUS_KEY, focus);
    } catch {
      // ignore storage failures — it still holds on this page
    }
  }, [focus]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const root = panel.current?.getRootNode();
      const path = e.composedPath();
      const inside = !!root && path.includes(root);
      setFocus(inside ? 'overlay' : 'page');
      if (inside) lastScroller.current = scrollerAt(path[0]) ?? lastScroller.current;
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [panel]);

  const locked = open && (full || focus === 'overlay');

  useEffect(() => {
    const el = panel.current;
    if (!locked || !el) return;
    installLockStyle();
    const html = document.documentElement;
    html.setAttribute(LOCK_ATTR, window.innerWidth > html.clientWidth ? 'gutter' : '');

    const target = (): Element | null => {
      const last = lastScroller.current;
      if (
        last?.isConnected &&
        last.getClientRects().length > 0 &&
        last.scrollHeight > last.clientHeight
      ) {
        return last;
      }
      // Otherwise whichever list fills the middle of the panel.
      const box = el.getBoundingClientRect();
      const root = el.getRootNode();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      return scrollerAt(
        root instanceof ShadowRoot ? root.elementFromPoint(x, y) : document.elementFromPoint(x, y),
      );
    };

    const onOverlayWheel = (e: WheelEvent) => {
      lastScroller.current = scrollerAt(e.target) ?? lastScroller.current;
    };
    const onPageWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // pinch and ctrl+wheel zoom stay the browser's
      e.preventDefault();
      const scroller = target();
      if (!scroller) return;
      const unit =
        e.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? LINE_HEIGHT
          : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? scroller.clientHeight
            : 1;
      scroller.scrollBy({ behavior: 'instant', left: e.deltaX * unit, top: e.deltaY * unit });
    };

    // The overlay's host hangs off <html>, outside <body>: a listener on the body
    // hears only the page, and the overlay's own scrolling never waits on it.
    const { body } = document;
    el.addEventListener('wheel', onOverlayWheel, { passive: true });
    body.addEventListener('wheel', onPageWheel, { passive: false });
    return () => {
      html.removeAttribute(LOCK_ATTR);
      el.removeEventListener('wheel', onOverlayWheel);
      body.removeEventListener('wheel', onPageWheel);
    };
  }, [locked, panel]);
};
