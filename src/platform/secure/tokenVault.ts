// Google token bytes, with no opinion about where they are kept.
//
// The phone uses the platform keystore. Tests use a Map. A plaintext file is
// only read once, and only deleted after the secure copy reads back the same.

export interface SecretStore {
  delete(key: string): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export interface LegacyTokenFile {
  read(): Promise<string | null>;
  remove(): Promise<void>;
}

export interface StoredToken {
  accessToken: string;
  expiresAt: number;
  refreshToken: string | null;
}

export const TOKEN_KEYS = {
  access: 'lugin.google.access',
  expires: 'lugin.google.expires',
  pkce: 'lugin.google.pkce',
  refresh: 'lugin.google.refresh',
} as const;

const parseToken = (raw: string): StoredToken | null => {
  try {
    const json = JSON.parse(raw) as Partial<StoredToken>;
    if (typeof json.accessToken !== 'string' || json.accessToken === '') return null;
    if (typeof json.expiresAt !== 'number' || !Number.isFinite(json.expiresAt)) return null;
    return {
      accessToken: json.accessToken,
      expiresAt: json.expiresAt,
      refreshToken: typeof json.refreshToken === 'string' ? json.refreshToken : null,
    };
  } catch {
    return null;
  }
};

export const readSecureToken = async (store: SecretStore): Promise<StoredToken | null> => {
  const accessToken = await store.get(TOKEN_KEYS.access);
  const expiresRaw = await store.get(TOKEN_KEYS.expires);
  if (!accessToken || !expiresRaw) return null;
  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt)) return null;
  const refreshToken = await store.get(TOKEN_KEYS.refresh);
  return { accessToken, expiresAt, refreshToken };
};

/** Write, then read back. Throws without clearing a caller-supplied legacy file. */
export const writeSecureToken = async (store: SecretStore, token: StoredToken | null): Promise<void> => {
  if (!token) {
    await store.delete(TOKEN_KEYS.access);
    await store.delete(TOKEN_KEYS.expires);
    await store.delete(TOKEN_KEYS.refresh);
    return;
  }
  await store.set(TOKEN_KEYS.access, token.accessToken);
  await store.set(TOKEN_KEYS.expires, String(token.expiresAt));
  if (token.refreshToken) await store.set(TOKEN_KEYS.refresh, token.refreshToken);
  else await store.delete(TOKEN_KEYS.refresh);
  const back = await readSecureToken(store);
  if (
    !back ||
    back.accessToken !== token.accessToken ||
    back.expiresAt !== token.expiresAt ||
    back.refreshToken !== token.refreshToken
  ) {
    throw new Error('Secure token write did not stick');
  }
};

/**
 * Move a plaintext token into the secret store.
 * The file is deleted only after the secure copy matches.
 */
export const migrateLegacyToken = async (
  store: SecretStore,
  legacy: LegacyTokenFile,
): Promise<StoredToken | null> => {
  const current = await readSecureToken(store);
  if (current) {
    if (await legacy.read()) await legacy.remove();
    return current;
  }
  const raw = await legacy.read();
  if (!raw) return null;
  const parsed = parseToken(raw);
  if (!parsed) return null;
  await writeSecureToken(store, parsed);
  await legacy.remove();
  return parsed;
};
