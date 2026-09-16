#!/usr/bin/env node
/**
 * yarn scan:inbox:tunnel
 *
 * Supervises cloudflared Quick Tunnel in front of yarn scan:inbox.
 * - Persists inbox token/name in .scan-inbox/config.json (not regenerated on restart)
 * - On process exit / network blip: exponential backoff restart
 * - New Quick Tunnel URL is written to .scan-inbox/tunnel.json + Pair line reprinted
 * - Phone only needs to paste the new Pair line (token/name retained on device)
 *
 * Named Cloudflare Tunnel (stable hostname): see docs/SCAN-DEBUG-INBOX.md
 *   SCAN_INBOX_NAMED_TUNNEL=1 cloudflared tunnel run <name>
 * is documented separately — not required for development.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_PORT, pairingUrl, pairingUrlAlt } from './scan-inbox/lib.mjs';
import { ensureInboxConfig, writeTunnelState, tunnelRestartBackoffMs } from './scan-inbox/inbox-config.mjs';
import { readReceiverSession } from './scan-inbox/session-file.mjs';
import {
  cloudflaredInstallHelp,
  extractTunnelHttpsUrl,
  findCloudflared,
  probeReceiverHealth,
  waitForHttpsHealth,
} from './scan-inbox/tunnel.mjs';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const inboxRoot = process.env.SCAN_INBOX_ROOT || join(rootDir, '.scan-inbox');
const envPort = Number(process.env.SCAN_INBOX_PORT || 0);
const envToken = process.env.SCAN_INBOX_TOKEN || '';
const namedMode = process.env.SCAN_INBOX_NAMED_TUNNEL === '1';

const session = await readReceiverSession(inboxRoot);
const config = await ensureInboxConfig(inboxRoot, {
  token: envToken || session?.token || undefined,
});
const port = envPort || session?.port || DEFAULT_PORT;
const token = envToken || session?.token || config.token;
const localUrl = `http://127.0.0.1:${port}`;

const fail = (message, code = 1) => {
  console.error(message);
  process.exit(code);
};

const unauth = await probeReceiverHealth(localUrl, '');
if (!unauth.reachable) {
  fail(
    [
      `Inbox receiver is not reachable at ${localUrl}`,
      '',
      'Start it first and leave that terminal running:',
      '',
      '  yarn scan:inbox',
      '',
    ].join('\n'),
  );
}

if (!token) {
  fail(`No inbox token. Restart yarn scan:inbox or set SCAN_INBOX_TOKEN.`);
}

const authed = await probeReceiverHealth(localUrl, token);
if (!authed.ok) {
  fail(
    `Local health check failed (${authed.status || authed.reason || 'unknown'}). Is the token from the current yarn scan:inbox process?`,
  );
}

const cloudflared = findCloudflared();
if (!cloudflared) {
  fail(cloudflaredInstallHelp());
}

if (namedMode) {
  console.log('');
  console.log('Named tunnel mode (SCAN_INBOX_NAMED_TUNNEL=1)');
  console.log('Configure a stable Cloudflare Tunnel hostname separately, then point');
  console.log('the phone at that HTTPS URL with the same bearer token from config.json.');
  console.log(`Config: ${config.path}`);
  console.log('See docs/SCAN-DEBUG-INBOX.md § Named Tunnel.');
  console.log('');
  process.exit(0);
}

console.log('');
console.log('Lugin Scan Inbox Tunnel (Quick Tunnel supervisor)');
console.log(`Local: ${localUrl}`);
console.log(`Inbox name: ${config.name}`);
console.log(`Token identity: persistent (.scan-inbox/config.json) — not regenerated on restart`);
console.log('VPN / network drops: process will retry with backoff; Pair line updates if URL changes.');
console.log('Ctrl+C stops the tunnel supervisor. Inbox receiver keeps running.');
console.log('');

let stopping = false;
let attempt = 0;
let child = null;

const announce = async (url) => {
  const pair = pairingUrl(url, token);
  const pairAlt = pairingUrlAlt(url, token);
  await writeTunnelState(inboxRoot, {
    url,
    status: 'up',
    pid: child?.pid ?? null,
    startedAt: new Date().toISOString(),
    lastFailure: null,
    inboxName: config.name,
    tokenRef: 'config.json',
    mode: 'quick-tunnel',
  });
  console.log('');
  console.log(`HTTPS: ${url}`);
  console.log('(Token omitted from permanent logs — use Pair line once)');
  console.log('');
  console.log(`Pair: ${pair}`);
  console.log(`Pair (app scheme): ${pairAlt}`);
  console.log('');
  console.log('Phone: paste Pair line → updates endpoint URL; keeps saved token/name.');
  console.log('If only the URL changed, you can also paste the bare HTTPS URL.');
  console.log('');
  process.stdout.write('HTTPS health: checking…\n');
  const health = await waitForHttpsHealth(url, token);
  if (health.ok) {
    console.log(
      `HTTPS health: Connected (receiver v${health.json?.version ?? '?'}${health.json?.serverTime ? ` · ${health.json.serverTime}` : ''})`,
    );
  } else if (health.status === 401) {
    console.log('HTTPS health: reachable but unauthorized — token mismatch.');
  } else {
    console.log(
      `HTTPS health: not ready yet (${health.status || health.reason || 'timeout'}). Try Test connection on the phone.`,
    );
  }
  console.log('');
};

const spawnTunnel = () =>
  new Promise((resolve) => {
    let httpsUrl = null;
    let announced = false;
    const proc = spawn(
      cloudflared,
      ['tunnel', '--url', localUrl, '--no-autoupdate'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    child = proc;

    const onChunk = (buf) => {
      const text = buf.toString('utf8');
      const found = extractTunnelHttpsUrl(text);
      if (found && !announced) {
        announced = true;
        httpsUrl = found;
        attempt = 0;
        void announce(found);
      }
    };

    proc.stdout.on('data', onChunk);
    proc.stderr.on('data', onChunk);

    proc.on('error', async (err) => {
      await writeTunnelState(inboxRoot, {
        url: httpsUrl,
        status: 'error',
        pid: null,
        lastFailure: err instanceof Error ? err.message : String(err),
        inboxName: config.name,
        tokenRef: 'config.json',
        mode: 'quick-tunnel',
      });
      resolve({ code: 1, httpsUrl });
    });

    proc.on('exit', async (code, signal) => {
      child = null;
      await writeTunnelState(inboxRoot, {
        url: httpsUrl,
        status: stopping ? 'stopped' : 'exited',
        pid: null,
        lastFailure: stopping ? null : `exit ${code ?? signal ?? '?'}`,
        inboxName: config.name,
        tokenRef: 'config.json',
        mode: 'quick-tunnel',
      });
      resolve({ code: code ?? 0, httpsUrl, signal });
    });
  });

const stop = () => {
  if (stopping) return;
  stopping = true;
  console.log('');
  console.log('Stopping tunnel supervisor. Inbox receiver is still running (yarn scan:inbox).');
  if (child) {
    child.kill('SIGTERM');
    setTimeout(() => {
      if (child && !child.killed) child.kill('SIGKILL');
      process.exit(0);
    }, 1500).unref();
  } else {
    process.exit(0);
  }
};

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

while (!stopping) {
  const result = await spawnTunnel();
  if (stopping) break;
  attempt += 1;
  const wait = tunnelRestartBackoffMs(attempt - 1);
  console.log('');
  console.log(
    `cloudflared exited (${result.code ?? result.signal ?? '?'}). Retry #${attempt} in ${Math.round(wait / 1000)}s…`,
  );
  console.log('Token/name unchanged. A new Quick Tunnel URL will need a fresh Pair paste on the phone.');
  console.log('');
  await new Promise(r => setTimeout(r, wait));
}
