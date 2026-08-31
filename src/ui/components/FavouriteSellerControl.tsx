// Star next to a seller name: pin / unpin, and a clear "favourite" cue in lists.

import type { MouseEvent } from 'react';

import { IconButton } from './IconButton';
import { Star } from './icons';

export const FavouriteSellerControl = ({
  active,
  className = '',
  name,
  onToggle,
}: {
  active: boolean;
  className?: string;
  name?: string;
  onToggle: () => void;
}) => {
  const label = active
    ? `Remove ${name ?? 'seller'} from favourites`
    : `Save ${name ?? 'seller'} as a favourite`;

  return (
    <IconButton
      active={active}
      className={`${active ? 'text-amber-300 [&_svg]:fill-amber-300/90' : ''} ${className}`}
      icon={Star}
      label={label}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      size="xs"
      tone={active ? 'accent' : 'default'}
    />
  );
};

/** Compact label for rows that are already favourites (the star button toggles). */
export const FavouriteSellerBadge = ({ className = '' }: { className?: string }) => (
  <span
    className={`inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-300 ${className}`}
    title="Favourite seller"
  >
    <Star aria-hidden className="fill-amber-300/80" size={9} strokeWidth={2} />
    Fav
  </span>
);
