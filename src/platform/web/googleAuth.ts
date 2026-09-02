// Getting a Google access token from an ordinary web page.
//
// The extension's counterpart (src/background/googleAuth.ts) drives the OAuth
// dance by hand through `chrome.identity.launchWebAuthFlow`, because a service
// worker has no window to put a popup in. A page does, so this uses Google
// Identity Services instead: Google owns the popup, and the only thing it has to
// recognise is the page's *origin* — no redirect URI, and so nothing tied to an
// extension id.
//
// The token is the same kind of token as the extension's: app-data sync plus
// `drive.file` for the visible Scanner Corpus folder. Only the way it's obtained
// differs — the seam `TokenProvider` exists to hide.
//
// Deliberately no silent renewal. A token request without a user gesture opens a
// popup the browser is entitled to block, and a phone that silently "fails to
// sync" is worse than one asking to be tapped. An hour-old token surfaces as the
// connect button coming back.

import { AuthError, type TokenProvider, type TokenRequest } from '@/core/sync/auth';
import { DRIVE_APPDATA_SCOPE, DRIVE_SCOPES } from '@/core/sync/scopes';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

/** @deprecated Prefer DRIVE_SCOPES — re-exported for older call sites. */
export { DRIVE_APPDATA_SCOPE };

/** Set at build time; see .env.example. Shared with the extension build. */
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';

/** Renew a little early: a token that expires mid-request reads as a failure. */
const EXPIRY_MARGIN_MS = 60_000;

const SESSION_KEY = 'lugin:webToken';

interface CachedToken {
  expiresAt: number;
  token: string;
}

// --- the bit of Google Identity Services we use ------------------------------
// Typed by hand rather than pulling in @types/google.accounts: three members,
// against a script loaded at runtime.

interface TokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
  expires_in?: number | string;
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}

interface GoogleOAuth2 {
  initTokenClient(config: {
    callback: (response: TokenResponse) => void;
    client_id: string;
    error_callback?: (error: { type?: string }) => void;
    scope: string;
  }): TokenClient;
  revoke(token: string, done?: () => void): void;
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } };
  }
}

let loading: Promise<GoogleOAuth2> | null = null;

const loadGis = (): Promise<GoogleOAuth2> => {
  const ready = window.google?.accounts?.oauth2;
  if (ready) return Promise.resolve(ready);

  loading ??= new Promise<GoogleOAuth2>((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.onerror = () => {
      loading = null;
      reject(new AuthError('refused', 'Google’s sign-in script could not be loaded'));
    };
    script.onload = () => {
      const oauth2 = window.google?.accounts?.oauth2;
      if (oauth2) resolve(oauth2);
      else reject(new AuthError('refused', 'Google’s sign-in script loaded but exposed nothing'));
    };
    script.src = GIS_SRC;
    document.head.append(script);
  });
  return loading;
};

// --- token cache -------------------------------------------------------------
// Session storage, not local: a token outliving the tab it was granted in buys
// nothing, since it expires within the hour anyway.

let cached: CachedToken | null = null;

const fresh = (token: CachedToken | null): CachedToken | null =>
  token && token.expiresAt > Date.now() + EXPIRY_MARGIN_MS ? token : null;

const loadCached = (): CachedToken | null => {
  if (fresh(cached)) return cached;
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    cached = fresh(stored ? (JSON.parse(stored) as CachedToken) : null);
  } catch {
    // Private-mode or a corrupted entry: treat as "not signed in".
    cached = null;
  }
  return cached;
};

const remember = (token: CachedToken): void => {
  cached = token;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(token));
  } catch {
    // In-memory only is a perfectly good fallback.
  }
};

const forget = (): void => {
  cached = null;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing to clean up.
  }
};

/**
 * One flow at a time.
 *
 * The token client takes its callback once, at construction, so the pending
 * promise lives out here. Two overlapping requests would have the second stomp
 * the first's resolver; the guard makes the second wait on the same flow.
 */
let inFlight: Promise<CachedToken> | null = null;

const runFlow = (): Promise<CachedToken> => {
  if (!CLIENT_ID) {
    return Promise.reject(
      new AuthError('not-configured', 'This build has no Google client id — see .env.example'),
    );
  }
  inFlight ??= (async () => {
    const oauth2 = await loadGis();
    return new Promise<CachedToken>((resolve, reject) => {
      const client = oauth2.initTokenClient({
        callback: response => {
          if (response.error === 'access_denied') {
            reject(new AuthError('refused', 'Google access was declined'));
            return;
          }
          if (response.error || !response.access_token) {
            reject(
              new AuthError('refused', response.error_description ?? 'Google sent no token'),
            );
            return;
          }
          const seconds = Number(response.expires_in);
          const token = {
            expiresAt: Date.now() + (Number.isFinite(seconds) ? seconds : 3600) * 1000,
            token: response.access_token,
          };
          remember(token);
          resolve(token);
        },
        client_id: CLIENT_ID,
        // Fires for a closed popup or one the browser refused to open at all.
        error_callback: error => {
          reject(
            error.type === 'popup_failed_to_open'
              ? new AuthError('refused', 'The sign-in window was blocked — allow popups for this site')
              : new AuthError('cancelled', 'The Google window was closed before finishing'),
          );
        },
        scope: DRIVE_SCOPES,
      });
      // Empty prompt reuses an existing grant without asking again, so returning
      // users get a window that opens and closes rather than a consent screen.
      client.requestAccessToken({ prompt: '' });
    });
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
};

export const webGoogleAuth: TokenProvider & {
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
} = {
  /** Must be called from a real user gesture, or the popup will be blocked. */
  async connect(): Promise<boolean> {
    await runFlow();
    return true;
  },

  /**
   * Hand the token back to Google and forget it. Their Drive data is untouched:
   * disconnecting is not deleting, and this app never writes anything anyway.
   */
  async disconnect(): Promise<void> {
    const token = loadCached();
    if (token) {
      const oauth2 = await loadGis().catch(() => null);
      oauth2?.revoke(token.token);
    }
    forget();
  },

  async getToken(request: TokenRequest = {}): Promise<string> {
    if (request.refresh) forget();
    else {
      const token = loadCached();
      if (token) return token.token;
    }
    // Anything else needs a popup, and a popup needs a tap.
    if (!request.interactive) {
      throw new AuthError('no-session', 'Google sign-in has expired on this device');
    }
    return (await runFlow()).token;
  },

  isConnected(): boolean {
    return loadCached() !== null;
  },
};
