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
import { extractCmToken, findCmToken } from '@/sites/cardmarket/cart';
import { looksSignedIn } from '@/sites/cardmarket/wants';

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
let ajaxBorrowed: Promise<string | null> | null = null;

/** Pages Cardmarket tends to embed a session token on, tried in order. */
const tokenPages = (): string[] => {
  const l = lang();
  const here = location.pathname;
  const pages = [`/${l}/Magic`, `/${l}/Magic/Wants`];
  if (here.includes('/Magic/') && !pages.includes(here)) pages.unshift(here);
  return pages;
};

const borrowFromPages = async (signedInOnly: boolean): Promise<string | null> => {
  for (const url of tokenPages()) {
    try {
      const res = await replayInPage({ method: 'GET', url });
      if (signedInOnly && !looksSignedIn(res.body)) continue;
      const token = extractCmToken(res.body);
      if (token) return token;
    } catch {
      // Try the next page.
    }
  }
  return null;
};

const borrow = async (): Promise<string | null> => {
  try {
    const token = await borrowFromPages(true);
    if (!token) borrowed = null;
    return token;
  } catch {
    borrowed = null;
    return null;
  }
};

const borrowAjax = async (): Promise<string | null> => {
  try {
    const token = await borrowFromPages(false);
    if (!token) ajaxBorrowed = null;
    return token;
  } catch {
    ajaxBorrowed = null;
    return null;
  }
};

/**
 * The session token for writes: from this page if it carries one, otherwise from
 * a page that would — but only when that page was served to someone signed in.
 * `null` means the session isn't logged in.
 */
export const cmToken = async (): Promise<string | null> => {
  const here = findCmToken();
  if (here) return here;
  return (borrowed ??= borrow());
};

/**
 * The session token for read-only AJAX such as catalogue search.
 *
 * Most of Cardmarket carries no token in the DOM, but nearly every page HTML
 * includes one once fetched — including pages served to guests. Writes still
 * need {@link cmToken}; search only needs the CSRF string the site's own box
 * sends.
 */
export const ajaxToken = async (): Promise<string | null> => {
  const here = findCmToken();
  if (here) return here;
  return (ajaxBorrowed ??= borrowAjax());
};

/** Hand the tab to Cardmarket's login, with the overlay out of the way. */
export const askForLogin = (): void => {
  hideOverlay();
  location.assign(loginUrl());
};
