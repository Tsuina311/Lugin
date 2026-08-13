import type { ReactNode } from 'react';

import { Button } from './Button';
import { IconButton } from './IconButton';
import { X } from './icons';

import { IS_MAC, PICK_KEY } from '@/ui/modifier';
import type { RowSelection } from '@/ui/useRowSelection';

// The bar that sits above a multi-selectable list: how to start a selection, how
// many are picked, and a home for the list's bulk actions. Rows have no
// checkboxes — `useRowSelection` owns the click, long-press and keyboard rules.

const isTouch = window.matchMedia?.('(pointer: coarse)').matches ?? false;

/** How to get the first row selected, in the words of the device in hand. */
const HINT = isTouch
  ? 'Long-press a row to select it, then tap others'
  : `${PICK_KEY}-click a row to select it, then click others`;

/** The tooltip is where the rest of the shortcuts are written down. */
const SHORTCUTS = `${HINT}. Shift-click takes a range. In the list: ↑↓ to move, shift+↑↓ to extend, space to toggle, ${
  IS_MAC ? '⌘' : 'ctrl'
}+A for all, esc to clear.`;

/**
 * It only takes on the accent wash — and only shows the actions — once something
 * is selected, so an idle list stays quiet and just says how to start.
 */
export const SelectionBar = ({
  children,
  selection,
}: {
  children?: ReactNode;
  selection: RowSelection;
}) => (
  <div
    className={`flex flex-none flex-wrap items-center gap-1.5 border-b border-line px-2 py-1 text-2xs transition-colors ${
      selection.active ? 'bg-accent-soft' : 'bg-panel'
    }`}
    title={SHORTCUTS}
  >
    {selection.active ? (
      <>
        <span className="font-medium text-ink">{selection.count} selected</span>
        <Button onClick={selection.toggleAll} size="xs" variant="subtle">
          {selection.all ? 'none' : 'all'}
        </Button>
        {children}
        <IconButton
          className="ml-auto"
          icon={X}
          label="Clear the selection"
          onClick={selection.clear}
          size="xs"
        />
      </>
    ) : (
      <span className="text-ink-faint">{HINT}</span>
    )}
  </div>
);
