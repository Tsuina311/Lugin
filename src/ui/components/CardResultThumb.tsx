import { useEffect, useState, type CSSProperties } from 'react';

import { Loader2 } from './icons';
import { useCardPreview } from './cardPreview';

/** Small card art in a search-result row — hover to preview, click to enlarge. */
export const CardResultThumb = ({
  candidates,
  className = 'relative h-8 w-8 flex-none overflow-hidden rounded bg-raised',
  faceImages,
  imgStyle = { objectPosition: '50% 18%' },
  name,
  previewKey,
}: {
  /** Try each URL on the visible `<img>` until one loads. */
  candidates: readonly string[];
  className?: string;
  faceImages?: string[];
  imgStyle?: CSSProperties;
  name: string;
  previewKey: string;
}) => {
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const key = candidates.join('\0');

  useEffect(() => {
    setIndex(0);
    setLoaded(false);
  }, [key]);

  const src = candidates[index];
  const failed = candidates.length > 0 && index >= candidates.length;
  const waiting = !!src && !loaded && !failed;
  const previewUrls =
    src && faceImages && faceImages.length >= 2
      ? [src, ...faceImages.slice(1)]
      : src
        ? [src]
        : [];
  const preview = useCardPreview();
  const { flippable, handlers } = preview(previewKey, name, previewUrls);

  return (
    <div
      className={className}
      {...(previewUrls.length > 0 || waiting ? handlers : {})}
    >
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
            } ${flippable ? 'cursor-flip' : 'cursor-zoom-in'}`}
            decoding="async"
            loading="eager"
            onError={() => {
              setLoaded(false);
              setIndex(i => i + 1);
            }}
            onLoad={() => setLoaded(true)}
            src={src}
            style={imgStyle}
            title={flippable ? 'Click to enlarge; click again to flip' : 'Click to enlarge'}
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
