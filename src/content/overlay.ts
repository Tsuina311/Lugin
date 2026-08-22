// The overlay's visibility, reachable from outside React.
//
// The panel's mode lives in App's state and is mirrored to the page's
// localStorage so it survives navigation. Anything that needs to get out of the
// user's way — handing the tab to Cardmarket's login, say — has to set both:
// the event for the panel that's on screen now, and the key for the page that
// loads next.

export const OVERLAY_VIEW_KEY = 'lugin:overlayView';
export const OVERLAY_HIDE_EVENT = 'lugin:hide';
/** Restore panel/full after Cardmarket login when {@link rememberReopenAfterLogin} ran. */
export const OVERLAY_SHOW_EVENT = 'lugin:show';
/** Open the Lugin cart tab (site cart links are redirected here). */
export const OVERLAY_OPEN_CART_EVENT = 'lugin:open-cart';
/** Written before navigating to Cardmarket login — cleared once the overlay reopens. */
export const REOPEN_AFTER_LOGIN_KEY = 'lugin:reopenAfterLogin';
/** Last panel/full mode before the overlay was hidden — survives hideOverlay(). */
export const LAST_VISIBLE_VIEW_KEY = 'lugin:lastVisibleView';

/** Remember panel/full so we can restore it once Cardmarket login succeeds. */
export const rememberReopenAfterLogin = (): void => {
  try {
    const view =
      localStorage.getItem(LAST_VISIBLE_VIEW_KEY) ??
      localStorage.getItem(OVERLAY_VIEW_KEY);
    if (view === 'panel' || view === 'full') {
      localStorage.setItem(REOPEN_AFTER_LOGIN_KEY, view);
    }
  } catch {
    // ignore storage failures
  }
};

/** After login, reopen the overlay if the user started from a sign-in handoff. */
export const reopenOverlayIfPending = (): void => {
  try {
    const pending = localStorage.getItem(REOPEN_AFTER_LOGIN_KEY);
    if (pending !== 'panel' && pending !== 'full') return;
    localStorage.removeItem(REOPEN_AFTER_LOGIN_KEY);
    localStorage.setItem(OVERLAY_VIEW_KEY, pending);
    window.dispatchEvent(new Event(OVERLAY_SHOW_EVENT));
  } catch {
    // ignore storage failures
  }
};

/** Collapse the overlay to its restore button, now and after a navigation. */
export const hideOverlay = (): void => {
  try {
    localStorage.setItem(OVERLAY_VIEW_KEY, 'hidden');
  } catch {
    // ignore storage failures (private mode, disabled storage, etc.)
  }
  window.dispatchEvent(new Event(OVERLAY_HIDE_EVENT));
};

/** Show the Lugin cart — navigate to the real cart page in this tab when needed. */
export const openOverlayCart = (): void => {
  try {
    localStorage.setItem('lugin:tab', 'cart');
    const view = localStorage.getItem(OVERLAY_VIEW_KEY);
    if (view === 'hidden') localStorage.setItem(OVERLAY_VIEW_KEY, 'panel');
  } catch {
    // ignore
  }
  if (!/\/Magic\/ShoppingCart\/?$/i.test(location.pathname)) {
    const first = location.pathname.split('/').filter(Boolean)[0] ?? '';
    const lang = /^[a-z]{2}$/.test(first) ? first : 'en';
    location.assign(`${location.origin}/${lang}/Magic/ShoppingCart`);
    return;
  }
  window.dispatchEvent(new Event(OVERLAY_OPEN_CART_EVENT));
};
