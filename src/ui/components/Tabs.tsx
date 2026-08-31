import { useEffect, useRef } from 'react';

import { Badge } from './Badge';
import type { LucideIcon } from './icons';

// The overlay's top-level navigation: icon + label, with the active tab marked
// by an accent underline rather than a filled pill, so a row of five doesn't
// shout. Scrolls sideways instead of wrapping when the panel is narrow, which
// keeps the header exactly one line tall at any width.

export interface TabItem<T extends string> {
  /** Optional count shown as a badge (hidden when 0). */
  count?: number;
  icon?: LucideIcon;
  id: T;
  label: string;
  title?: string;
}

export const Tabs = <T extends string>({
  items,
  onChange,
  value,
}: {
  items: TabItem<T>[];
  onChange: (id: T) => void;
  value: T;
}) => {
  const listRef = useRef<HTMLDivElement>(null);

  // Narrow panels scroll tabs off-screen — keep the active one visible.
  useEffect(() => {
    const active = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    active?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [value]);

  return (
    <div className="relative flex-none border-b border-line bg-panel">
      <div
        ref={listRef}
        className="flex items-stretch gap-px overflow-x-auto px-1 scroll-smooth [scrollbar-width:thin]"
        role="tablist"
      >
        {items.map(({ count, icon: Icon, id, label, title }) => {
          const on = id === value;
          return (
            <button
              key={id}
              aria-selected={on}
              className={`relative flex flex-none items-center gap-1.5 rounded-t px-2 py-1.5 text-xs font-medium transition-colors ${
                on ? 'text-ink' : 'text-ink-faint hover:bg-tint hover:text-ink-muted'
              }`}
              onClick={() => onChange(id)}
              role="tab"
              title={title ?? label}
              type="button"
            >
              {Icon && <Icon aria-hidden size={13} strokeWidth={2} />}
              {label}
              {count ? <Badge tone={on ? 'accent' : 'neutral'}>{count}</Badge> : null}
              {on && <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-accent" />}
            </button>
          );
        })}
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-3 bg-gradient-to-r from-panel to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-3 bg-gradient-to-l from-panel to-transparent"
      />
    </div>
  );
};
