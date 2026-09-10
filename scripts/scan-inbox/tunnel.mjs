import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

export const extractTunnelHttpsUrl = (text) => {
  if (typeof text !== 'string' || !text) return null;
  const tryCf = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if (tryCf) return tryCf[0].replace(/[.,);]+$/, '');
  const named = text.match(/https:\/\/[a-z0-9.-]+\.cfargotunnel\.com/i);
  return named ? named[0].replace(/[.,);]+$/, '') : null;
};

export const findCloudflared = () => {
  try {
    const which = execFileSync('which', ['cloudflared'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (which && existsSync(which)) return which;
  } catch {
    /* not on PATH */
  }
  for (const candidate of ['/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared']) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
};

export const cloudflaredInstallHelp = () =>
  [
    'cloudflared is not installed.',
    '',
    'This Mac can install it with Homebrew (not run automatically):',
    '',
    '  brew install cloudflared',
    '',
    'Or Cloudflare’s tap:',
    '',
    '  brew install cloudflare/cloudflare/cloudflared',
    '',
    'Docs: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/',
    '',
    'Then, in two terminals:',
    '',
    '  yarn scan:inbox',
    '  yarn scan:inbox:tunnel',
  ].join('\n');

export const probeReceiverHealth = async (baseUrl, token, { timeoutMs = 2500 } = {}) => {
  const url = `${String(baseUrl).replace(/\/+$/, '')}/health`;
  try {
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return {
      json,
      ok: res.status === 200 && json?.ok === true,
      reachable: true,
      status: res.status,
    };
  } catch (err) {
    return {
      json: null,
      ok: false,
      reachable: false,
      reason: err instanceof Error ? err.message : String(err),
      status: 0,
    };
  }
};

export const waitForHttpsHealth = async (httpsUrl, token, { attempts = 12, delayMs = 1000 } = {}) => {
  let last = null;
  for (let i = 0; i < attempts; i += 1) {
    last = await probeReceiverHealth(httpsUrl, token, { timeoutMs: 5000 });
    if (last.ok) return last;
    if (last.status === 401) return last;
    await new Promise(r => setTimeout(r, delayMs));
  }
  return last ?? { ok: false, reachable: false, status: 0 };
};
