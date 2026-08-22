// Observable Cardmarket sign-in state for the overlay.
//
// Lugin has no account of its own — it needs an active Cardmarket session in this
// browser. Guest pages often link to Account in the header, and stale tokens can
// linger in memory after logout — so we check for the login form first, then
// strong signed-in markers, then a signed-in-only token borrow.

import { looksLikeLoginPage, looksSignedIn } from '@/sites/cardmarket/wants';

import { clearCachedTokens, cmToken } from './session';

export interface SessionState {
  /** `null` until the first check finishes. */
  signedIn: boolean | null;
}

let state: SessionState = { signedIn: null };
const listeners = new Set<() => void>();
let initDone = false;

const set = (partial: Partial<SessionState>) => {
  state = { ...state, ...partial };
  for (const l of listeners) l();
};

const markSignedOut = (): false => {
  clearCachedTokens();
  set({ signedIn: false });
  return false;
};

export const sessionStore = {
  getSnapshot(): SessionState {
    return state;
  },

  /** Re-check session. Returns the new value. */
  async refresh(): Promise<boolean> {
    const html = document.documentElement.outerHTML;

    if (looksLikeLoginPage(html)) return markSignedOut();

    if (looksSignedIn(html)) {
      set({ signedIn: true });
      return true;
    }

    // Product/search pages often lack account nav — borrow from a signed-in page.
    // Clear cached tokens first so a stale write token from before logout can't
    // read as signed in.
    clearCachedTokens();
    const token = await cmToken();
    if (!token) return markSignedOut();

    set({ signedIn: true });
    return true;
  },

  /** Once per page load — refresh on focus in case the user just logged in. */
  init(): void {
    if (initDone) return;
    initDone = true;
    void sessionStore.refresh();
    window.addEventListener('focus', () => void sessionStore.refresh());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void sessionStore.refresh();
    });
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
