import { useEffect, useState, type CSSProperties, type MouseEventHandler } from 'react';

import { Loader2 } from './icons';

/**
 * List thumbnail gated by {@link useSequentialImages}: spinner until unlocked,
 * then spinner until the `<img>` paints (no empty grey frame between).
 */
export const SequentialImage = ({
  alt = '',
  className,
  frameClassName = 'bg-panel',
  markDone,
  onClick,
  onMouseEnter,
  onMouseLeave,
  onMouseMove,
  src,
  style,
  title,
  unlocked,
}: {
  alt?: string;
  className?: string;
  frameClassName?: string;
  markDone: (url: string) => void;
  onClick?: MouseEventHandler<HTMLImageElement>;
  onMouseEnter?: MouseEventHandler<HTMLImageElement>;
  onMouseLeave?: MouseEventHandler<HTMLImageElement>;
  onMouseMove?: MouseEventHandler<HTMLImageElement>;
  src: string;
  style?: CSSProperties;
  title?: string;
  unlocked: boolean;
}) => {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
  }, [src]);

  if (!unlocked) {
    return (
      <span
        className={`relative inline-flex flex-none items-center justify-center ${frameClassName} ${className ?? ''}`}
      >
        <Loader2 aria-hidden className="animate-spin text-ink-faint" size={12} />
      </span>
    );
  }

  return (
    <span className={`relative inline-flex flex-none ${className ?? ''}`}>
      {!loaded && (
        <span
          className={`absolute inset-0 flex items-center justify-center ${frameClassName}`}
        >
          <Loader2 aria-hidden className="animate-spin text-ink-faint" size={12} />
        </span>
      )}
      <img
        alt={alt}
        className={`transition-opacity duration-150 ${loaded ? 'opacity-100' : 'opacity-0'} ${className ?? ''}`}
        decoding="async"
        loading="eager"
        onClick={onClick}
        onError={() => {
          setLoaded(true);
          markDone(src);
        }}
        onLoad={() => {
          setLoaded(true);
          markDone(src);
        }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onMouseMove={onMouseMove}
        src={src}
        style={style}
        title={title}
      />
    </span>
  );
};

/** Large cropped art tile — spinner until unlocked, then until the image paints. */
export const SequentialCoverImage = ({
  alt,
  className,
  markDone,
  src,
  style,
  unlocked,
}: {
  alt: string;
  className?: string;
  markDone: (url: string) => void;
  src: string;
  style?: CSSProperties;
  unlocked: boolean;
}) => {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
  }, [src]);

  if (!unlocked) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 aria-hidden className="animate-spin text-ink-faint" size={14} />
      </div>
    );
  }

  return (
    <>
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 aria-hidden className="animate-spin text-ink-faint" size={14} />
        </div>
      )}
      <img
        alt={alt}
        className={`transition-opacity duration-150 ${loaded ? 'opacity-100' : 'opacity-0'} ${className ?? ''}`}
        decoding="async"
        loading="eager"
        onError={() => {
          setLoaded(true);
          markDone(src);
        }}
        onLoad={() => {
          setLoaded(true);
          markDone(src);
        }}
        src={src}
        style={style}
      />
    </>
  );
};
