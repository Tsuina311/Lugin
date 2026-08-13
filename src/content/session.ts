// Whether Cardmarket still considers this browser logged in, and what to do when
// it doesn't.
//
// Every write we make carries the session's `__cmtkn`, which the site prints into
// the page it serves. Two very different things look the same from a button's
// point of view: a page that simply doesn't carry a token (a product page, a
// search), and a session that has expired. The first is worth a second look; the
// second is only fixed by logging in again, so the tab is handed over and the
// overlay gets out of the way.

import { hideOverlay } from './overlay';

import { replayInPage } from '@/lib/messaging';
import { findCmToken } from '@/sites/cardmarket/cart';
import { looksSignedIn } from '@/sites/cardmarket/wants';

const TOKEN = /__cmtkn['"\s:=]+([0-9a-f]{32,})/i;

const lang = (): string => {
  const first = location.pathname.split('/').filter(Boolean)[0] ?? '';
  return /^[a-z]{2}$/.test(first) ? first : 'en';
};

/**
 * Cardmarket has no separate login page: asked for a page that needs an account
 * without one, it serves the login form in its place and returns you afterwards.
 * So the way to the login screen is simply a page that needs an account.
 */
export const loginUrl = (): string => `${location.origin}/${lang()}/Magic/Wants`;

/**
 * The session token: from this page if it carries one, otherwise from a page that
 * would. `null` means the session isn't logged in.
 */
export const cmToken = async (): Promise<string | null> => {
  const here = findCmToken();
  if (here) return here;
  try {
    const res = await replayInPage({ method: 'GET', url: `/${lang()}/Magic/Wants` });
    // The login form carries a token too, and it opens nothing else — so the page
    // has to be one served to someone signed in for its token to be worth having.
    if (!looksSignedIn(res.body)) return null;
    return res.body.match(TOKEN)?.[1] ?? null;
  } catch {
    return null;
  }
};

/** Hand the tab to Cardmarket's login, with the overlay out of the way. */
export const askForLogin = (): void => {
  hideOverlay();
  location.assign(loginUrl());
};
