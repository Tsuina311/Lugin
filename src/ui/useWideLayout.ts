import { useEffect, useState } from 'react';

/**
 * Whether a panel has at least `min` CSS pixels to work with, so it can lay
 * itself out for the space it actually has — full screen, or a side panel the
 * user dragged wide — rather than for the window, which says nothing about it.
 *
 * Attach `ref` to the element that owns the width. The answer is a boolean, so a
 * resize only costs a render when the layout genuinely has to change.
 */
export const useWideLayout = (
  min: number,
): { ref: (el: HTMLElement | null) => void; wide: boolean } => {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [wide, setWide] = useState(false);

  useEffect(() => {
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      const width = entries[entries.length - 1]?.contentRect.width ?? 0;
      setWide(width >= min);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, min]);

  return { ref: setEl, wide };
};
