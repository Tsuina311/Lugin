import { useEffect, useRef, useState, type ReactNode } from 'react';

// A control that opens a small panel beneath it: menus and settings that would
// otherwise each take a row of their own. Closes on Escape or a click anywhere
// else.

export const Popover = ({
  align = 'right',
  children,
  className = 'w-64',
  label,
  trigger,
}: {
  /** Which edge of the trigger the panel lines up with. */
  align?: 'left' | 'right';
  /** The panel's contents; the function form gets a way to close it. */
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Width and anything else for the panel. */
  className?: string;
  /** Accessible name of the panel. */
  label: string;
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      // Not `contains`: the overlay lives in a shadow root, so at the document
      // every event's target is the host and every click would look outside.
      const inside = box.current !== null && e.composedPath().includes(box.current);
      if (!inside) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = (): void => setOpen(false);

  return (
    <div ref={box} className="relative flex-none">
      {trigger({ open, toggle: () => setOpen(o => !o) })}
      {open && (
        <div
          aria-label={label}
          className={`absolute top-full z-30 mt-1 rounded-md border border-line-strong bg-panel p-2 text-xs text-ink shadow-pop ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${className}`}
          role="dialog"
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  );
};
