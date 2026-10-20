// Rules-level tests for the sync core, run with `yarn test:sync`.
//
// The core deliberately has no browser dependencies, so it can be bundled and
// exercised in plain node — two in-memory devices sharing one in-memory cloud,
// which is the only honest way to test "we both edited it".

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const { build } = await import(pathToFileURL(join(root, 'node_modules/esbuild/lib/main.js')).href);

const out = await mkdtemp(join(tmpdir(), 'lugin-sync-'));
const entry = join(out, 'entry.ts');
await writeFile(
  entry,
  `export * from '${root}src/core/sync/model';
   export * from '${root}src/core/sync/auth';
   export * from '${root}src/core/sync/drive';
   export * from '${root}src/core/sync/engine';
   export * from '${root}src/core/sync/memory';
   export * from '${root}src/core/sync/repository';
   export * from '${root}src/core/sync/serialize';
   export * from '${root}src/platform/web/localRepository';
   export * from '${root}src/platform/google/androidRedirect';
   export * from '${root}src/platform/secure/tokenVault';`,
);

const bundle = join(out, 'sync.mjs');
await build({
  bundle: true,
  entryPoints: [entry],
  format: 'esm',
  outfile: bundle,
  platform: 'neutral',
  tsconfigRaw: { compilerOptions: { paths: { '@/*': [`${root}src/*`] } } },
});

const {
  ConflictError,
  InMemoryLocalRepository,
  InMemorySyncRepository,
  SYNC_SCHEMA_VERSION,
  createDriveRepository,
  createSyncEngine,
  createWebLocalRepository,
  emptyData,
  googleAndroidRedirect,
  migrateLegacyToken,
  readSyncedState,
  toSyncedState,
  writeSecureToken,
} = await import(pathToFileURL(bundle).href);

const at = n => new Date(Date.UTC(2026, 0, n)).toISOString();
const deck = name => ({ cards: [], createdAt: 1, id: name, name, updatedAt: 1 });
const prefs = over => ({
  addPurchasesToCollection: false,
  homeCountry: null,
  theme: 'dark',
  ...over,
});

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('an empty cloud is seeded from this device, preferences included', async () => {
  const local = new InMemoryLocalRepository('desktop', emptyData(at(1)));
  local.edit('preferences', prefs({ homeCountry: 12, theme: 'site' }), at(2));
  const remote = new InMemorySyncRepository();

  const report = await createSyncEngine({ local, now: () => at(3), remote }).sync();

  assert.equal(report.seeded, true);
  const stored = readSyncedState(remote.peek());
  assert.equal(stored.ok, true);
  assert.deepEqual(stored.state.data.preferences.value, prefs({ homeCountry: 12, theme: 'site' }));
  assert.equal(stored.state.schemaVersion, SYNC_SCHEMA_VERSION);
});

test("a domain only the other device touched arrives, and nothing else is written", async () => {
  const remote = new InMemorySyncRepository();
  const desktop = new InMemoryLocalRepository('desktop', emptyData(at(1)));
  const engine = () => createSyncEngine({ local: desktop, now: () => at(9), remote });
  await engine().sync();

  // The phone starts from the same document, adds a deck, and pushes.
  const phone = new InMemoryLocalRepository('phone', emptyData(at(1)));
  await createSyncEngine({ local: phone, now: () => at(2), remote }).sync();
  phone.edit('decks', [deck('phone-deck')], at(4));
  await createSyncEngine({ local: phone, now: () => at(4), remote }).sync();

  const report = await engine().sync();

  assert.deepEqual(report.applied, ['decks']);
  assert.deepEqual(report.conflicted, []);
  assert.deepEqual(desktop.snapshot().decks.value, [deck('phone-deck')]);
  // Only decks was written locally: a deck edit must not rewrite the collection.
  assert.deepEqual(desktop.writes, [['decks']]);
});

