import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

import { isSafeId, pairingUrl, parseBearer, parsePairInput, sanitizeId, timingSafeEqualToken } from './scan-inbox/lib.mjs';
import { startInboxServer } from './scan-inbox/server.mjs';
import { readReceiverSession, writeReceiverSession } from './scan-inbox/session-file.mjs';
import {
  cloudflaredInstallHelp,
  extractTunnelHttpsUrl,
  probeReceiverHealth,
} from './scan-inbox/tunnel.mjs';

const dir = await mkdtemp(join(tmpdir(), 'lugin-inbox-'));
const token = 'test-token-abcdefghijklmnopqrstuv';
let failed = 0;

const check = async (name, fn) => {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(err);
  }
};

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const started = await startInboxServer({ port: 0, root: dir, token });
const base = `http://127.0.0.1:${started.port}`;

const call = async (path, opts = {}) => {
  const headers = { ...(opts.headers ?? {}) };
  if (opts.auth !== false) headers.Authorization = `Bearer ${opts.token ?? token}`;
  const res = await fetch(`${base}${path}`, {
    ...opts,
    headers,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { json, status: res.status, text };
};

const upload = (body, extra = {}) =>
  call('/api/scans', {
    ...extra,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(extra.headers ?? {}) },
    method: 'POST',
  });

await check('safe ids reject traversal', () => {
  assert.equal(isSafeId('trace-0042'), true);
  assert.equal(isSafeId('../etc'), false);
  assert.equal(isSafeId('/abs'), false);
  assert.equal(isSafeId('a/b'), false);
  assert.equal(sanitizeId('..'), null);
});

await check('bearer parse + constant-time token compare', () => {
  assert.equal(parseBearer('Bearer abc'), 'abc');
  assert.equal(parseBearer('basic x'), null);
  assert.equal(timingSafeEqualToken(token, token), true);
  assert.equal(timingSafeEqualToken(token, 'nope'), false);
});

await check('pairing URL round-trip', () => {
  const parsed = parsePairInput(started.pairing);
  assert.ok(parsed);
  assert.equal(parsed.token, token);
  assert.ok(parsed.url.includes(String(started.port)));
  const alt = parsePairInput(started.pairingAlt);
  assert.ok(alt);
  assert.equal(alt.token, token);
});

await check('health requires token', async () => {
  const missing = await call('/health', { auth: false });
  assert.equal(missing.status, 401);
  const wrong = await call('/health', { token: 'wrong-token-abcdefghijklmnopqrstu' });
  assert.equal(wrong.status, 401);
  const ok = await call('/health');
  assert.equal(ok.status, 200);
  assert.equal(ok.json.ok, true);
  assert.equal(ok.json.version, '1');
});

await check('valid authenticated upload updates latest.json atomically', async () => {
  const res = await upload({
    createdAt: '2026-09-07T10:00:00.000Z',
    files: {
      'geometry-trace.json': {
        mime: 'application/json',
        text: JSON.stringify({ samples: [{ seq: 0 }], meta: { sampleCount: 1, phase: 'detected' } }),
      },
      'detector-first.png': { base64: png.toString('base64'), mime: 'image/png' },
    },
    scannerPhase: 'detected',
    sessionId: 'samsung-20260907',
    traceId: 'trace-0042',
    traceType: 'geometry',
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.already, false);
  const dest = join(dir, 'sessions', 'samsung-20260907', 'trace-0042');
  assert.equal(existsSync(join(dest, 'geometry-trace.json')), true);
  assert.equal(existsSync(join(dest, 'detector-first.png')), true);
  assert.equal(existsSync(join(dest, '.complete')), true);
  const latest = JSON.parse(await readFile(join(dir, 'latest.json'), 'utf8'));
  assert.equal(latest.traceId, 'trace-0042');
  assert.equal(latest.path, '.scan-inbox/sessions/samsung-20260907/trace-0042');
  assert.equal(latest.token, undefined);
  assert.equal(latest.sampleCount, 1);
});

await check('scanner lab fixture files are accepted', async () => {
  const res = await upload({
    files: {
      'fixture.json': { mime: 'application/json', text: '{"fixtureId":"wand-1"}' },
      'source-highres.png': { base64: png.toString('base64'), mime: 'image/png' },
      'lab-compare.json': { mime: 'application/json', text: '{"sameSource":true}' },
    },
    sessionId: 'samsung-20260908',
    traceId: 'wand-1',
    traceType: 'lab',
  });
  assert.equal(res.status, 200, res.json?.reason ?? res.text);
  const dest = join(dir, 'sessions', 'samsung-20260908', 'wand-1');
  assert.equal(existsSync(join(dest, 'fixture.json')), true);
  assert.equal(existsSync(join(dest, 'source-highres.png')), true);
});

await check('geometry-test source/card/metadata files are accepted', async () => {
  const res = await upload({
    files: {
      'summary.json': {
        mime: 'application/json',
        text: '{"kind":"geometry-test","fixtureId":"geometry-test-unit","items":[]}',
      },
      'geom-001-source.png': { base64: png.toString('base64'), mime: 'image/png' },
      'geom-001-card.png': { base64: png.toString('base64'), mime: 'image/png' },
      'geom-001-metadata.json': {
        mime: 'application/json',
        text: '{"itemIndex":1,"manualCapture":false}',
      },
    },
    sessionId: 'geometry-test-unit',
    traceId: 'summary',
    traceType: 'geometry-test',
  });
  assert.equal(res.status, 200, res.json?.reason ?? res.text);
  const dest = join(dir, 'sessions', 'geometry-test-unit', 'summary');
  assert.equal(existsSync(join(dest, 'summary.json')), true);
  assert.equal(existsSync(join(dest, 'geom-001-card.png')), true);
  assert.equal(existsSync(join(dest, 'geom-001-source.png')), true);
});

await check('binder diagnostic page/track files are accepted', async () => {
  const res = await upload({
    files: {
      'summary.json': {
        mime: 'application/json',
        text: '{"kind":"binder","fixtureId":"binder-session-unit","pages":[]}',
      },
      'p01-f001.png': { base64: png.toString('base64'), mime: 'image/png' },
      'p01-t01-card.png': { base64: png.toString('base64'), mime: 'image/png' },
      'p01-metadata.json': {
        mime: 'application/json',
        text: '{"pageIndex":1,"status":"DONE"}',
      },
      'p01-tracks.json': {
        mime: 'application/json',
        text: '{"pageIndex":1,"tracks":[{"binderTrackId":"t1","identificationReady":true}]}',
      },
    },
    sessionId: 'binder-session-unit',
    traceId: 'summary',
    traceType: 'binder',
  });
  assert.equal(res.status, 200, res.json?.reason ?? res.text);
  const dest = join(dir, 'sessions', 'binder-session-unit', 'summary');
  assert.equal(existsSync(join(dest, 'summary.json')), true);
  assert.equal(existsSync(join(dest, 'p01-f001.png')), true);
  assert.equal(existsSync(join(dest, 'p01-t01-card.png')), true);
  assert.equal(existsSync(join(dest, 'p01-tracks.json')), true);
});

await check('capture-quality A/B bundle is one upload', async () => {
  const res = await upload({
    files: {
      'metadata.json': { mime: 'application/json', text: '{"fixtureId":"cq-wand-1"}' },
      'ocr-results.json': { mime: 'application/json', text: '{"snapshot":{},"photo":{}}' },
      'fast-source.png': { base64: png.toString('base64'), mime: 'image/png' },
      'fast-overlay.png': { base64: png.toString('base64'), mime: 'image/png' },
      'fast-card-744x1039.png': { base64: png.toString('base64'), mime: 'image/png' },
      'fast-title.png': { base64: png.toString('base64'), mime: 'image/png' },
      'photo-source.png': { base64: png.toString('base64'), mime: 'image/png' },
      'photo-overlay.png': { base64: png.toString('base64'), mime: 'image/png' },
      'photo-card-744x1039.png': { base64: png.toString('base64'), mime: 'image/png' },
      'photo-title.png': { base64: png.toString('base64'), mime: 'image/png' },
    },
    sessionId: 'samsung-20260908',
    traceId: 'cq-wand-1',
    traceType: 'capture-quality',
  });
  assert.equal(res.status, 200, res.json?.reason ?? res.text);
  const dest = join(dir, 'sessions', 'samsung-20260908', 'cq-wand-1');
  assert.equal(existsSync(join(dest, 'metadata.json')), true);
  assert.equal(existsSync(join(dest, 'photo-overlay.png')), true);
  assert.equal(existsSync(join(dest, 'fast-title.png')), true);
});

await check('recognition-card / title-crop / ocr-debug files are accepted', async () => {
  const res = await upload({
    files: {
      'recognition-card.png': { base64: png.toString('base64'), mime: 'image/png' },
      'title-crop-raw.png': { base64: png.toString('base64'), mime: 'image/png' },
      'title-crop-ocr.png': { base64: png.toString('base64'), mime: 'image/png' },
      'ocr-debug.json': { mime: 'application/json', text: '{"transport":"rgba-bytes"}' },
      'post-lock.json': { mime: 'application/json', text: '{"attemptNumber":1}' },
    },
    sessionId: 'samsung-20260907',
    traceId: 'trace-0044',
    traceType: 'ocr-debug',
  });
  assert.equal(res.status, 200, res.json?.reason ?? res.text);
  assert.equal(res.json.ok, true);
  const dest = join(dir, 'sessions', 'samsung-20260907', 'trace-0044');
  assert.equal(existsSync(join(dest, 'recognition-card.png')), true);
  assert.equal(existsSync(join(dest, 'title-crop-raw.png')), true);
  assert.equal(existsSync(join(dest, 'title-crop-ocr.png')), true);
  assert.equal(existsSync(join(dest, 'ocr-debug.json')), true);
  assert.equal(existsSync(join(dest, 'post-lock.json')), true);
});

await check('recognition-attempt and post-lock files are accepted', async () => {
  const res = await upload({
    files: {
      'geometry-trace.json': { mime: 'application/json', text: '{"samples":[]}' },
      'recognition-attempt-3.png': { base64: png.toString('base64'), mime: 'image/png' },
      'post-lock.json': { mime: 'application/json', text: '{"attemptNumber":3}' },
    },
    sessionId: 'samsung-20260907',
    traceId: 'trace-0043',
    traceType: 'geometry',
  });
  assert.equal(res.status, 200, res.json?.reason ?? res.text);
  assert.equal(res.json.ok, true);
  const dest = join(dir, 'sessions', 'samsung-20260907', 'trace-0043');
  assert.equal(existsSync(join(dest, 'recognition-attempt-3.png')), true);
  assert.equal(existsSync(join(dest, 'post-lock.json')), true);
});

await check('lab live-orch merge lands on an already-complete fixture', async () => {
  const first = await upload({
    files: {
      'fixture.json': { mime: 'application/json', text: '{"fixtureId":"negate-1"}' },
      'source-highres.png': { base64: png.toString('base64'), mime: 'image/png' },
    },
    sessionId: 'samsung-20260908',
    traceId: 'negate-1',
    traceType: 'lab',
  });
  assert.equal(first.json.already, false);
  const second = await upload({
    files: {
      'lab-live-orch.json': {
        mime: 'application/json',
        text: '{"liveOrch":{"name":"Negate"}}',
      },
    },
    sessionId: 'samsung-20260908',
    traceId: 'negate-1',
    traceType: 'lab',
  });
  assert.equal(second.status, 200, second.json?.reason ?? second.text);
  assert.equal(second.json.ok, true);
  assert.equal(second.json.merged, true);
  const dest = join(dir, 'sessions', 'samsung-20260908', 'negate-1');
  assert.equal(existsSync(join(dest, 'source-highres.png')), true);
  assert.equal(
    await readFile(join(dest, 'lab-live-orch.json'), 'utf8'),
    '{"liveOrch":{"name":"Negate"}}',
  );
});

await check('many small POSTs merge into one focus-series-sized fixture', async () => {
  const names = [
    't000-source.png',
    't000-card.png',
    't000-title.png',
    't250-source.png',
    't250-card.png',
    't250-title.png',
  ];
  let first = true;
  for (const name of names) {
    const res = await upload({
      files: { [name]: { base64: png.toString('base64'), mime: 'image/png' } },
      sessionId: 'samsung-20260908',
      traceId: 'focus-series-chunk',
      traceType: 'focus-series',
    });
    assert.equal(res.status, 200, `${name} ${res.json?.reason ?? res.text}`);
    assert.equal(res.json.ok, true);
    if (!first) assert.equal(res.json.merged, true);
    first = false;
  }
  const dest = join(dir, 'sessions', 'samsung-20260908', 'focus-series-chunk');
  for (const name of names) {
    assert.equal(existsSync(join(dest, name)), true, name);
  }
});

await check('duplicate traceId is idempotent', async () => {
  const res = await upload({
    files: {
      'geometry-trace.json': { mime: 'application/json', text: '{"samples":[]}' },
    },
    sessionId: 'samsung-20260907',
    traceId: 'trace-0042',
    traceType: 'geometry',
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.already, true);
  assert.ok(Array.isArray(res.json.receivedFiles));
});

await check('session file list returns received names across traces', async () => {
  const sessionId = 'binder-list-demo';
  const a = await upload({
    files: {
      'p01-f001.png': { mime: 'image/png', base64: png.toString('base64') },
    },
    sessionId,
    traceId: 'p01-f001',
    traceType: 'binder-benchmark',
  });
  assert.equal(a.status, 200);
  const b = await upload({
    files: {
      'p01-f002.png': { mime: 'image/png', base64: png.toString('base64') },
    },
    sessionId,
    traceId: 'p01-f002',
    traceType: 'binder-benchmark',
  });
  assert.equal(b.status, 200);
  const listed = await call(`/api/sessions/${sessionId}`);
  assert.equal(listed.status, 200);
  assert.equal(listed.json.ok, true);
  const names = listed.json.files.map(f => f.name).sort();
  assert.deepEqual(names, ['p01-f001.png', 'p01-f002.png']);
  // Idempotent re-upload of same path
  const again = await upload({
    files: {
      'p01-f001.png': { mime: 'image/png', base64: png.toString('base64') },
    },
    sessionId,
    traceId: 'p01-f001',
    traceType: 'binder-benchmark',
  });
  assert.equal(again.status, 200);
  assert.equal(again.json.already, true);
});

await check('missing token rejected', async () => {
  const res = await upload(
    {
      files: { 'report.json': { mime: 'application/json', text: '{}' } },
      sessionId: 's1',
      traceId: 't-missing',
    },
    { auth: false },
  );
  assert.equal(res.status, 401);
  assert.equal(existsSync(join(dir, 'sessions', 's1', 't-missing')), false);
});

await check('wrong token rejected', async () => {
  const res = await upload(
    {
      files: { 'report.json': { mime: 'application/json', text: '{}' } },
      sessionId: 's1',
      traceId: 't-wrong',
    },
    { token: 'totally-different-token-value-xx' },
  );
  assert.equal(res.status, 401);
});

await check('path traversal filename rejected', async () => {
  const res = await upload({
    files: { '../secret.json': { mime: 'application/json', text: '{}' } },
    sessionId: 's1',
    traceId: 't-trav',
  });
  assert.equal(res.status, 400);
  assert.match(res.json.reason, /traversal|unexpected/);
});

await check('invalid mime / not a png rejected', async () => {
  const res = await upload({
    files: { 'detector-first.png': { base64: Buffer.from('notpng').toString('base64'), mime: 'image/png' } },
    sessionId: 's2',
    traceId: 't-png',
  });
  assert.equal(res.status, 400);
  assert.match(res.json.reason, /png/);
});

await check('oversized upload rejected before promote', async () => {
  const big = 'a'.repeat(6 * 1024 * 1024);
  const res = await upload({
    files: { 'report.json': { mime: 'application/json', text: big } },
    sessionId: 's3',
    traceId: 't-big',
  });
  assert.ok(res.status === 400 || res.status === 413);
  assert.equal(existsSync(join(dir, 'sessions', 's3', 't-big')), false);
});

await check('partial / invalid json does not write dest', async () => {
  const res = await call('/api/scans', {
    body: '{not-json',
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  assert.equal(res.status, 400);
});

await check('local health probe + session file for tunnel pairing', async () => {
  const missing = await probeReceiverHealth(base, '');
  assert.equal(missing.reachable, true);
  assert.equal(missing.status, 401);
  const ok = await probeReceiverHealth(base, token);
  assert.equal(ok.ok, true);
  assert.equal(ok.json.version, '1');
  await writeReceiverSession(dir, { port: started.port, token });
  const session = await readReceiverSession(dir);
  assert.equal(session.token, token);
  assert.equal(session.port, started.port);
});

await check('tunnel HTTPS URL extract + pairing keeps token', () => {
  const log = [
    'INF Requesting new quick Tunnel on trycloudflare.com...',
    'https://example.com/docs',
    '|  https://amber-widget-demo.trycloudflare.com                      |',
  ].join('\n');
  assert.equal(extractTunnelHttpsUrl(log), 'https://amber-widget-demo.trycloudflare.com');
  assert.equal(extractTunnelHttpsUrl('no urls here'), null);
  const pair = pairingUrl('https://amber-widget-demo.trycloudflare.com', token);
  const parsed = parsePairInput(pair);
  assert.equal(parsed.url, 'https://amber-widget-demo.trycloudflare.com');
  assert.equal(parsed.token, token);
  assert.match(cloudflaredInstallHelp(), /brew install cloudflared/);
});

await check('replay job enqueue / next / result requires bearer and known schema', async () => {
  const denied = await call('/api/replay/jobs', {
    auth: false,
    body: JSON.stringify({ fixtureId: 'maddening-hex-alt-art-20260908T082448', kind: 'recognize-fixture' }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  assert.equal(denied.status, 401);

  const badKind = await call('/api/replay/jobs', {
    body: JSON.stringify({ fixtureId: 'maddening-hex-alt-art-20260908T082448', kind: 'eval' }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  assert.equal(badKind.status, 400);

  const created = await call('/api/replay/jobs', {
    body: JSON.stringify({
      fixtureId: 'maddening-hex-alt-art-20260908T082448',
      kind: 'recognize-fixture',
      stage: 'canonical',
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  assert.equal(created.status, 200);
  assert.equal(created.json.job.status, 'queued');
  const id = created.json.job.id;

  const next = await call('/api/replay/next');
  assert.equal(next.status, 200);
  assert.equal(next.json.job.id, id);
  assert.equal(next.json.job.status, 'running');

  const posted = await call(`/api/replay/jobs/${id}/result`, {
    body: JSON.stringify({
      ok: true,
      result: { fixtureId: 'maddening-hex-alt-art-20260908T082448', status: 'identified' },
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  assert.equal(posted.status, 200);
  const got = await call(`/api/replay/jobs/${id}`);
  assert.equal(got.json.job.status, 'done');
  assert.equal(got.json.job.result.status, 'identified');
});

await check('receiver unavailable is a client-visible failure (not a write)', async () => {
  await started.close();
  let threw = false;
  try {
    await fetch(`${base}/health`, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    threw = true;
  }
  assert.equal(threw, true);
});

await check('inbox config: token/name persist; restart does not regenerate', async () => {
  const { ensureInboxConfig, tunnelRestartBackoffMs, writeTunnelState, readTunnelState } =
    await import('./scan-inbox/inbox-config.mjs');
  const cfgDir = await mkdtemp(join(tmpdir(), 'lugin-inbox-cfg-'));
  const first = await ensureInboxConfig(cfgDir, { name: 'dev-phone', token: 'persist-token-abcdefghijklmnopqrst' });
  assert.equal(first.token, 'persist-token-abcdefghijklmnopqrst');
  assert.equal(first.name, 'dev-phone');
  const second = await ensureInboxConfig(cfgDir);
  assert.equal(second.token, first.token);
  assert.equal(second.name, first.name);
  const forced = await ensureInboxConfig(cfgDir, { forceNewToken: true });
  assert.notEqual(forced.token, first.token);
  assert.equal(forced.name, 'dev-phone');
  assert.equal(tunnelRestartBackoffMs(0), 2000);
  assert.equal(tunnelRestartBackoffMs(2), 8000);
  assert.ok(tunnelRestartBackoffMs(20) <= 60_000);
  await writeTunnelState(cfgDir, {
    url: 'https://old.trycloudflare.com',
    status: 'exited',
    inboxName: first.name,
    tokenRef: 'config.json',
  });
  const t1 = await readTunnelState(cfgDir);
  assert.equal(t1.url, 'https://old.trycloudflare.com');
  await writeTunnelState(cfgDir, {
    url: 'https://new.trycloudflare.com',
    status: 'up',
    inboxName: first.name,
    tokenRef: 'config.json',
  });
  const t2 = await readTunnelState(cfgDir);
  assert.equal(t2.url, 'https://new.trycloudflare.com');
  // Credentials unchanged when endpoint changes
  const afterUrl = await ensureInboxConfig(cfgDir);
  assert.equal(afterUrl.token, forced.token);
  await rm(cfgDir, { force: true, recursive: true });
});

await check('pairing: URL-only update keeps token absent so phone retains saved token', () => {
  const urlOnly = parsePairInput('lugin://pair-debug?url=https%3A%2F%2Fnew.trycloudflare.com');
  assert.ok(urlOnly);
  assert.equal(urlOnly.url, 'https://new.trycloudflare.com');
  assert.equal(urlOnly.token, '');
  const full = parsePairInput(
    pairingUrl('https://new.trycloudflare.com', 'same-token-abcdefghijklmnopqrstuv'),
  );
  assert.ok(full);
  assert.equal(full.token, 'same-token-abcdefghijklmnopqrstuv');
});

await rm(dir, { force: true, recursive: true });

if (failed) {
  console.error(`\n${failed} scan-inbox check(s) failed`);
  process.exit(1);
}
console.log('\nall scan-inbox checks passed');
