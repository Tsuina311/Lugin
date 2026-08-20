import { useEffect, useRef, useState } from 'react';

/**
 * Load a list of image URLs one at a time (never in parallel), returning the set
 * that has finished. New URLs appended to `urls` join the tail of the queue, so
 * the box/grid views fetch images for the cards on screen sequentially rather
 * than firing dozens of requests at once.
 *
 * Failures advance the queue *and* are remembered, so a parent re-render with
 * the same URLs does not retry them forever (which flooded DevTools when the
 * Cardmarket page kept mutating and re-feeding this hook).
 */
export const useSequentialImages = (urls: string[]): Set<string> => {
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set());
  const stateRef = useRef<{
    active: boolean;
    /** Succeeded or failed — either way, do not enqueue again. */
    done: Set<string>;
    loaded: Set<string>;
    queue: string[];
  }>({
    active: false,
    done: new Set(),
    loaded: new Set(),
    queue: [],
  });

  // Identity of the URL list, not the array reference — parents often allocate
  // a fresh array with the same contents on every render.
  const key = urls.join('\0');

  useEffect(() => {
    const s = stateRef.current;
    for (const u of urls) {
      if (u && !s.done.has(u) && !s.queue.includes(u)) s.queue.push(u);
    }
    const pump = () => {
      const next = s.queue.shift();
      if (next == null) {
        s.active = false;
        return;
      }
      s.active = true;
      const img = new Image();
      const finish = (ok: boolean) => {
        s.done.add(next);
        if (ok) {
          s.loaded.add(next);
          setLoaded(new Set(s.loaded));
        }
        pump();
      };
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      img.src = next;
    };
    if (!s.active) pump();
    // `urls` is read inside; `key` is the stable content fingerprint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return loaded;
};