test('the same domain edited in both places keeps the later one and shelves the other', async () => {
  const remote = new InMemorySyncRepository();
  const desktop = new InMemoryLocalRepository('desktop', emptyData(at(1)));
  const phone = new InMemoryLocalRepository('phone', emptyData(at(1)));
  await createSyncEngine({ local: desktop, now: () => at(1), remote }).sync();
  await createSyncEngine({ local: phone, now: () => at(1), remote }).sync();

  phone.edit('decks', [deck('from-phone')], at(5));
  await createSyncEngine({ local: phone, now: () => at(5), remote }).sync();

  desktop.edit('decks', [deck('from-desktop')], at(6));
  const report = await createSyncEngine({ local: desktop, now: () => at(7), remote }).sync();

  assert.deepEqual(report.conflicted, ['decks']);
  assert.deepEqual(report.pushed, ['decks']);
  assert.deepEqual(desktop.snapshot().decks.value, [deck('from-desktop')]);
  // The version that lost is still recoverable.
  assert.deepEqual(remote.archived[0].domain, 'decks');
  assert.deepEqual(remote.archived[0].value, [deck('from-phone')]);
});

test('edits to different domains both survive', async () => {
  const remote = new InMemorySyncRepository();
  const desktop = new InMemoryLocalRepository('desktop', emptyData(at(1)));
  const phone = new InMemoryLocalRepository('phone', emptyData(at(1)));
  await createSyncEngine({ local: desktop, now: () => at(1), remote }).sync();
  await createSyncEngine({ local: phone, now: () => at(1), remote }).sync();

  phone.edit('preferences', prefs({ theme: 'site' }), at(4));
  await createSyncEngine({ local: phone, now: () => at(4), remote }).sync();

  desktop.edit('decks', [deck('local')], at(5));
  const report = await createSyncEngine({ local: desktop, now: () => at(6), remote }).sync();

  assert.deepEqual(report.conflicted, []);
  assert.deepEqual(report.applied, ['preferences']);
  assert.deepEqual(report.pushed, ['decks']);
  assert.equal(desktop.snapshot().preferences.value.theme, 'site');

  const stored = readSyncedState(remote.peek());
  assert.deepEqual(stored.state.data.decks.value, [deck('local')]);
  assert.equal(stored.state.data.preferences.value.theme, 'site');
});

test('a write that lost a race is retried against the newer document', async () => {
  const remote = new InMemorySyncRepository();
  const desktop = new InMemoryLocalRepository('desktop', emptyData(at(1)));
  await createSyncEngine({ local: desktop, now: () => at(1), remote }).sync();

  // Another device slips a revision in between our read and our write, once.
  const save = remote.save.bind(remote);
  let interfered = false;
  remote.save = (state, base) => {
    if (!interfered) {
      interfered = true;
      const current = readSyncedState(remote.peek()).state;
      save({ ...current, deviceId: 'phone' }, base);
      return save(state, base); // now stale: throws ConflictError
    }
    return save(state, base);
  };

  desktop.edit('decks', [deck('mine')], at(3));
  const report = await createSyncEngine({ local: desktop, now: () => at(4), remote }).sync();

  assert.equal(interfered, true);
  assert.deepEqual(report.pushed, ['decks']);
  assert.deepEqual(readSyncedState(remote.peek()).state.data.decks.value, [deck('mine')]);
});

test('a document from a newer version is refused, not half-read', async () => {
  const future = JSON.stringify({
    ...toSyncedState(emptyData(at(1)), 'phone'),
    schemaVersion: SYNC_SCHEMA_VERSION + 1,
  });
  const read = readSyncedState(future);
  assert.equal(read.ok, false);
  assert.equal(read.reason, 'unsupported-schema');
});

test('junk and missing pieces read as absent rather than throwing', async () => {
  assert.equal(readSyncedState('not json').ok, false);
  assert.equal(readSyncedState({ schemaVersion: 'one' }).reason, 'malformed');

  const partial = readSyncedState({
    data: { decks: { updatedAt: at(2), value: [deck('a'), 'rubbish', { id: 7 }] } },
    schemaVersion: SYNC_SCHEMA_VERSION,
  });
  assert.equal(partial.ok, true);
  assert.deepEqual(partial.state.data.decks.value, [deck('a')]);
  // A domain the writer never sent loses to whatever the reader has.
  assert.equal(partial.state.data.collection.updatedAt, new Date(0).toISOString());
});

// --- the phone's local repository -------------------------------------------
// Run for real, not mocked. There is no IndexedDB in node, and the repository is
// built to fall back to memory when it can't open a store — so what these
// exercise is the same code the phone runs, minus persistence between calls,
// which is exactly the seam that fallback creates.

const stored = cards => ({ cards, format: 'manabox', importedAt: 1, source: 'ManaBox.csv' });
const card = (name, over) => ({ foil: false, name, quantity: 1, ...over });

