import { useState, type ReactNode } from 'react';

import { Info } from './icons';

// A small "?" for a sentence that would clutter the line it explains.
//
// Not the `title` attribute: the browser decides when that appears, and it takes
// a second or two of holding still — long enough that most people move on before
// it shows, which makes the icon look decorative. Revealing on `group-hover` is
// instant, and it can be styled to match the panel.
//
// Clicking pins it open, because hover does not exist on a touchscreen, and the
// button is real so it can be reached and read by keyboard.

interface HintProps {
  /** Which edge to anchor to — flip it when the icon is near the right of a panel. */
  align?: 'left' | 'right';
  children: ReactNode;
  /** What the icon is called for anyone not seeing it. */
  label?: string;
}

export const Hint = ({ align = 'left', children, label = 'More information' }: HintProps) => {
  const [pinned, setPinned] = useState(false);

  return (
    <span className="group relative inline-flex items-center">
      <button
        aria-expanded={pinned}
        aria-label={label}
        className="flex text-ink-faint transition-colors hover:text-ink group-focus-within:text-ink"
        onClick={() => setPinned(p => !p)}
        type="button"
      >
        <Info aria-hidden size={11} />
      </button>
      <span
        className={`absolute top-full z-30 mt-1 w-56 rounded-md border border-line-strong bg-panel p-1.5 text-2xs font-normal leading-relaxed text-ink-muted shadow-pop group-hover:visible group-focus-within:visible ${
          pinned ? 'visible' : 'invisible'
        } ${align === 'right' ? 'right-0' : 'left-0'}`}
        role="tooltip"
      >
        {children}
      </span>
    </span>
  );
};
