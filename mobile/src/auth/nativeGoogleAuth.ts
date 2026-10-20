// Google Drive token for the native app.
//
// Android OAuth client only. The redirect is the reversed client id, which is
// the URI Google issues after custom URI schemes are enabled. No client secret.
// Tokens live in the platform keystore. A leftover plaintext file is copied
// across and deleted only after that copy reads back.

import Constants from 'expo-constants';
import { Linking } from 'react-native';

import { AuthError, type TokenProvider, type TokenRequest } from '@/core/sync/auth';
import { DRIVE_SCOPES } from '@/core/sync/scopes';
import { base64Url, sha256 } from '@/lib/sha256';
import { googleAndroidRedirect } from '@/platform/google/androidRedirect';
import {
  TOKEN_KEYS,
  migrateLegacyToken,
  writeSecureToken,
  type SecretStore,
  type StoredToken,
} from '@/platform/secure/tokenVault';

const EXPIRY_MARGIN_MS = 60_000;
const LEGACY_NAME = 'google-token.json';

const clientId = (): string => {
  const extra = Constants.expoConfig?.extra as { lugin?: { googleClientId?: string } } | undefined;
  return extra?.lugin?.googleClientId?.trim() ?? '';
};

const redirectUri = (): string | null => googleAndroidRedirect(clientId())?.redirectUri ?? null;

const randomVerifier = (): string => {
  const bytes = new Uint8Array(32);
  const cryptoRef = globalThis.crypto;
  if (cryptoRef?.getRandomValues) cryptoRef.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return base64Url(bytes);
};

const fresh = (token: StoredToken | null): StoredToken | null =>
  token && token.expiresAt > Date.now() + EXPIRY_MARGIN_MS ? token : null;

const secureStore = async (): Promise<SecretStore> => {
  const SecureStore = await import('expo-secure-store');
  return {
    delete: key => SecureStore.deleteItemAsync(key),
    get: key => SecureStore.getItemAsync(key),
    set: (key, value) => SecureStore.setItemAsync(key, value),
  };
};

const legacyFile = async () => {
  const FileSystem = await import('expo-file-system/legacy');
  const root = FileSystem.documentDirectory;
  const path = root ? `${root}lugin-library/${LEGACY_NAME}` : null;
  return {
    async read(): Promise<string | null> {
      if (!path) return null;
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) return null;
      return FileSystem.readAsStringAsync(path);
    },
    async remove(): Promise<void> {
      if (!path) return;
      const info = await FileSystem.getInfoAsync(path);
      if (info.exists) await FileSystem.deleteAsync(path, { idempotent: true });
    },
  };
};

let cached: StoredToken | null = null;
let loaded = false;
let pending: { state: string; verifier: string } | null = null;
let pendingWait: {
  reject: (error: Error) => void;
  resolve: () => void;
} | null = null;

const load = async (): Promise<StoredToken | null> => {
  if (loaded && fresh(cached)) return cached;
  const store = await secureStore();
  const token = await migrateLegacyToken(store, await legacyFile());
  cached = token;
  loaded = true;
  return token;
};

const persist = async (token: StoredToken | null): Promise<void> => {
  cached = token;
  loaded = true;
  await writeSecureToken(await secureStore(), token);
};

const savePkce = async (value: { state: string; verifier: string } | null): Promise<void> => {
  pending = value;
  const store = await secureStore();
  if (!value) {
    await store.delete(TOKEN_KEYS.pkce);
    return;
  }
  await store.set(TOKEN_KEYS.pkce, JSON.stringify(value));
};

const loadPkce = async (): Promise<{ state: string; verifier: string } | null> => {
  if (pending) return pending;
  const raw = await (await secureStore()).get(TOKEN_KEYS.pkce);
  if (!raw) return null;
  try {
    const json = JSON.parse(raw) as { state?: string; verifier?: string };
    if (typeof json.state !== 'string' || typeof json.verifier !== 'string') return null;
    pending = { state: json.state, verifier: json.verifier };
    return pending;
  } catch {
    return null;
  }
};

const queryOf = (url: string): URLSearchParams => {
  const query = url.indexOf('?');
  if (query < 0) return new URLSearchParams();
  return new URLSearchParams(url.slice(query + 1).split('#')[0]);
};

const isOauthReturn = (url: string): boolean => {
  const redirect = redirectUri();
  if (!redirect) return false;
  return url === redirect || url.startsWith(`${redirect}?`) || url.startsWith(`${redirect}#`);
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
    if (!isOauthReturn(url)) return;
    const current = (await loadPkce()) ?? null;
    const wait = pendingWait;
    if (!current) return;
    const params = queryOf(url);
    const error = params.get('error');
    if (error) {
      await savePkce(null);
      pendingWait = null;
      wait?.reject(new AuthError(error === 'access_denied' ? 'cancelled' : 'refused', error));
      return;
    }
    if (params.get('state') !== current.state) {
      await savePkce(null);
      pendingWait = null;
      wait?.reject(new AuthError('refused', 'Sign-in returned an unexpected state'));
      return;
    }
    const code = params.get('code');
    if (!code) return;
    const redirect = redirectUri();
    if (!redirect) return;
    await savePkce(null);
    pendingWait = null;
    try {
      const token = await exchange(
        new URLSearchParams({
          client_id: clientId(),
          code,
          code_verifier: current.verifier,
          grant_type: 'authorization_code',
          redirect_uri: redirect,
        }),
      );
      await persist(token);
      wait?.resolve();
    } catch (err) {
      wait?.reject(err instanceof Error ? err : new AuthError('refused', 'Sign-in failed'));
    }
  },

  configured: () => googleAndroidRedirect(clientId()) !== null,

  connect: async () => {
    const id = clientId();
    const redirect = redirectUri();
    if (!id || !redirect) throw new AuthError('not-configured', 'This build has no Android Google client id');
    const verifier = randomVerifier();
    const challenge = base64Url(sha256(verifier));
    const state = randomVerifier();
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('client_id', id);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('redirect_uri', redirect);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', DRIVE_SCOPES);
    url.searchParams.set('state', state);
    await savePkce({ state, verifier });
    const done = new Promise<void>((resolve, reject) => {
      pendingWait = { reject, resolve };
    });
    await Linking.openURL(url.toString());
    await done;
  },

  disconnect: async () => {
    pendingWait = null;
    await savePkce(null);
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
