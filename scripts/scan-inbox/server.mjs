import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

import {
  DEFAULT_PORT,
  INBOX_VERSION,
  MAX_BUNDLE_BYTES,
  MAX_JSON_BYTES,
  latestPointer,
  pairingUrl,
  pairingUrlAlt,
  parseBearer,
  sampleCountFromFiles,
  sanitizeId,
  timingSafeEqualToken,
  validateUploadBody,
} from './lib.mjs';
import { nextQueuedJob, parseReplayJobBody, readJob, writeJob } from './replay-jobs.mjs';

export const lanIPv4 = () => {
  try {
    const nets = networkInterfaces();
    const preferred = [];
    for (const list of Object.values(nets)) {
      for (const n of list ?? []) {
        if (n.family !== 'IPv4' && n.family !== 4) continue;
        if (n.internal) continue;
        preferred.push(n.address);
      }
    }
    return preferred.find(a => a.startsWith('192.168.')) ?? preferred[0] ?? '127.0.0.1';
  } catch {
    return '127.0.0.1';
  }
};

const readBody = (req, limit) =>
  new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', reject);
  });

const send = (res, status, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
};

const writeAtomic = async (path, data) => {
  const tmp = `${path}.tmp-${randomBytes(4).toString('hex')}`;
  await writeFile(tmp, data);
  await rename(tmp, path);
};

