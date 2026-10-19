// Google Drive token for the native app.
//
// The system browser and the `lugin` scheme. No client secret. The web OAuth
// client must list `lugin://oauth` as a redirect, which Google sometimes
// refuses for a Web client — local cards do not wait on that.

import Constants from 'expo-constants';
import { Linking } from 'react-native';

import { AuthError, type TokenProvider, type TokenRequest } from '@/core/sync/auth';
import { DRIVE_SCOPES } from '@/core/sync/scopes';
import { base64Url, sha256 } from '@/lib/sha256';


export const NATIVE_REDIRECT = 'lugin://oauth';

interface StoredToken {
  accessToken: string;
  expiresAt: number;
  refreshToken: string | null;
}

const EXPIRY_MARGIN_MS = 60_000;

const clientId = (): string => {
  const extra = Constants.expoConfig?.extra as { lugin?: { googleClientId?: string } } | undefined;
  return extra?.lugin?.googleClientId?.trim() ?? '';
};

const randomVerifier = (): string => {
  const bytes = new Uint8Array(32);
  const cryptoRef = globalThis.crypto;
  if (cryptoRef?.getRandomValues) cryptoRef.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return base64Url(bytes);
};

let cached: StoredToken | null = null;
let pending: {
  reject: (error: Error) => void;
  resolve: () => void;
  state: string;
  verifier: string;
} | null = null;

const fresh = (token: StoredToken | null): StoredToken | null =>
  token && token.expiresAt > Date.now() + EXPIRY_MARGIN_MS ? token : null;

const persist = async (token: StoredToken | null): Promise<void> => {
  cached = token;
  try {
    const FileSystem = await import('expo-file-system/legacy');
    const root = FileSystem.documentDirectory;
    if (!root) return;
    const dir = `${root}lugin-library/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    const path = `${dir}google-token.json`;
    if (!token) {
      const info = await FileSystem.getInfoAsync(path);
      if (info.exists) await FileSystem.deleteAsync(path, { idempotent: true });
      return;
    }
    await FileSystem.writeAsStringAsync(path, JSON.stringify(token));
  } catch {
    // The memory copy still serves this session.
  }
};

const load = async (): Promise<StoredToken | null> => {
  if (fresh(cached)) return cached;
  try {
    const FileSystem = await import('expo-file-system/legacy');
    const root = FileSystem.documentDirectory;
    if (!root) return fresh(cached);
    const path = `${root}lugin-library/google-token.json`;
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    cached = JSON.parse(await FileSystem.readAsStringAsync(path)) as StoredToken;
    return cached;
  } catch {
    return null;
  }
};

const exchange = async (body: URLSearchParams): Promise<StoredToken> => {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    body: body.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  });
  const payload = (await response.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
    expires_in?: number;
    refresh_token?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new AuthError('refused', payload.error_description || payload.error || 'Google refused the sign-in');
  }
  return {
    accessToken: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    refreshToken: payload.refresh_token ?? cached?.refreshToken ?? null,
  };
};

const refresh = async (token: StoredToken): Promise<StoredToken | null> => {
  if (!token.refreshToken) return null;
  const id = clientId();
  if (!id) return null;
  const next = await exchange(
    new URLSearchParams({
      client_id: id,
      grant_type: 'refresh_token',
      refresh_token: token.refreshToken,
    }),
  );
  await persist(next);
  return next;
};

export const nativeGoogleAuth: TokenProvider & {
  completeUrl: (url: string) => Promise<void>;
  configured: () => boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  isConnected: () => boolean;
} = {
  completeUrl: async url => {
    if (!pending) return;
    const current = pending;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (parsed.protocol !== 'lugin:' || parsed.hostname !== 'oauth') return;
    const error = parsed.searchParams.get('error');
    if (error) {
      pending = null;
      current.reject(new AuthError(error === 'access_denied' ? 'cancelled' : 'refused', error));
      return;
    }
    if (parsed.searchParams.get('state') !== current.state) {
      pending = null;
      current.reject(new AuthError('refused', 'Sign-in returned an unexpected state'));
      return;
    }
    const code = parsed.searchParams.get('code');
    if (!code) return;
    pending = null;
    try {
      const token = await exchange(
        new URLSearchParams({
          client_id: clientId(),
          code,
          code_verifier: current.verifier,
          grant_type: 'authorization_code',
          redirect_uri: NATIVE_REDIRECT,
        }),
      );
      await persist(token);
      current.resolve();
    } catch (err) {
      current.reject(err instanceof Error ? err : new AuthError('refused', 'Sign-in failed'));
    }
  },

  configured: () => clientId() !== '',

  connect: async () => {
    const id = clientId();
    if (!id) throw new AuthError('not-configured', 'This build has no Google client id');
    const verifier = randomVerifier();
    const challenge = base64Url(sha256(verifier));
    const state = randomVerifier();
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('client_id', id);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('redirect_uri', NATIVE_REDIRECT);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', DRIVE_SCOPES);
    url.searchParams.set('state', state);
    const done = new Promise<void>((resolve, reject) => {
      pending = { reject, resolve, state, verifier };
    });
    await Linking.openURL(url.toString());
    await done;
  },

  disconnect: async () => {
    pending = null;
    await persist(null);
  },

  getToken: async (request?: TokenRequest) => {
    if (request?.interactive) await nativeGoogleAuth.connect();
    let token = await load();
    if (request?.refresh) token = token ? await refresh(token) : null;
    token = fresh(token) ?? (token ? await refresh(token) : null);
    if (!token) throw new AuthError('no-session', 'Sign in to Google to sync');
    if (!fresh(token)) {
      await persist(null);
      throw new AuthError('no-session', 'Sign in to Google to sync');
    }
    return token.accessToken;
  },

  isConnected: () => fresh(cached) !== null || cached?.refreshToken != null,
};
