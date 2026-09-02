// Security + policy tests for development-capture corpus (Drive transport).

import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as esbuild from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(join(tmpdir(), 'lugin-corpus-'));
const bundle = join(dir, 'corpus.mjs');

await esbuild.build({
  bundle: true,
  format: 'esm',
  outfile: bundle,
  platform: 'neutral',
  stdin: {
    contents: `
      export * from '${join(root, 'src/lib/scan/corpus/policy.ts')}';
      export * from '${join(root, 'src/lib/scan/corpus/throttle.ts')}';
      export * from '${join(root, 'src/lib/scan/corpus/ids.ts')}';
      export * from '${join(root, 'src/lib/scan/corpus/types.ts')}';
      export * from '${join(root, 'src/lib/scan/corpus/validate.ts')}';
      export * from '${join(root, 'src/core/sync/driveCorpus.ts')}';
      export * from '${join(root, 'src/core/sync/scopes.ts')}';
    `,
    resolveDir: root,
    sourcefile: 'entry.ts',
  },
});

const {
  CORPUS_SCHEMA_VERSION,
  CORPUS_CONSENT_VERSION,
  allowAutomaticSample,
  corpusPolicyFor,
  emptyThrottle,
  newSampleId,
  pickEvictionIndex,
  validateMetaStrict,
  sniffImageMime,
  DRIVE_SCOPES,
  DRIVE_FILE_SCOPE,
  DRIVE_APPDATA_SCOPE,
  createDriveCorpusRepository,
} = await import(pathToFileURL(bundle).href);

let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(err);
  }
};

const checkAsync = async (name, fn) => {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(err);
  }
};

check('schema + consent versions', () => {
  assert.equal(CORPUS_SCHEMA_VERSION, 1);
  assert.equal(CORPUS_CONSENT_VERSION, 2);
});

check('manual reports are high priority full frames', () => {
  const p = corpusPolicyFor('DETECTION_FAILURE_REPORTED');
  assert.equal(p.priority, 'high');
  assert.equal(p.imageKind, 'full-frame');
});

check('success samples are low priority and probabilistic', () => {
  const p = corpusPolicyFor('SUCCESS_SAMPLE');
  assert.equal(p.priority, 'low');
  assert.ok((p.sampleProbability ?? 1) < 1);
});

check('throttle blocks rapid automatic duplicates', () => {
  let state = emptyThrottle();
  const first = allowAutomaticSample(state, 'DETECTION_TIMEOUT', 1_000, () => 0);
  assert.equal(first.ok, true);
  state = first.next;
  const second = allowAutomaticSample(state, 'DETECTION_TIMEOUT', 1_100, () => 0);
  assert.equal(second.ok, false);
});

check('eviction prefers lowest priority', () => {
  assert.equal(pickEvictionIndex(['high', 'low', 'medium']), 1);
});

check('sample ids look random and unique', () => {
  assert.notEqual(newSampleId(), newSampleId());
});

const validMeta = () => ({
  appVersion: '1.0.1',
  contributorId: 'abcdefghijkl',
  createdAt: new Date().toISOString(),
  eventType: 'SUCCESS_SAMPLE',
  image: null,
  labelKind: 'AUTO_LOCKED_POSITIVE',
  priority: 'low',
  sampleId: 'client-sample-id-01',
  scannerVersion: 'scan-corpus/1',
  schemaVersion: 1,
  sessionId: 'sessionid1234',
});

check('strict meta accepts valid sample and rejects Google identity', () => {
  assert.equal(validateMetaStrict(validMeta()), null);
  assert.equal(validateMetaStrict({ ...validMeta(), email: 'a@b.c' }), 'forbidden_field');
  assert.equal(
    validateMetaStrict({ ...validMeta(), googleAccountId: 'x' }),
    'forbidden_field',
  );
  assert.equal(validateMetaStrict({ ...validMeta(), eventType: 'HACK' }), 'bad_event');
});

check('sniffImageMime accepts jpeg/webp and rejects svg', () => {
  assert.equal(
    sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])),
    'image/jpeg',
  );
  assert.equal(sniffImageMime(new TextEncoder().encode('<svg xmlns="x"></svg>')), null);
});

check('OAuth scopes include appdata + drive.file', () => {
  assert.ok(DRIVE_SCOPES.includes(DRIVE_APPDATA_SCOPE));
  assert.ok(DRIVE_SCOPES.includes(DRIVE_FILE_SCOPE));
});

