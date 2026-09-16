import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

/** Persistent inbox identity — survives cloudflared Quick Tunnel restarts. */
export const inboxConfigPath = (root) => join(root, 'config.json');
export const tunnelStatePath = (root) => join(root, 'tunnel.json');

export const readInboxConfig = async (root) => {
  const path = inboxConfigPath(root);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    const token = typeof parsed.token === 'string' ? parsed.token : '';
    const name = typeof parsed.name === 'string' ? parsed.name : 'lugin-inbox';
    if (!token) return null;
    return { name, token, path };
  } catch {
    return null;
  }
};

/**
 * Load or create durable inbox credentials.
 * Never regenerates token unless forceNewToken or missing.
 */
export const ensureInboxConfig = async (root, opts = {}) => {
  await mkdir(root, { recursive: true });
  const existing = await readInboxConfig(root);
  if (existing && !opts.forceNewToken) return existing;
  const token = opts.forceNewToken
    ? randomBytes(24).toString('hex')
    : (typeof opts.token === 'string' && opts.token) ||
      existing?.token ||
      randomBytes(24).toString('hex');
  const name =
    (typeof opts.name === 'string' && opts.name) || existing?.name || 'lugin-inbox';
  const path = inboxConfigPath(root);
  await writeFile(
    path,
    `${JSON.stringify({ name, token, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    { mode: 0o600 },
  );
  return { name, token, path };
};

export const writeTunnelState = async (root, state) => {
  await mkdir(root, { recursive: true });
  const path = tunnelStatePath(root);
  await writeFile(path, `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`);
  return path;
};

export const readTunnelState = async (root) => {
  const path = tunnelStatePath(root);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
};

/** Next backoff ms: 2s, 4s, 8s, … capped; does not regenerate credentials. */
export const tunnelRestartBackoffMs = (attempt, { baseMs = 2000, maxMs = 60_000 } = {}) =>
  Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
