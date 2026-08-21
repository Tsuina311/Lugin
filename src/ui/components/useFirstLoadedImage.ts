import { useEffect, useState } from 'react';

/** Give up on a hung image request and try the next candidate. */
const CANDIDATE_TIMEOUT_MS = 8_000;

/**
 * Try a list of image URLs in order and return the first one that loads. Used
 * when the best URL (CDN, Cardmarket thumbnail, …) may 404 or be blocked, but a
 * Scryfall API redirect further down the list still works.
 *
 * Each candidate has a timeout so a stalled request can't leave the spinner
 * spinning forever; when every candidate fails, `failed` is set so the UI can
 * show an empty frame instead of an endless loader.
 */
export const useFirstLoadedImage = (
  candidates: readonly string[],
): { failed: boolean; ready: boolean; src?: string } => {
  const [state, setState] = useState<{ failed: boolean; ready: boolean; src?: string }>({
    failed: false,
    ready: false,
  });
  const key = candidates.join('\0');

  useEffect(() => {
    if (candidates.length === 0) {
      setState({ failed: false, ready: false });
      return;
    }
    let cancelled = false;
    let index = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const clear = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };

    const tryNext = (): void => {
      if (cancelled) return;
      clear();
      const url = candidates[index++];
      if (!url) {
        setState({ failed: true, ready: false });
        return;
      }
      const img = new Image();
      const advance = (): void => {
        clear();
        img.onload = null;
        img.onerror = null;
        // Detach so a late response can't call into a cancelled chain.
        try {
          img.src = '';
        } catch {
          // ignore
        }
        tryNext();
      };
      img.onload = () => {
        if (cancelled) return;
        clear();
        setState({ failed: false, ready: true, src: url });
      };
      img.onerror = () => advance();
      timer = setTimeout(advance, CANDIDATE_TIMEOUT_MS);
      img.src = url;
    };

    setState({ failed: false, ready: false });
    tryNext();
    return () => {
      cancelled = true;
      clear();
    };
  }, [key]);

  return state;
};