test('a phone with no usable store says so rather than failing', async () => {
  const phone = createWebLocalRepository(() => at(1));
  // Still a working device for the session: a locked-down browser is a warning,
  // not an error screen.
  const data = await phone.read();
  assert.equal(data.collection.value, null);
  assert.equal(data.collection.updatedAt, new Date(0).toISOString());
  assert.equal(phone.persistent(), false, 'and it admits nothing will be kept');

  await phone.edit('collection', stored([card('Sol Ring')]));
  assert.deepEqual((await phone.read()).collection.value.cards, [card('Sol Ring')]);
});

test('a fresh phone mints one device id and keeps it', async () => {
  const phone = createWebLocalRepository(() => at(1));
  const first = await phone.readMeta();
  assert.match(first.deviceId, /\S/);
  assert.equal((await phone.readMeta()).deviceId, first.deviceId);
});

test('an import on the phone reaches the desktop', async () => {
  const remote = new InMemorySyncRepository();
  const desktop = new InMemoryLocalRepository('desktop', emptyData(at(1)));
  desktop.edit('collection', stored([card('Sol Ring')]), at(2));
  await createSyncEngine({ local: desktop, now: () => at(2), remote }).sync();

  // The phone picks the collection up, then a ManaBox scan is imported on it.
  const phone = createWebLocalRepository(() => at(5));
  await createSyncEngine({ local: phone, now: () => at(3), remote }).sync();
  assert.deepEqual((await phone.read()).collection.value.cards, [card('Sol Ring')]);

  await phone.edit('collection', stored([card('Sol Ring'), card('Rhystic Study')]));
  assert.equal((await phone.readMeta()).dirtyAt, at(5), 'an edit is marked for pushing');

  const push = await createSyncEngine({ local: phone, now: () => at(5), remote }).sync();
  assert.deepEqual(push.pushed, ['collection']);
  assert.equal((await phone.readMeta()).dirtyAt, null, 'and unmarked once pushed');

  const report = await createSyncEngine({ local: desktop, now: () => at(6), remote }).sync();
  assert.deepEqual(report.applied, ['collection']);
  assert.deepEqual(desktop.snapshot().collection.value.cards.map(c => c.name), [
    'Sol Ring',
    'Rhystic Study',
  ]);
});

test('adopting a deck from the desktop leaves the phone’s collection alone', async () => {
  const remote = new InMemorySyncRepository();
  const phone = createWebLocalRepository(() => at(4));
  await phone.edit('collection', stored([card('Sol Ring')]));
  await createSyncEngine({ local: phone, now: () => at(4), remote }).sync();

  const desktop = new InMemoryLocalRepository('desktop', emptyData(at(1)));
  await createSyncEngine({ local: desktop, now: () => at(5), remote }).sync();
  desktop.edit('decks', [deck('desktop-deck')], at(6));
  await createSyncEngine({ local: desktop, now: () => at(6), remote }).sync();

  const report = await createSyncEngine({ local: phone, now: () => at(7), remote }).sync();

  assert.ok(report.applied.includes('decks'));
  const data = await phone.read();
  assert.deepEqual(data.decks.value, [deck('desktop-deck')]);
  // The stamp is what proves it: a restamped collection would be pushed back on
  // the next sync as though the phone had edited it.
  assert.equal(data.collection.updatedAt, at(4));
  assert.deepEqual(data.collection.value.cards, [card('Sol Ring')]);
});

test('a phone import and a desktop import of the same day are a conflict, not a silent loss', async () => {
  const remote = new InMemorySyncRepository();
  const phone = createWebLocalRepository(() => at(5));
  const desktop = new InMemoryLocalRepository('desktop', emptyData(at(1)));
  await createSyncEngine({ local: phone, now: () => at(2), remote }).sync();
  await createSyncEngine({ local: desktop, now: () => at(2), remote }).sync();

  await phone.edit('collection', stored([card('from-phone')]));
  await createSyncEngine({ local: phone, now: () => at(5), remote }).sync();

  desktop.edit('collection', stored([card('from-desktop')]), at(6));
  const report = await createSyncEngine({ local: desktop, now: () => at(7), remote }).sync();

  assert.ok(report.conflicted.includes('collection'));
  // The phone's scan is the one at risk here, and it is still recoverable.
  const shelved = remote.archived.find(a => a.domain === 'collection');
  assert.deepEqual(shelved.value.cards, [card('from-phone')]);
});

