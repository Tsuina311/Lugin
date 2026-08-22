import { useEffect, useRef, useState } from 'react';

/** Give up on a hung thumb so the rest of the list can proceed. */
const LOAD_TIMEOUT_MS = 10_000;
/** Load several visible thumbs at once — one-at-a-time felt sluggish in long lists. */
const MAX_IN_FLIGHT = 8;

/**
 * Unlock list thumbnails in order (top first) but allow several in flight at
 * once. Prefer `<img src>` over `new Image()` preloads: Cardmarket CDN thumbs
 * often never fire onload in the extension's isolated world when preloaded.
 */
export const useSequentialImages = (
  urls: string[],
): {
  /** Call from the img's onLoad / onError once that URL was unlocked. */
  markDone: (url: string) => void;
  /** True once this URL may receive an `<img src>` (in flight or already done). */
  unlocked: (url: string) => boolean;
} => {
  const [inFlight, setInFlight] = useState<Set<string>>(() => new Set());
  const [finished, setFinished] = useState<Set<string>>(() => new Set());
  const doneRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef<Set<string>>(new Set());
  const urlsRef = useRef(urls);
  urlsRef.current = urls;

  const key = urls.join('\0');

  const fillQueue = () => {
    const pending = urlsRef.current.filter(
      u => u && !doneRef.current.has(u) && !inFlightRef.current.has(u),
    );
    const slots = MAX_IN_FLIGHT - inFlightRef.current.size;
    if (slots <= 0 || pending.length === 0) return;
    for (const url of pending.slice(0, slots)) {
      inFlightRef.current.add(url);
    }
    setInFlight(new Set(inFlightRef.current));
  };

  const finish = (url: string) => {
    if (!url || doneRef.current.has(url)) return;
    doneRef.current.add(url);
    inFlightRef.current.delete(url);
    setFinished(prev => new Set(prev).add(url));
    setInFlight(new Set(inFlightRef.current));
    fillQueue();
  };

  useEffect(() => {
    fillQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // A stuck CDN response must not freeze the whole queue.
  useEffect(() => {
    if (inFlight.size === 0) return;
    const timers = [...inFlight].map(url =>
      window.setTimeout(() => finish(url), LOAD_TIMEOUT_MS),
    );
    return () => timers.forEach(t => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inFlight]);

  const markDone = (url: string) => finish(url);

  const unlocked = (url: string) => !!url && (finished.has(url) || inFlight.has(url));

  return { markDone, unlocked };
};
