// Getting a Google access token from inside the extension, and nothing else.
//
// This has to live in the service worker: `chrome.identity` doesn't exist in a
// content script. It asks for exactly one scope — `drive.appdata`, a private
// folder only this extension can read — so the consent screen the user sees
// says "see, edit, create and delete its own configuration data", not anything
// about their files, mail or account.
//
// Why the implicit flow rather than code + PKCE, which is otherwise the modern
// answer: `launchWebAuthFlow` needs a "Web application" client (Google's
// "Chrome Extension" client type only works with `getAuthToken`), and Google
// treats web clients as confidential — the token endpoint wants a client secret
// we have nowhere safe to keep. Shipping a secret in an extension is worse than
// not having a refresh token, so we take an hour-long token and renew it
// silently. `prompt=none` succeeds without any UI while the user is signed into
// Google and the grant stands, which is the ordinary case.

import { AuthError, type TokenProvider, type TokenRequest } from '@/core/sync/auth';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/** The narrowest scope that gives us somewhere to put the user's data. */
export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

/** Set at build time; see .env.example. */
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';

/** Whether the user has connected, across worker restarts. No token in here. */
const CONNECTED_KEY = 'lugin:googleConnected';

/** Renew a little early: a token that expires mid-request reads as a failure. */
const EXPIRY_MARGIN_MS = 60_000;

interface CachedToken {
  expiresAt: number;
  token: string;
}

// Kept in memory and in session storage: the worker is torn down constantly, and
// re-running the flow on every wake would be slow. Session storage is cleared
// when the browser closes and is not readable by content scripts.
let cached: CachedToken | null = null;

const SESSION_KEY = 'lugin:googleToken';

const loadCached = async (): Promise<CachedToken | null> => {
  if (cached && cached.expiresAt > Date.now() + EXPIRY_MARGIN_MS) return cached;
  const stored = await chrome.storage.session.get(SESSION_KEY);
  const found = stored[SESSION_KEY] as CachedToken | undefined;
  cached = found && found.expiresAt > Date.now() + EXPIRY_MARGIN_MS ? found : null;
  return cached;
};

const remember = async (token: CachedToken): Promise<void> => {
  cached = token;
  await chrome.storage.session.set({ [SESSION_KEY]: token });
};

const forget = async (): Promise<void> => {
  cached = null;
  await chrome.storage.session.remove(SESSION_KEY);
};

/**
 * The exact string Google must have on file as an authorised redirect URI.
 *
 * Chrome never actually loads it — it recognises the navigation and hands the
 * URL back to us — but Google matches it character for character, so it's built
 * the same way here as it's pasted into the console.
 */
export const redirectUri = (): string => `https://${chrome.runtime.id}.chromiumapp.org/`;

const authUrl = (interactive: boolean, state: string): string => {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    // Ask for the scope again on every renewal; Google returns the grant it
    // already has rather than prompting.
    include_granted_scopes: 'false',
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: DRIVE_APPDATA_SCOPE,
    state,
    // Silent renewal must never open a window; the first connection must.
    ...(interactive ? { prompt: 'consent' } : { prompt: 'none' }),
  });
  return `${AUTH_ENDPOINT}?${params}`;
};

/** Google answers in the fragment: #access_token=...&expires_in=3599&state=... */
const parseRedirect = (url: string, expectedState: string): CachedToken => {
  const hash = new URL(url).hash.replace(/^#/, '');
  const params = new URLSearchParams(hash);

  const error = params.get('error');
  if (error === 'access_denied') throw new AuthError('refused', 'Google access was declined');
  if (error === 'login_required' || error === 'interaction_required' || error === 'consent_required') {
    throw new AuthError('no-session', 'Google needs you to sign in again');
  }
  if (error) throw new AuthError('refused', `Google refused: ${error}`);

  // Checked before the token is touched: a redirect we didn't start is a
  // redirect we don't trust.
  if (params.get('state') !== expectedState) {
    throw new AuthError('refused', 'The reply from Google didn’t match the request');
  }

  const token = params.get('access_token');
  if (!token) throw new AuthError('refused', 'Google sent no token');
  const seconds = Number(params.get('expires_in'));
  return {
    expiresAt: Date.now() + (Number.isFinite(seconds) ? seconds : 3600) * 1000,
    token,
  };
};

const runFlow = async (interactive: boolean): Promise<CachedToken> => {
  if (!CLIENT_ID) {
    throw new AuthError(
      'not-configured',
      'This build has no Google client id — see .env.example',
    );
  }
  const state = crypto.randomUUID();

  let redirect: string | undefined;
  try {
    redirect = await chrome.identity.launchWebAuthFlow({ interactive, url: authUrl(interactive, state) });
  } catch (err) {
    // Chrome reports a closed window and a silent flow that needed a person
    // through the same channel, so the distinction comes from what we asked for.
    const message = err instanceof Error ? err.message : String(err);
    throw interactive
      ? new AuthError('cancelled', 'The Google window was closed before finishing')
      : new AuthError('no-session', message);
  }
  if (!redirect) throw new AuthError('cancelled', 'Google didn’t complete the sign-in');

  const token = parseRedirect(redirect, state);
  await remember(token);
  await chrome.storage.local.set({ [CONNECTED_KEY]: true });
  return token;
};

export const googleAuth: TokenProvider & {
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  isConnected(): Promise<boolean>;
} = {
  /** Ask the user, once, and remember that they said yes. */
  async connect(): Promise<boolean> {
    await runFlow(true);
    return true;
  },

  /**
   * Hand the token back to Google and forget it. Their data stays in the app
   * folder — disconnecting is not deleting, and offering to delete it here
   * would be a different, much more alarming button.
   */
  async disconnect(): Promise<void> {
    const token = await loadCached();
    if (token) {
      try {
        await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(token.token)}`, { method: 'POST' });
      } catch {
        // Revocation is courtesy; the token expires within the hour regardless.
      }
    }
    await forget();
    await chrome.storage.local.set({ [CONNECTED_KEY]: false });
  },

  async getToken(request: TokenRequest = {}): Promise<string> {
    if (!request.refresh) {
      const token = await loadCached();
      if (token) return token.token;
    } else {
      await forget();
    }
    return (await runFlow(request.interactive === true)).token;
  },

  async isConnected(): Promise<boolean> {
    const stored = await chrome.storage.local.get(CONNECTED_KEY);
    return stored[CONNECTED_KEY] === true;
  },
};