// --- Drive client -----------------------------------------------------------
// A stand-in for the appDataFolder: enough of the three endpoints the client
// actually uses to catch the things that would only otherwise fail in a browser
// against a real account.
const fakeDrive = () => {
  const files = new Map();
  let nextId = 1;
  const body = raw => raw.split(/\r\n--lugin-sync-boundary(?:--)?\r\n/).filter(Boolean);

  const http = async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url);
    const method = init.method ?? 'GET';
    calls.push(`${method} ${pathname}`);

    if (!/^Bearer /.test(init.headers?.Authorization ?? '')) {
      return new Response('no token', { status: 401 });
    }
    if (init.headers.Authorization === 'Bearer stale') {
      return new Response('expired', { status: 401 });
    }

    if (method === 'GET' && pathname === '/drive/v3/files') {
      const wanted = /name = '([^']+)'/.exec(searchParams.get('q'))[1];
      const found = [...files.values()].filter(f => f.name === wanted);
      return Response.json({ files: found.map(f => ({ id: f.id, version: f.version })) });
    }
    if (method === 'GET' && pathname.startsWith('/drive/v3/files/')) {
      const file = files.get(pathname.split('/').pop());
      return file ? new Response(file.content) : new Response('gone', { status: 404 });
    }
    if (method === 'POST' && pathname === '/upload/drive/v3/files') {
      const [meta, content] = body(init.body);
      const id = `file-${nextId++}`;
      const file = { content: content.split('\r\n\r\n')[1], id, name: JSON.parse(meta.split('\r\n\r\n')[1]).name, version: '1' };
      files.set(id, file);
      return Response.json({ id, version: file.version });
    }
    if (method === 'PATCH' && pathname.startsWith('/upload/drive/v3/files/')) {
      const file = files.get(pathname.split('/').pop());
      file.content = init.body;
      file.version = String(Number(file.version) + 1);
      return Response.json({ id: file.id, version: file.version });
    }
    return new Response('unexpected', { status: 500 });
  };

  const calls = [];
  return { calls, files, http };
};

const tokens = (...sequence) => {
  let n = 0;
  return { getToken: async () => sequence[Math.min(n++, sequence.length - 1)] };
};

test('a first save creates the document, and a load reads it straight back', async () => {
  const drive = fakeDrive();
  const repo = createDriveRepository({ http: drive.http, token: tokens('good') });

  assert.equal(await repo.load(), null);
  const saved = await repo.save(toSyncedState(emptyData(at(1)), 'desktop'), null);
  assert.equal(saved.revision, '1');

  const loaded = await repo.load();
  assert.equal(loaded.revision, '1');
  assert.equal(loaded.state.deviceId, 'desktop');
  assert.equal([...drive.files.values()][0].name, 'app-state.json');
});

test('saving against a revision that has moved on is a conflict, not an overwrite', async () => {
  const drive = fakeDrive();
  const repo = createDriveRepository({ http: drive.http, token: tokens('good') });
  await repo.save(toSyncedState(emptyData(at(1)), 'desktop'), null);

  // Someone else's write lands in between.
  await repo.save(toSyncedState(emptyData(at(2)), 'phone'), '1');

  await assert.rejects(
    () => repo.save(toSyncedState(emptyData(at(3)), 'desktop'), '1'),
    err => err instanceof ConflictError,
  );
  // The phone's version is still there, untouched.
  assert.equal((await repo.load()).state.deviceId, 'phone');
});

test('an expired token is refreshed once rather than surfacing as a failure', async () => {
  const drive = fakeDrive();
  const repo = createDriveRepository({ http: drive.http, token: tokens('stale', 'good') });

  const saved = await repo.save(toSyncedState(emptyData(at(1)), 'desktop'), null);
  assert.equal(saved.revision, '1');
});

