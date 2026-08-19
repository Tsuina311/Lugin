import type { CSSProperties } from 'react';

import { useFirstLoadedImage } from './useFirstLoadedImage';

/**
 * A card image that walks a fallback list until one URL loads.
 */
export const CardImage = ({
  alt,
  candidates,
  className,
  style,
}: {
  alt: string;
  candidates: readonly string[];
  className?: string;
  style?: CSSProperties;
}) => {
  const { ready, src } = useFirstLoadedImage(candidates);

  if (!ready || !src) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-sky-400" />
      </div>
    );
  }

  return <img alt={alt} className={className} src={src} style={style} />;
};
