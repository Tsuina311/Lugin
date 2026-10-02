import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { Layers } from './icons';

import { expansionIconStore } from '@/content/expansionIconStore';
import { normalizeSetName } from '@/lib/sets';

/**
 * A card's set symbol. Cardmarket's own sprite when we've seen that set,
 * otherwise Scryfall's. Hover names the edition; the click is the caller's.
 */
export const SetSymbol = ({
  onClick,
  setCode,
  setName,
}: {
  onClick: () => void;
  setCode?: string;
  setName?: string;
}) => {
  const icons = useSyncExternalStore(expansionIconStore.subscribe, expansionIconStore.getSnapshot);
  const button = useRef<HTMLButtonElement>(null);
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  // Scryfall draws these symbols white. On Cardmarket's light page that is
  // invisible, so once we know the theme we paint them black there.
  const [onLight, setOnLight] = useState(false);
  const code = setCode?.trim().toLowerCase();
  const name = setName?.trim();

  useEffect(() => {
    const theme = button.current?.closest('[data-lugin-theme]')?.getAttribute('data-lugin-theme');
    setOnLight(theme === 'site');
  }, [code, name]);

  const src = code ? `https://svgs.scryfall.io/sets/${code}.svg` : '';
  const label = name || (code ? code.toUpperCase() : 'Edition');
  const sprite = name ? icons[normalizeSetName(name)] : undefined;

  return (
    <button
      ref={button}
      className="inline-flex flex-none items-center justify-center p-0.5 text-ink-muted hover:text-ink"
      onClick={event => {
        event.stopPropagation();
        onClick();
      }}
      title={`${label} — click to change`}
      type="button"
    >
      {sprite ? (
        <span
          aria-hidden
          style={{
            backgroundImage: `url("${sprite.url}")`,
            backgroundPosition: sprite.pos,
            backgroundRepeat: 'no-repeat',
            height: sprite.size,
            width: sprite.size,
          }}
        />
      ) : src && brokenSrc !== src ? (
        <img
          alt=""
          className="set-symbol h-4 w-4"
          onError={() => setBrokenSrc(src)}
          src={src}
          style={onLight ? { filter: 'brightness(0)' } : undefined}
        />
      ) : code ? (
        <span className="text-2xs font-semibold uppercase">{code.slice(0, 3)}</span>
      ) : (
        <Layers aria-hidden size={14} />
      )}
    </button>
  );
};
