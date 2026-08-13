import { useCallback, useMemo, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';

import { holdingPick, type Modifiers } from './modifier';

/** The modifier keys we read off a click; satisfied by any React mouse event. */
export interface ClickModifiers extends Modifiers {
  shiftKey: boolean;
}

export interface RowSelection {
  /**
   * Selection mode: something is picked, so a plain click on a row toggles it
   * (like picking photos on a phone) instead of doing the row's usual thing.
   */
  active: boolean;
  /** Every visible row is selected — drives the "all" toggle in the bar. */
  all: boolean;
  clear: () => void;
  count: number;
  /** The row the keyboard sits on, drawn with a ring so arrows make sense. */
  cursor: string | null;
  /** The selected rows, in the order they appear on screen. */
  ids: string[];
  /**
   * Spread on the element wrapping the rows. It takes focus so the arrow keys
   * have somewhere to start, and listens for keys bubbling out of the rows.
   */
  listProps: {
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
    tabIndex: number;
  };
  /**
   * Spread on a row element: its own classes plus the selection tint, the marker
   * the arrow keys use to scroll a row into view, and the click / long-press
   * handling that starts and extends a selection.
   */
  rowProps: (id: string, extra?: string) => SelectableRowProps;
  /** Select everything, or drop it all if everything already is. */
  toggleAll: () => void;
}

// A selected row is washed in accent. The backgrounds are marked important
// because rows bring their own (`bg-slate-800`, `hover:bg-slate-800/50`) and
// which of two same-property utilities wins otherwise comes down to the order
// Tailwind happened to emit them in.
const SELECTED_CLASS = '!bg-select text-ink hover:!bg-select-strong';
/** The keyboard's row, whether or not it's selected. */
const CURSOR_CLASS = 'ring-1 ring-inset ring-accent';
/** In selection mode the whole row is a target, so it says so. */
const ACTIVE_CLASS = 'cursor-pointer select-none';

/** Rows carry this so the list can scroll its cursor into view. */
const rowIdAttr = 'data-lugin-row';

/** Touch: how long a press has to last, and how far it may drift, to count. */
const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP = 10;

export interface SelectableRowProps {
  'aria-selected': boolean;
  className: string;
  onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  [rowIdAttr]: string;
}

const isTypingTarget = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLInputElement) return el.type !== 'checkbox' && el.type !== 'radio';
  return el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
};

/** Controls that do something of their own with the space bar. */
const ownsSpaceBar = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement && ['A', 'BUTTON', 'INPUT', 'SUMMARY'].includes(el.tagName);

const closestMatch = (el: EventTarget | null, selector: string): boolean =>
  el instanceof Element && !!el.closest(selector);

/**
 * A control inside the row that owns its own clicks (remove, +/-, add…). In
 * selection mode those keep working; only clicks on the row itself select. A
 * control that fills the whole row can mark itself `data-lugin-row-click` to give
 * selection mode precedence, since there'd be nothing left to click otherwise.
 */
const isRowControl = (el: EventTarget | null): boolean =>
  closestMatch(el, 'button, a[href], input, select, textarea, summary, label, [role="button"]') &&
  !closestMatch(el, '[data-lugin-row-click]');

/**
 * Multi-select for a list of rows. A selection starts with an ⌥/ctrl-click (see
 * `modifier.ts`) or a long press on touch, and from then on the list is in
 * selection mode, where a plain click picks another row — the way photos are
 * picked on a phone, so there are no per-row checkboxes to aim at.
 *
 * Shift-click takes a range, the arrows walk
 * the list, shift-arrows drag the selection along, ⌘A takes everything and escape
 * drops it. Controls inside a row (add, remove, quantity) keep their own clicks.
 *
 * Pass the ids of the *visible* rows in display order — that order is what
 * ranges and arrow keys follow, and rows that scroll out of existence (filtered
 * away, deleted) leave the selection on their own.
 */
