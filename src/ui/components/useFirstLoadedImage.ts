import { useEffect, useState } from 'react';

/**
 * Try a list of image URLs in order and return the first one that loads. Used
 * when the best URL (CDN, Cardmarket thumbnail, …) may 404 or be blocked, but a
 * Scryfall API redirect further down the list still works.
 */
export const useFirstLoadedImage = (
  candidates: readonly string[],
): { ready: boolean; src?: string } => {
  const [state, setState] = useState<{ ready: boolean; src?: string }>({ ready: false });
  const key = candidates.join('\0');

  useEffect(() => {
    if (candidates.length === 0) {
      setState({ ready: false });
      return;
    }
    let cancelled = false;
    let index = 0;

    const tryNext = (): void => {
      if (cancelled) return;
      const url = candidates[index++];
      if (!url) {
        setState({ ready: false });
        return;
      }
      const img = new Image();
      img.onload = () => {
        if (!cancelled) setState({ ready: true, src: url });
      };
      img.onerror = () => tryNext();
      img.src = url;
    };

    setState({ ready: false });
    tryNext();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return state;
};
