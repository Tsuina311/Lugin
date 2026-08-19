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
 * A token borrowed from another page, kept for the life of this content script.
 *
 * The token is per-session, so it is worth asking for once. Search types into
 * this on every keystroke, and fetching a whole page each time to read the same
 * string back would be a page load per search.
 *
 * Only a *successful* borrow is remembered. A null means either signed out or a
 * failed fetch, and both are things the user can go and fix — caching them would
 * mean signing in and still being told to sign in.
 */
let borrowed: Promise<string | null> | null = null;

const borrow = async (): Promise<string | null> => {
  try {
    const res = await replayInPage({ method: 'GET', url: `/${lang()}/Magic/Wants` });
    // The login form carries a token too, and it opens nothing else — so the page
    // has to be one served to someone signed in for its token to be worth having.
    const token = looksSignedIn(res.body) ? (res.body.match(TOKEN)?.[1] ?? null) : null;
    if (!token) borrowed = null;
    return token;
  } catch {
    borrowed = null;
    return null;
  }
};

/**
 * The session token: from this page if it carries one, otherwise from a page that
 * would. `null` means the session isn't logged in.
 *
 * The second half is not a rare path. Most of Cardmarket — product pages, search
 * results, expansion listings — carries no token at all, so anything that reads
 * one straight off the page works only on the handful of pages that do.
 */
export const cmToken = async (): Promise<string | null> => {
  const here = findCmToken();
  if (here) return here;
  return (borrowed ??= borrow());
};

/** Hand the tab to Cardmarket's login, with the overlay out of the way. */
export const askForLogin = (): void => {
  hideOverlay();
  location.assign(loginUrl());
};
