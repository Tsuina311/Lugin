// The overlay's visibility, reachable from outside React.
//
// The panel's mode lives in App's state and is mirrored to the page's
// localStorage so it survives navigation. Anything that needs to get out of the
// user's way — handing the tab to Cardmarket's login, say — has to set both:
// the event for the panel that's on screen now, and the key for the page that
// loads next.

export const OVERLAY_VIEW_KEY = 'lugin:overlayView';
export const OVERLAY_HIDE_EVENT = 'lugin:hide';

/** Collapse the overlay to its restore button, now and after a navigation. */
export const hideOverlay = (): void => {
  try {
    localStorage.setItem(OVERLAY_VIEW_KEY, 'hidden');
  } catch {
    // ignore storage failures (private mode, disabled storage, etc.)
  }
  window.dispatchEvent(new Event(OVERLAY_HIDE_EVENT));
};
