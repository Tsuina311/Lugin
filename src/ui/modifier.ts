// The one key the overlay asks people to hold: ⌥ on a Mac, Ctrl everywhere else.
// It starts a selection and, held while dragging, copies instead of moving.
//
// ⌘ was the obvious Mac choice and had to go. Chrome never fires `drop` while it
// is held (crbug 40895588), so a ⌘-drag can only spring back — and a key that
// picks rows but can't finish a drag is worse than no convention at all. ⌥ does
// both, and is already what macOS uses to copy a drag.

export const IS_MAC =
  typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent);

/** The key, as this machine writes it. */
export const PICK_KEY = IS_MAC ? '⌥' : 'Ctrl';

/** The modifier flags of any mouse, drag, pointer or keyboard event. */
export interface Modifiers {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * Whether the key is down. ⌘ deliberately doesn't count on a Mac: a key that
 * selects rows but can't finish a drag teaches the wrong habit, and a click that
 * does nothing sends people to the hint that names the right one.
 */
export const holdingPick = (e: Modifiers): boolean => (IS_MAC ? e.altKey : e.ctrlKey);
