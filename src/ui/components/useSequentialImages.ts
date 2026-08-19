import { useEffect, useRef, useState } from 'react';

/**
 * Load a list of image URLs one at a time (never in parallel), returning the set
 * that has finished. New URLs appended to `urls` join the tail of the queue, so
 * the box/grid views fetch images for the cards on screen sequentially rather
 * than firing dozens of requests at once. Failures still advance the queue.
 */
export const useSequentialImages = (urls: string[]): Set<string> => {
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set());
  const stateRef = useRef<{ active: boolean; loaded: Set<string>; queue: string[] }>({
    active: false,
    loaded: new Set(),
    queue: [],
  });

  useEffect(() => {
    const s = stateRef.current;
    for (const u of urls) {
      if (u && !s.loaded.has(u) && !s.queue.includes(u)) s.queue.push(u);
    }
    const pump = () => {
      const next = s.queue.shift();
      if (next == null) {
        s.active = false;
        return;
      }
      s.active = true;
      const img = new Image();
      const done = () => {
        s.loaded.add(next);
        setLoaded(new Set(s.loaded));
        pump();
      };
      img.onload = done;
      img.onerror = () => pump();
      img.src = next;
    };
    if (!s.active) pump();
  }, [urls]);

  return loaded;
};
