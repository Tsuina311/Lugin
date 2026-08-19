import type { CSSProperties } from 'react';

import { Loader2 } from './icons';
import { useCardPreview } from './cardPreview';

/** Small card art in a search-result row — hover to preview, click to enlarge. */
export const CardResultThumb = ({
  className = 'h-8 w-8 flex-none overflow-hidden rounded bg-raised',
  imgStyle = { objectPosition: '50% 18%' },
  loading = false,
  name,
  previewKey,
  urls,
}: {
  className?: string;
  imgStyle?: CSSProperties;
  /** Show a spinner inside the frame while the image URL is still resolving. */
  loading?: boolean;
  name: string;
  previewKey: string;
  urls: readonly string[];
}) => {
  const preview = useCardPreview();
  const { flippable, handlers } = preview(previewKey, name, [...urls]);

  return (
    <div className={className} {...(urls.length > 0 || loading ? handlers : {})}>
      {urls[0] ? (
        <img
          alt={name}
          className={`h-full w-full object-cover ${flippable ? 'cursor-pointer' : 'cursor-zoom-in'}`}
          decoding="async"
          loading="lazy"
          src={urls[0]}
          style={imgStyle}
          title={flippable ? 'Click to enlarge; click again to flip' : 'Click to enlarge'}
        />
      ) : loading ? (
        <div className="flex h-full w-full items-center justify-center">
          <Loader2 aria-hidden className="h-3 w-3 animate-spin text-ink-faint" />
        </div>
      ) : null}
    </div>
  );
};