test('unknown fields on every domain survive a shared parse', () => {
  const document = {
    data: {
      collection: {
        updatedAt: at(2),
        value: {
          cards: [{ binderSlot: 'p1', foil: false, name: 'Birds of Paradise', quantity: 1 }],
          format: 'list',
          importedAt: 1,
          shelf: 'box-a',
          source: 'pwa',
        },
      },
      decks: {
        updatedAt: at(2),
        value: [{ cards: [{ name: 'Birds of Paradise', printing: { scryfallId: 'bird' }, quantity: 1 }], id: 'd', note: 'keep' }],
      },
      preferences: {
        updatedAt: at(2),
        value: { addPurchasesToCollection: true, currency: 'EUR', homeCountry: 3, theme: 'dark' },
      },
      printings: {
        updatedAt: at(2),
        value: { birds: { note: 'keep', scryfallId: 'bird' } },
      },
    },
    deviceId: 'pwa',
    schemaVersion: 1,
    updatedAt: at(2),
  };
  const parsed = readSyncedState(JSON.stringify(document));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.state.data.collection.value.shelf, 'box-a');
  assert.equal(parsed.state.data.collection.value.cards[0].binderSlot, 'p1');
  assert.equal(parsed.state.data.decks.value[0].note, 'keep');
  assert.equal(parsed.state.data.decks.value[0].cards[0].printing.scryfallId, 'bird');
  assert.equal(parsed.state.data.preferences.value.currency, 'EUR');
  assert.equal(parsed.state.data.preferences.value.homeCountry, 3);
  assert.equal(parsed.state.data.printings.value.birds.note, 'keep');
  const again = readSyncedState(JSON.stringify(toSyncedState(parsed.state.data, 'native')));
  assert.equal(again.ok, true);
  assert.equal(again.state.data.preferences.value.currency, 'EUR');
  assert.equal(again.state.data.collection.value.shelf, 'box-a');
});

test('a newer empty remote collection replaces the local cards', async () => {
  const remote = new InMemorySyncRepository();
  const desktop = new InMemoryLocalRepository('desktop', emptyData(at(1)));
  desktop.edit('collection', { cards: [{ foil: false, name: 'Sol Ring', quantity: 1 }], format: 'list', importedAt: 1, source: '' }, at(2));
  await createSyncEngine({ local: desktop, now: () => at(2), remote }).sync();
  const phone = new InMemoryLocalRepository('phone', emptyData(at(1)));
  await createSyncEngine({ local: phone, now: () => at(3), remote }).sync();
  desktop.edit('collection', null, at(5));
  await createSyncEngine({ local: desktop, now: () => at(5), remote }).sync();
  await createSyncEngine({ local: phone, now: () => at(6), remote }).sync();
  assert.equal(phone.snapshot().collection.value, null);
});

test('the Android redirect is the reversed client id, not the app scheme', () => {
  const redirect = googleAndroidRedirect('123-abc.apps.googleusercontent.com');
  assert.equal(redirect.scheme, 'com.googleusercontent.apps.123-abc');
  assert.equal(redirect.redirectUri, 'com.googleusercontent.apps.123-abc:/oauth2redirect');
  assert.equal(googleAndroidRedirect('not-a-google-client'), null);
});

test('a plaintext token moves to secure storage and stays if the write fails', async () => {
  const memory = new Map();
  const store = {
    delete: async key => {
      memory.delete(key);
    },
    get: async key => memory.get(key) ?? null,
    set: async (key, value) => {
      memory.set(key, value);
    },
  };
  let file = JSON.stringify({ accessToken: 'access', expiresAt: 10, refreshToken: 'refresh' });
  const legacy = {
    read: async () => file,
    remove: async () => {
      file = null;
    },
  };
  const moved = await migrateLegacyToken(store, legacy);
  assert.equal(moved.accessToken, 'access');
  assert.equal(moved.refreshToken, 'refresh');
  assert.equal(file, null);

  file = JSON.stringify({ accessToken: 'old', expiresAt: 11, refreshToken: 'old-refresh' });
  const broken = {
    delete: async () => {},
    get: async () => null,
    set: async () => {},
  };
  await assert.rejects(() => migrateLegacyToken(broken, legacy));
  assert.equal(JSON.parse(file).accessToken, 'old');
  await writeSecureToken(store, null);
  assert.equal(memory.size, 0);
});

test('an overwritten version is kept as its own file', async () => {
  const drive = fakeDrive();
  const repo = createDriveRepository({ http: drive.http, token: tokens('good') });

  await repo.archiveConflict('decks', [deck('older')], at(4));

  const [file] = [...drive.files.values()];
  assert.match(file.name, /^conflict-decks-/);
  assert.deepEqual(JSON.parse(file.content).value, [deck('older')]);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`fail  ${name}\n      ${err.message}`);
  }
}
await rm(out, { force: true, recursive: true });
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed === 0 ? 0 : 1);
