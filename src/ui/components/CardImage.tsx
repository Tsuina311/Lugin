import { useEffect, useState, type CSSProperties } from 'react';

/**
 * A card image that walks a fallback list until one URL loads on the visible
 * `<img>` (no separate preload pass).
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
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const key = candidates.join('\0');

  useEffect(() => {
    setIndex(0);
    setLoaded(false);
  }, [key]);

  const src = candidates[index];
  const failed = candidates.length > 0 && index >= candidates.length;

  if (!src || failed) {
    return <div className="h-full w-full bg-raised" />;
  }

  if (!loaded) {
    return (
      <div className="relative h-full w-full">
        <div className="flex h-full w-full items-center justify-center">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-sky-400" />
        </div>
        <img
          alt={alt}
          className={`${className ?? ''} opacity-0`}
          decoding="async"
          loading="eager"
          onError={() => {
            setLoaded(false);
            setIndex(i => i + 1);
          }}
          onLoad={() => setLoaded(true)}
          src={src}
          style={style}
        />
      </div>
    );
  }

  return (
    <img alt={alt} className={className} decoding="async" loading="eager" src={src} style={style} />
  );
};
