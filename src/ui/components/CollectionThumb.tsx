import type { CSSProperties } from 'react';

import { CardResultThumb } from './CardResultThumb';

/** Tag-search-style thumbnail with collection image fallbacks. */
export const CollectionThumb = ({
  candidates,
  className = 'relative h-8 w-8 flex-none overflow-hidden rounded bg-raised',
  faceImages,
  hover,
  imgStyle,
  name,
  previewKey,
}: {
  candidates: readonly string[];
  className?: string;
  faceImages?: string[];
  hover?: boolean;
  imgStyle?: CSSProperties;
  name: string;
  previewKey: string;
}) => (
  <CardResultThumb
    candidates={candidates}
    className={className}
    faceImages={faceImages}
    hover={hover}
    imgStyle={imgStyle}
    name={name}
    previewKey={previewKey}
  />
);
