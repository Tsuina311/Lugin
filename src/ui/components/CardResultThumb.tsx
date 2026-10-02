import { useEffect, useState, type CSSProperties } from 'react';

import { Loader2 } from './icons';
import { useCardPreview } from './cardPreview';

import { previewStore } from '@/content/previewStore';

/** Small card art in a search-result row — hover to preview, click to enlarge. */
export const CardResultThumb = ({
  candidates,
  className = 'relative h-8 w-8 flex-none overflow-hidden rounded bg-raised',
  faceImages,
  hover = true,
  imgStyle = { objectPosition: '50% 18%' },
  name,
  previewKey,
}: {
  /** Try each URL on the visible `<img>` until one loads. */
  candidates: readonly string[];
  className?: string;
  faceImages?: string[];
  /** False when the art is already large — a hover popup then fights the grid. */
  hover?: boolean;
  imgStyle?: CSSProperties;
  name: string;
  previewKey: string;
}) => {
  const [index, setIndex] = useState(0);
  // The URL that finished loading, not a flag: the list can change around a
  // picture that's already up (metadata adding a fallback), and an unchanged
  // `src` never fires a second load to set a reset flag back.
  const [loadedSrc, setLoadedSrc] = useState<string>();
  const key = candidates.join('\0');

  useEffect(() => setIndex(0), [key]);

  const src = candidates[index];
  const loaded = !!src && src === loadedSrc;
  const failed = candidates.length > 0 && index >= candidates.length;
  const waiting = !!src && !loaded && !failed;
  const previewUrls =
    src && faceImages && faceImages.length >= 2
      ? [src, ...faceImages.slice(1)]
      : src
        ? [src]
        : [];
  const preview = useCardPreview();
  const { handlers } = preview(previewKey, name, previewUrls);
  const pointer =
    previewUrls.length > 0 || waiting
      ? hover
        ? handlers
        : handlers.onClick
          ? { onClick: handlers.onClick }
          : {}
      : {};

  // A thumbnail unmounted under the pointer never gets its mouseleave, which
  // would leave its hover popup up.
  useEffect(() => {
    return () => {
      const shown = previewStore.getSnapshot();
      if (shown?.key === previewKey && !shown.pinned) previewStore.hide();
    };
  }, [previewKey]);

  // Positioned whatever `className` says: the loading spinner is `absolute
  // inset-0`, and without a containing block here it spreads over the whole
  // overlay, swallowing every click and wheel scroll until the image loads.
  return (
    <div className={`relative ${className}`} {...pointer}>
      {src && !failed ? (
        <>
          {waiting && (
            <div className="absolute inset-0 z-10 flex items-center justify-center">
              <Loader2 aria-hidden className="h-3 w-3 animate-spin text-ink-faint" />
            </div>
          )}
          <img
            alt={name}
            className={`h-full w-full object-cover transition-opacity duration-150 ${
              loaded ? 'opacity-100' : 'opacity-0'
            } cursor-zoom-in`}
            decoding="async"
            loading="lazy"
            onError={() => setIndex(i => i + 1)}
            onLoad={() => setLoadedSrc(src)}
            src={src}
            style={imgStyle}
          />
        </>
      ) : waiting ? (
        <div className="flex h-full w-full items-center justify-center">
          <Loader2 aria-hidden className="h-3 w-3 animate-spin text-ink-faint" />
        </div>
      ) : null}
    </div>
  );
};
