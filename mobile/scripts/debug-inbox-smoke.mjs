#!/usr/bin/env node
/**
 * Protocol + queue smoke (no RN runtime).
 * Proves: local save first, async upload, no delete before 200, retry.
 */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const dir = await mkdtemp(join(tmpdir(), 'lugin-inbox-smoke-'));
const files = new Map();
const fetchCalls = [];
let fetchImpl = async () => {
  throw new Error('receiver unavailable');
};

const fsStub = join(dir, 'fs.mjs');
const benchStub = join(dir, 'bench.mjs');
const rnStub = join(dir, 'rn.mjs');
const outfile = join(dir, 'inbox.mjs');

await writeFile(
  fsStub,
  `
const files = globalThis.__inboxFiles;
export const documentDirectory = "file:///documents/";
export const makeDirectoryAsync = async () => {};
export const writeAsStringAsync = async (uri, contents) => { files.set(uri, String(contents)); };
export const readAsStringAsync = async (uri) => {
  const c = files.get(uri);
  if (c == null) throw new Error("missing " + uri);
  return String(c);
};
export const getInfoAsync = async (uri) => {
  const c = files.get(uri);
  return c == null ? { exists: false } : { exists: true, size: String(c).length };
};
export const deleteAsync = async (uri) => { files.delete(uri); };
`,
);

await writeFile(benchStub, 'export const isBenchmarkToolsEnabled = () => true;\n');
await writeFile(
  rnStub,
  `
export const Platform = { OS: 'android', select: (spec) => spec.android ?? spec.default };
export const Pressable = () => null;
export const StyleSheet = { create: (s) => s };
export const Text = () => null;
export const TextInput = () => null;
export const View = () => null;
`,
);

globalThis.__inboxFiles = files;
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url: String(url), init });
  return fetchImpl(url, init);
};

await esbuild.build({
  alias: {
    'expo-file-system/legacy': fsStub,
    'react-native': rnStub,
  },
  bundle: true,
  entryPoints: [join(mobileRoot, 'src/scan/debugInbox/index.ts')],
  external: ['expo-constants', 'expo-updates'],
  format: 'esm',
  outfile,
  platform: 'neutral',
  plugins: [
    {
      name: 'stub-benchmark-gate',
      setup(build) {
        build.onResolve({ filter: /benchmark\/isBenchmarkEnabled$/ }, () => ({ path: benchStub }));
      },
    },
  ],
});

globalThis.__LUGIN_INBOX_NO_SLEEP = true;
const inbox = await import(pathToFileURL(outfile).href);

const jsonOk = (body, status = 200) => ({
  json: async () => body,
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
});

files.set('file:///documents/lugin-geometry/t1/geometry-trace.json', '{"samples":[1,2,3]}');
files.set(
  'file:///documents/lugin-debug-inbox/settings.json',
  JSON.stringify({ token: 'tok', url: 'http://192.168.1.9:8787' }),
);

await inbox.saveInboxSettings({ token: 'tok', url: 'http://192.168.1.9:8787' });

assert.equal(inbox.parsePairInput('lugin-debug://pair?url=http%3A%2F%2F10.0.0.1%3A8787&token=abc').token, 'abc');
assert.equal(inbox.normalizeReceiverUrl('http://10.0.0.1:8787/'), 'http://10.0.0.1:8787');

fetchImpl = async () => {
  throw new Error('Network request failed');
};

const queued = await inbox.enqueueGeometryTrace({
  dirUri: 'file:///documents/lugin-geometry/t1/',
  scannerPhase: 'detected',
});
assert.equal(queued.queued, true);
assert.ok(queued.traceId);

const wait = (ms) => new Promise(r => setTimeout(r, ms));
await wait(40);

assert.equal(
  files.has('file:///documents/lugin-geometry/t1/geometry-trace.json'),
  true,
  'must not delete local trace before ack',
);
assert.ok(inbox.getInboxSnapshot().pending >= 1);

let uploads = 0;
fetchImpl = async (url, init) => {
  if (String(url).endsWith('/health')) {
    return jsonOk({ ok: true, serverTime: 't', version: '1' });
  }
  uploads += 1;
  const body = JSON.parse(init.body);
  assert.equal(body.traceType, 'geometry');
  assert.ok(body.files['geometry-trace.json']);
  return jsonOk({ already: false, ok: true, traceId: body.traceId });
};

const retried = await inbox.retryInboxUploads();
assert.ok(retried >= 1);
for (let i = 0; i < 40 && (uploads < 1 || inbox.getInboxSnapshot().pending > 0); i += 1) {
  await wait(50);
}

assert.equal(uploads >= 1, true, `uploads=${uploads} pending=${inbox.getInboxSnapshot().pending}`);
assert.equal(inbox.getInboxSnapshot().pending, 0);
assert.equal(inbox.getInboxSnapshot().lastUpload?.traceId, queued.traceId);
assert.equal(
  files.has('file:///documents/lugin-geometry/t1/geometry-trace.json'),
  true,
  'must keep local copy after ack',
);