await checkAsync('Drive corpus creates folder tree and uploads idempotently', async () => {
  const files = new Map(); // id -> { name, parents, mimeType, content? }
  let seq = 1;
  const id = () => `id${seq++}`;

  const http = async (url, init = {}) => {
    const u = new URL(url, 'https://www.googleapis.com');
    const method = (init.method || 'GET').toUpperCase();
    const auth = init.headers?.Authorization || init.headers?.authorization;
    assert.ok(String(auth || '').startsWith('Bearer '));

    if (u.pathname === '/drive/v3/files' && method === 'GET') {
      const q = u.searchParams.get('q') || '';
      const nameMatch = /name = '([^']+)'/.exec(q);
      const parentMatch = /'([^']+)' in parents/.exec(q);
      const name = nameMatch?.[1];
      const parent = parentMatch?.[1];
      const found = [...files.values()].find(
        f => f.name === name && f.parents.includes(parent) && !f.trashed,
      );
      return {
        ok: true,
        status: 200,
        json: async () => ({ files: found ? [{ id: found.id, name: found.name, webViewLink: found.link }] : [] }),
        text: async () => '',
      };
    }

    if (u.pathname === '/drive/v3/files' && method === 'POST') {
      const body = JSON.parse(init.body);
      const fid = id();
      files.set(fid, {
        content: null,
        id: fid,
        link: `https://drive.google.com/drive/folders/${fid}`,
        mimeType: body.mimeType,
        name: body.name,
        parents: body.parents,
        trashed: false,
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: fid, name: body.name, webViewLink: files.get(fid).link }),
        text: async () => '',
      };
    }

    if (u.pathname.startsWith('/drive/v3/files/') && method === 'GET') {
      const fid = u.pathname.split('/').pop();
      const f = files.get(fid);
      return {
        ok: Boolean(f),
        status: f ? 200 : 404,
        json: async () => ({ id: fid, webViewLink: f?.link }),
        text: async () => '',
      };
    }

    if (u.pathname === '/upload/drive/v3/files' && method === 'POST') {
      // Multipart: extract name from JSON metadata section.
      const raw =
        typeof init.body === 'string'
          ? init.body
          : new TextDecoder().decode(init.body);
      const nameMatch = /"name"\s*:\s*"([^"]+)"/.exec(raw);
      const parentMatch = /"parents"\s*:\s*\["([^"]+)"\]/.exec(raw);
      const fid = id();
      files.set(fid, {
        content: raw.length,
        id: fid,
        link: null,
        mimeType: 'application/octet-stream',
        name: nameMatch?.[1] ?? 'file',
        parents: [parentMatch?.[1] ?? 'root'],
        trashed: false,
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: fid }),
        text: async () => '',
      };
    }

    throw new Error(`unexpected ${method} ${u.pathname}`);
  };

  const repo = createDriveCorpusRepository({
    http,
    token: { getToken: async () => 'test-token' },
  });

  const meta = validMeta();
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]).buffer;
  const first = await repo.uploadSample({
    contributorId: meta.contributorId,
    createdAt: meta.createdAt,
    image: jpeg,
    meta,
    mimeType: 'image/jpeg',
    sampleId: meta.sampleId,
  });
  assert.equal(first.alreadyExisted, false);

  const second = await repo.uploadSample({
    contributorId: meta.contributorId,
    createdAt: meta.createdAt,
    image: jpeg,
    meta,
    mimeType: 'image/jpeg',
    sampleId: meta.sampleId,
  });
  assert.equal(second.alreadyExisted, true);

  const names = [...files.values()].map(f => f.name);
  assert.ok(names.includes('Lugin'));
  assert.ok(names.includes('Scanner Corpus'));
  assert.ok(names.includes(`contributor-${meta.contributorId}`));
  assert.ok(names.includes(meta.sampleId));
  assert.ok(names.includes('metadata.json'));
  assert.ok(names.includes('image.jpg'));

  const link = await repo.ensureCorpusRootLink();
  assert.ok(link?.includes('drive.google.com'));
});

await checkAsync('web uploader uses Drive, not Worker URL', async () => {
  const src = await readFile(join(root, 'src/web/scan/corpus/uploader.ts'), 'utf8');
  assert.ok(src.includes('createDriveCorpusRepository'));
  assert.ok(src.includes('webGoogleAuth'));
  assert.ok(!src.includes('VITE_LUGIN_CORPUS_URL'));
  assert.ok(!src.includes('/v1/samples'));
});

await checkAsync('env example has no corpus Worker URL', async () => {
  const src = await readFile(join(root, '.env.example'), 'utf8');
  assert.ok(!src.includes('VITE_LUGIN_CORPUS_URL'));
  assert.ok(!src.includes('CORPUS_ADMIN_TOKEN'));
  assert.ok(src.includes('drive.file'));
});

await checkAsync('Cloudflare corpus worker is gone', async () => {
  const { existsSync } = await import('node:fs');
  assert.equal(existsSync(join(root, 'workers/corpus-ingest.js')), false);
  assert.equal(existsSync(join(root, 'wrangler.corpus.toml')), false);
});

await checkAsync('consent dialog mentions user Google Drive ownership', async () => {
  const src = await readFile(
    join(root, 'src/web/scan/corpus/CaptureConsentDialog.tsx'),
    'utf8',
  );
  assert.ok(src.includes('Google Drive'));
  assert.ok(src.includes('not automatically shared'));
});

await checkAsync('import command validates and deduplicates', async () => {
  const fixture = join(dir, 'import-src');
  const sampleId = `abcdef${Date.now().toString(16).slice(-10)}`;
  const sampleDir = join(fixture, 'contributor-x', '2026-09', sampleId);
  await mkdir(sampleDir, { recursive: true });
  const meta = {
    ...validMeta(),
    sampleId,
    eventType: 'DETECTION_TIMEOUT',
    image: {
      height: 100,
      kind: 'full-frame',
      mimeType: 'image/jpeg',
      width: 80,
    },
  };
  await writeFile(join(sampleDir, 'metadata.json'), JSON.stringify(meta));
  await writeFile(
    join(sampleDir, 'image.jpg'),
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  );

  const run = spawnSync(
    process.execPath,
    [join(root, 'scripts/scan-corpus-import.mjs'), fixture],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.ok(run.stdout.includes('imported=1'), run.stdout);

  const again = spawnSync(
    process.execPath,
    [join(root, 'scripts/scan-corpus-import.mjs'), fixture],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(again.status, 0, again.stderr || again.stdout);
  assert.ok(again.stdout.includes('skipped_dup=1') || again.stdout.includes('imported=0'));
});

await rm(dir, { force: true, recursive: true });
if (failed) {
  console.error(`\n${failed} corpus check(s) failed`);
  process.exit(1);
}
console.log('\nall corpus checks passed');
