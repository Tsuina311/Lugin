#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_PORT, pairingUrl, pairingUrlAlt } from './scan-inbox/lib.mjs';
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

const session = await readReceiverSession(inboxRoot);
const port = envPort || session?.port || DEFAULT_PORT;
const token = envToken || session?.token || '';
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
  fail(
    [
      `Receiver is up at ${localUrl} but the session token is unknown.`,
      'Restart yarn scan:inbox (it writes .scan-inbox/.receiver.json) or set SCAN_INBOX_TOKEN.',
    ].join('\n'),
  );
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

console.log('');
console.log('Lugin Scan Inbox Tunnel');
console.log(`Local: ${localUrl}`);
console.log('Starting temporary Cloudflare quick tunnel…');
console.log('Do not bookmark or commit the HTTPS URL. Ctrl+C stops the tunnel.');
console.log('The inbox receiver keeps running in its own terminal.');
console.log('');

const child = spawn(
  cloudflared,
  ['tunnel', '--url', localUrl, '--no-autoupdate'],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

let httpsUrl = null;
let announced = false;
let stopping = false;

const announce = async (url) => {
  if (announced) return;
  announced = true;
  httpsUrl = url;
  const pair = pairingUrl(url, token);
  const pairAlt = pairingUrlAlt(url, token);
  console.log(`HTTPS: ${url}`);
  console.log(`Token: ${token}`);
  console.log('');
  console.log(`Pair: ${pair}`);
  console.log(`Pair (app scheme): ${pairAlt}`);
  console.log('');
  console.log('Paste the Pair line (or HTTPS URL + token) into phone Settings → Debug receiver.');
  console.log('Bearer auth is still required. Anyone with only the URL cannot upload.');
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

const onChunk = (buf) => {
  const text = buf.toString('utf8');
  const found = extractTunnelHttpsUrl(text);
  if (found) void announce(found);
};

child.stdout.on('data', onChunk);
child.stderr.on('data', onChunk);

child.on('error', err => {
  fail(`Failed to start cloudflared: ${err instanceof Error ? err.message : String(err)}`);
});

child.on('exit', (code, signal) => {
  if (stopping) return;
  if (!httpsUrl) {
    fail(`cloudflared exited before publishing an HTTPS URL (code ${code ?? signal ?? '?'})`);
  }
  process.exit(code ?? 0);
});

const stop = () => {
  if (stopping) return;
  stopping = true;
  console.log('');
  console.log('Stopping tunnel. Inbox receiver is still running (yarn scan:inbox).');
  child.kill('SIGTERM');
  setTimeout(() => {
    if (!child.killed) child.kill('SIGKILL');
    process.exit(0);
  }, 1500).unref();
};

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