export const useRowSelection = (ids: string[]): RowSelection => {
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  // Where the last range started. A ref: changing it never needs a repaint.
  const anchor = useRef<string | null>(null);

  // Callers rebuild the id array every render, so keep a copy that only changes
  // when its contents do; everything below can then be memoized on it.
  const order = useMemo(() => ids.join('\u0000'), [ids]);
  const rows = useMemo(() => (order === '' ? [] : order.split('\u0000')), [order]);
  const index = useMemo(() => new Map(rows.map((id, i) => [id, i] as const)), [rows]);

  // Rows can vanish under a selection (a filter, a bulk delete), so the visible
  // selection is intersected rather than pruned: nothing to keep in sync, and a
  // filter that comes back brings its selection with it.
  const selected = useMemo(() => rows.filter(id => picked.has(id)), [rows, picked]);

  // Clearing drops the cursor as well, so the next arrow key starts from the top
  // of the list rather than wherever the last click happened to leave it.
  const clear = useCallback(() => {
    setPicked(new Set());
    setCursor(null);
    anchor.current = null;
  }, []);

  const toggleAll = useCallback(() => {
    setPicked(prev => {
      const every = rows.length > 0 && rows.every(id => prev.has(id));
      return every ? new Set() : new Set(rows);
    });
  }, [rows]);

  /** The ids between two rows, inclusive, whichever way round they are. */
  const range = useCallback(
    (from: string, to: string): string[] => {
      const a = index.get(from);
      const b = index.get(to);
      if (a == null || b == null) return [to];
      return rows.slice(Math.min(a, b), Math.max(a, b) + 1);
    },
    [index, rows],
  );

  const toggleRow = useCallback(
    (id: string, mods?: ClickModifiers) => {
      if (mods?.shiftKey && anchor.current) {
        const block = range(anchor.current, id);
        setPicked(prev => new Set([...prev, ...block]));
      } else {
        setPicked(prev => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        anchor.current = id;
      }
      setCursor(id);
    },
    [range],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (isTypingTarget(event.target)) return;
      const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
      const jump =
        event.key === 'Home' ? 0 : event.key === 'End' ? Math.max(0, rows.length - 1) : null;

      if (step === 0 && jump == null) {
        if (event.key === 'Escape' && picked.size > 0) {
          event.preventDefault();
          clear();
        } else if (event.key === 'a' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          setPicked(new Set(rows));
        } else if (event.key === ' ' && cursor && !ownsSpaceBar(event.target)) {
          // A checkbox or button handles its own space bar; elsewhere it's ours.
          event.preventDefault();
          toggleRow(cursor, event);
        }
        return;
      }
      if (rows.length === 0) return;
      event.preventDefault();

      const at = cursor == null ? -1 : (index.get(cursor) ?? -1);
      const from = at < 0 ? (step > 0 ? 0 : rows.length - 1) : at + step;
      const to = jump ?? Math.min(rows.length - 1, Math.max(0, from));
      const id = rows[to];
      setCursor(id);
      // Held, the key walks the list without disturbing the selection.
      if (!holdingPick(event)) {
        if (event.shiftKey) {
          const from = anchor.current ?? cursor ?? id;
          anchor.current = from;
          setPicked(new Set(range(from, id)));
        } else {
          anchor.current = id;
          setPicked(new Set([id]));
        }
      }
      // The row already exists; no need to wait for the repaint.
      event.currentTarget
        .querySelector(`[${rowIdAttr}="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    },
    [clear, cursor, index, picked.size, range, rows, toggleRow],
  );

  // A long press has already selected, so the click it turns into must not
  // undo it (or trigger whatever the row would normally do).
  const swallowClick = useRef(false);
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  const endPress = useCallback(() => {
    if (press.current) {
      clearTimeout(press.current.timer);
      press.current = null;
    }
  }, []);

  const active = picked.size > 0;

  const rowProps = useCallback(
    (id: string, extra = ''): SelectableRowProps => ({
      'aria-selected': picked.has(id),
      className: `${extra} ${active ? ACTIVE_CLASS : ''} ${picked.has(id) ? SELECTED_CLASS : ''} ${
        cursor === id ? CURSOR_CLASS : ''
      }`.trim(),
      // Capture, so a modifier-click claims the event before a button inside the
      // row can act on it — bubbling would be too late.
      onClickCapture: (event: ReactMouseEvent<HTMLElement>) => {
        if (swallowClick.current) {
          swallowClick.current = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        const modified = holdingPick(event) || event.shiftKey;
        // A modified click on a link is the browser's (new tab, download); leave it.
        if (modified && closestMatch(event.target, 'a[href]')) return;
        if (!modified && (!active || isRowControl(event.target))) return;
        event.preventDefault();
        event.stopPropagation();
        toggleRow(id, event);
      },
      onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
        // Android raises this at the end of a long press; we've handled it.
        if (press.current || swallowClick.current) event.preventDefault();
      },
      onPointerCancel: endPress,
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
        swallowClick.current = false;
        if (event.pointerType !== 'touch' || isRowControl(event.target)) return;
        endPress();
        press.current = {
          timer: window.setTimeout(() => {
            press.current = null;
            swallowClick.current = true;
            toggleRow(id);
          }, LONG_PRESS_MS),
          x: event.clientX,
          y: event.clientY,
        };
      },
      // Scrolling the list is a press that moves, not a long press.
      onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
        const held = press.current;
        if (!held) return;
        const drift =
          Math.abs(event.clientX - held.x) > LONG_PRESS_SLOP ||
          Math.abs(event.clientY - held.y) > LONG_PRESS_SLOP;
        if (drift) endPress();
      },
      onPointerUp: endPress,
      [rowIdAttr]: id,
    }),
    [active, cursor, endPress, picked, toggleRow],
  );

  return {
    active,
    all: rows.length > 0 && selected.length === rows.length,
    clear,
    count: selected.length,
    cursor,
    ids: selected,
    listProps: { onKeyDown, tabIndex: 0 },
    rowProps,
    toggleAll,
  };
};