files.set('file:///documents/lugin-geometry/t2/geometry-trace.json', '{"samples":[1]}');
files.set(
  'file:///documents/lugin-geometry/t2/recognition-attempt-3.png',
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
);

let poisonUploads = 0;
fetchImpl = async (url, init) => {
  if (String(url).endsWith('/health')) {
    return jsonOk({ ok: true, serverTime: 't', version: '1' });
  }
  poisonUploads += 1;
  const body = JSON.parse(init.body);
  assert.ok(body.files['recognition-attempt-3.png'], 'attempt crops upload once the receiver allowlists them');
  assert.ok(body.files['geometry-trace.json']);
  return jsonOk({ already: false, ok: true, traceId: body.traceId });
};

const mixed = await inbox.enqueueInboxUpload({
  files: [
    {
      kind: 'text',
      name: 'geometry-trace.json',
      uri: 'file:///documents/lugin-geometry/t2/geometry-trace.json',
    },
    {
      kind: 'base64',
      name: 'recognition-attempt-3.png',
      uri: 'file:///documents/lugin-geometry/t2/recognition-attempt-3.png',
    },
  ],
  traceType: 'geometry',
});
assert.equal(mixed.queued, true);
for (let i = 0; i < 40 && poisonUploads < 1; i += 1) {
  await wait(50);
}
assert.equal(poisonUploads >= 1, true, `poisonUploads=${poisonUploads}`);

let unexpectedUploads = 0;
fetchImpl = async (url, init) => {
  if (String(url).endsWith('/health')) {
    return jsonOk({ ok: true, serverTime: 't', version: '1' });
  }
  unexpectedUploads += 1;
  const body = JSON.parse(init.body);
  if (body.files['detector-first.png']) {
    return jsonOk({ ok: false, reason: 'unexpected file detector-first.png' }, 400);
  }
  assert.ok(body.files['geometry-trace.json']);
  return jsonOk({ already: false, ok: true, traceId: body.traceId });
};

files.set('file:///documents/lugin-geometry/t3/geometry-trace.json', '{"samples":[2]}');
files.set(
  'file:///documents/lugin-geometry/t3/detector-first.png',
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
);
const unexpected = await inbox.enqueueInboxUpload({
  files: [
    {
      kind: 'text',
      name: 'geometry-trace.json',
      uri: 'file:///documents/lugin-geometry/t3/geometry-trace.json',
    },
    {
      kind: 'base64',
      name: 'detector-first.png',
      uri: 'file:///documents/lugin-geometry/t3/detector-first.png',
    },
  ],
  sessionId: 'phone-20260907',
  traceId: 'trace-0099',
  traceType: 'geometry',
});
assert.equal(unexpected.queued, true);
for (let i = 0; i < 40 && unexpectedUploads < 2; i += 1) {
  await wait(50);
}
assert.equal(unexpectedUploads >= 2, true, `unexpectedUploads=${unexpectedUploads}`);

const tinyPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
files.set('file:///documents/lugin-post-lock/attempt-1/recognition-card.png', tinyPng);
files.set('file:///documents/lugin-post-lock/attempt-1/title-crop-raw.png', tinyPng);
files.set('file:///documents/lugin-post-lock/attempt-1/title-crop-ocr.png', tinyPng);
files.set('file:///documents/lugin-post-lock/attempt-1/ocr-debug.json', '{"transport":"rgba-bytes"}');
files.set('file:///documents/lugin-post-lock/attempt-1/post-lock.json', '{"attemptNumber":1}');

let ocrUploads = 0;
fetchImpl = async (url, init) => {
  if (String(url).endsWith('/health')) {
    return jsonOk({ ok: true, serverTime: 't', version: '1' });
  }
  ocrUploads += 1;
  const body = JSON.parse(init.body);
  assert.equal(body.traceType, 'ocr-debug');
  assert.ok(body.files['recognition-card.png']);
  assert.ok(body.files['title-crop-raw.png']);
  assert.ok(body.files['title-crop-ocr.png']);
  assert.ok(body.files['ocr-debug.json']);
  assert.ok(body.files['post-lock.json']);
  return jsonOk({ already: false, ok: true, traceId: body.traceId });
};

const ocrQueued = await inbox.enqueueRecognitionDebug({
  dirUri: 'file:///documents/lugin-post-lock/attempt-1/',
  scannerPhase: 'ocr-empty',
});
assert.equal(ocrQueued.queued, true);
for (let i = 0; i < 40 && ocrUploads < 1; i += 1) {
  await wait(50);
}
assert.equal(ocrUploads >= 1, true, `ocrUploads=${ocrUploads}`);

const health = await inbox.testInboxConnection();
assert.equal(health.connection, 'connected');

const cleared = await inbox.clearUploadedInboxTraces();
assert.equal(cleared >= 1, true);
assert.equal(
  files.has('file:///documents/lugin-geometry/t1/geometry-trace.json'),
  true,
  'clear uploaded must not delete source files',
);

await rm(dir, { force: true, recursive: true });
console.log('debug-inbox smoke ok');