const promoteTrace = async (root, parsed) => {
  const dest = join(root, 'sessions', parsed.sessionId, parsed.traceId);
  const marker = join(dest, '.complete');
  if (existsSync(marker)) {
    let wrote = 0;
    for (const [name, file] of Object.entries(parsed.files)) {
      await writeFile(join(dest, name), file.bytes);
      wrote += 1;
    }
    return { already: true, dest, merged: wrote > 0 };
  }
  const tmp = join(root, '.tmp', `${parsed.sessionId}-${parsed.traceId}-${randomBytes(4).toString('hex')}`);
  await mkdir(tmp, { recursive: true });
  try {
    for (const [name, file] of Object.entries(parsed.files)) {
      await writeFile(join(tmp, name), file.bytes);
    }
    await writeFile(
      join(tmp, 'meta.json'),
      JSON.stringify(
        {
          appStamp: parsed.appStamp,
          createdAt: parsed.createdAt,
          device: parsed.device,
          runtimeFingerprint: parsed.runtimeFingerprint,
          scannerPhase: parsed.scannerPhase,
          sessionId: parsed.sessionId,
          traceId: parsed.traceId,
          traceType: parsed.traceType,
        },
        null,
        2,
      ),
    );
    await mkdir(dirname(dest), { recursive: true });
    if (existsSync(dest)) await rm(dest, { recursive: true, force: true });
    await rename(tmp, dest);
    await writeFile(marker, `${parsed.createdAt}\n`);
    return { already: false, dest };
  } catch (err) {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
};

export const startInboxServer = async ({
  host = '0.0.0.0',
  port = DEFAULT_PORT,
  root,
  token = randomBytes(24).toString('hex'),
  onReceived,
} = {}) => {
  if (!root) throw new Error('root required');
  await mkdir(root, { recursive: true });
  await mkdir(join(root, 'sessions'), { recursive: true });
  await mkdir(join(root, '.tmp'), { recursive: true });

  const authorize = req => {
    const provided = parseBearer(req.headers.authorization);
    return timingSafeEqualToken(token, provided ?? '');
  };

  const server = createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Origin': '*',
      });
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        if (!authorize(req)) {
          send(res, 401, { ok: false, reason: 'unauthorized' });
          return;
        }
        send(res, 200, {
          label: process.env.SCAN_INBOX_LABEL || 'mac',
          ok: true,
          serverTime: new Date().toISOString(),
          version: INBOX_VERSION,
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/scans') {
        if (!authorize(req)) {
          send(res, 401, { ok: false, reason: 'unauthorized' });
          return;
        }
        const raw = await readBody(req, MAX_BUNDLE_BYTES);
        let json;
        try {
          json = JSON.parse(raw.toString('utf8'));
        } catch {
          send(res, 400, { ok: false, reason: 'invalid json' });
          return;
        }
        const parsed = validateUploadBody(json);
        if (!parsed.ok) {
          send(res, parsed.reason === 'bundle too large' ? 413 : 400, {
            ok: false,
            reason: parsed.reason,
          });
          return;
        }
        const sampleCount = sampleCountFromFiles(parsed.files);
        const { already, dest, merged } = await promoteTrace(root, parsed);
        const pointer = latestPointer(
          { ...parsed, sampleCount },
          `.scan-inbox/sessions/${parsed.sessionId}/${parsed.traceId}`,
        );
        await writeAtomic(join(root, 'latest.json'), `${JSON.stringify(pointer, null, 2)}\n`);
        onReceived?.({
          already,
          dest,
          merged: Boolean(merged),
          parsed,
          sampleCount,
        });
        send(res, 200, {
          already,
          merged: Boolean(merged),
          ok: true,
          path: pointer.path,
          sessionId: parsed.sessionId,
          traceId: parsed.traceId,
        });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/replay/jobs') {
        if (!authorize(req)) {
          send(res, 401, { ok: false, reason: 'unauthorized' });
          return;
        }
        const raw = await readBody(req, MAX_JSON_BYTES);
        let json;
        try {
          json = JSON.parse(raw.toString('utf8'));
        } catch {
          send(res, 400, { ok: false, reason: 'invalid json' });
          return;
        }
        const parsed = parseReplayJobBody(json);
        if (!parsed.ok) {
          send(res, 400, { ok: false, reason: parsed.reason });
          return;
        }
        const job = await writeJob(root, {
          fixtureId: parsed.fixtureId,
          kind: parsed.kind,
          stage: parsed.stage,
          status: 'queued',
        });
        send(res, 200, { job, ok: true });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/replay/next') {
        if (!authorize(req)) {
          send(res, 401, { ok: false, reason: 'unauthorized' });
          return;
        }
        const queued = await nextQueuedJob(root);
        if (!queued) {
          send(res, 200, { job: null, ok: true });
          return;
        }
        const running = await writeJob(root, { ...queued, status: 'running' });
        send(res, 200, { job: running, ok: true });
        return;
      }

      const resultMatch = url.pathname.match(/^\/api\/replay\/jobs\/([^/]+)\/result$/);
      if (req.method === 'POST' && resultMatch) {
        if (!authorize(req)) {
          send(res, 401, { ok: false, reason: 'unauthorized' });
          return;
        }
        const id = sanitizeId(resultMatch[1]);
        const existing = id ? await readJob(root, id) : null;
        if (!existing) {
          send(res, 404, { ok: false, reason: 'unknown job' });
          return;
        }
        const raw = await readBody(req, MAX_JSON_BYTES);
        let json;
        try {
          json = JSON.parse(raw.toString('utf8'));
        } catch {
          send(res, 400, { ok: false, reason: 'invalid json' });
          return;
        }
        const failed = json?.ok === false;
        const job = await writeJob(root, {
          ...existing,
          error: failed ? String(json?.error ?? 'replay failed') : null,
          result: json?.result ?? json ?? null,
          status: failed ? 'error' : 'done',
        });
        send(res, 200, { job, ok: true });
        return;
      }

      const getMatch = url.pathname.match(/^\/api\/replay\/jobs\/([^/]+)$/);
      if (req.method === 'GET' && getMatch) {
        if (!authorize(req)) {
          send(res, 401, { ok: false, reason: 'unauthorized' });
          return;
        }
        const id = sanitizeId(getMatch[1]);
        const job = id ? await readJob(root, id) : null;
        if (!job) {
          send(res, 404, { ok: false, reason: 'unknown job' });
          return;
        }
        send(res, 200, { job, ok: true });
        return;
      }

      send(res, 404, { ok: false, reason: 'not found' });
    } catch (err) {
      const status = err?.status === 413 ? 413 : 500;
      send(res, status, {
        ok: false,
        reason: status === 413 ? 'payload too large' : 'server error',
      });
    }
  });

  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolveListen());
  });
  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;
  const lan = lanIPv4();
  const url = `http://${lan}:${boundPort}`;

  return {
    close: () => new Promise((resolveClose, reject) => server.close(err => (err ? reject(err) : resolveClose()))),
    lan,
    pairing: pairingUrl(url, token),
    pairingAlt: pairingUrlAlt(url, token),
    port: boundPort,
    token,
    url,
  };
};

export const printBanner = (started) => {
  console.log('');
  console.log('Lugin Scan Inbox');
  console.log(`Listening: ${started.url}`);
  console.log(`Token: ${started.token}`);
  console.log(`Pair: ${started.pairing}`);
  console.log(`Pair (app scheme): ${started.pairingAlt}`);
  console.log('');
  console.log('Development receiver — accessible on local network while running.');
  console.log('Do not expose this port to the public internet. No tunnels are opened.');
  console.log('');
  console.log('Waiting for phone...');
};
