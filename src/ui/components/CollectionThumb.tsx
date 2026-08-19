import type { CSSProperties } from 'react';

import { CardResultThumb } from './CardResultThumb';
import { useFirstLoadedImage } from './useFirstLoadedImage';

/** Tag-search-style thumbnail with collection image fallbacks. */
export const CollectionThumb = ({
  candidates,
  className = 'h-8 w-8 flex-none overflow-hidden rounded bg-raised',
  faceImages,
  imgStyle,
  name,
  previewKey,
}: {
  candidates: readonly string[];
  className?: string;
  faceImages?: string[];
  imgStyle?: CSSProperties;
  name: string;
  previewKey: string;
}) => {
  const { ready, src } = useFirstLoadedImage(candidates);
  const urls =
    src && faceImages && faceImages.length >= 2
      ? [src, ...faceImages.slice(1)]
      : src
        ? [src]
        : [];

  return (
    <CardResultThumb
      className={className}
      imgStyle={imgStyle}
      loading={!ready && candidates.length > 0}
      name={name}
      previewKey={previewKey}
      urls={urls}
    />
  );
};
