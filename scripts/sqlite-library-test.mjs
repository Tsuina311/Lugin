// SQLite library, scan intake, and Drive reconciliation.
// Uses node:sqlite so the phone binary is not required.

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = new URL('..', import.meta.url).pathname;
const { build } = await import(pathToFileURL(join(root, 'node_modules/esbuild/lib/main.js')).href);
const out = await mkdtemp(join(tmpdir(), 'lugin-sqlite-'));
const entry = join(out, 'entry.ts');
const bundle = join(out, 'library.mjs');
await writeFile(
  entry,
  `export * from '${root}src/platform/sqlite/localRepository.ts';
   export * from '${root}src/lib/collectionIntake.ts';
   export * from '${root}src/lib/sha256.ts';
   export * from '${root}src/core/sync/engine.ts';
   export * from '${root}src/core/sync/memory.ts';
   export * from '${root}src/core/sync/serialize.ts';
   export { MIGRATIONS, SCHEMA_VERSION } from '${root}src/platform/sqlite/schema.ts';`,
);

await build({
  bundle: true,
  entryPoints: [entry],
  format: 'esm',
  outfile: bundle,
  platform: 'neutral',
  tsconfigRaw: { compilerOptions: { paths: { '@/*': [`${root}src/*`] } } },
});

const lib = await import(pathToFileURL(bundle).href);
const {
  InMemoryLocalRepository,
  InMemorySyncRepository,
  MIGRATIONS,
  SCHEMA_VERSION,
  createSqliteLocalRepository,
  createSyncEngine,
  decideScanIntake,
  mergeScanCard,
  nameOnlyCard,
  readSyncedState,
  sha256Hex,
  toSyncedState,
} = lib;

const executor = db => {
  let depth = 0;
  return {
    async all(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
    async exec(sql) {
      db.exec(sql);
    },
    async get(sql, params = []) {
      return db.prepare(sql).get(...params) ?? null;
    },
    async run(sql, params = []) {
      db.prepare(sql).run(...params);
    },
    async transaction(work) {
      if (depth > 0) return work();
      depth += 1;
      db.exec('BEGIN');
      try {
        const result = await work();
        db.exec('COMMIT');
        depth -= 1;
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        depth -= 1;
        throw error;
      }
    },
  };
};

const open = async (file, deviceId) => {
  const db = new DatabaseSync(file);
  const repo = await createSqliteLocalRepository(executor(db), {
    deviceId,
    now: () => '2026-06-01T00:00:00.000Z',
  });
  return { close: () => db.close(), repo };
};

const stored = (cards, extra = {}) => ({
  cards,
  format: 'list',
  importedAt: 1,
  source: 'test',
  ...extra,
});

const card = (name, quantity = 1, extra = {}) => ({
  foil: false,
  name,
  quantity,
  source: 'import',
  ...extra,
});

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('sha256 matches the FIPS abc vector', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('fresh database is empty and survives a restart', async () => {
  const file = join(out, 'restart.db');
  const first = await open(file, 'phone-a');
  const empty = await first.repo.read();
  assert.equal(empty.collection.value, null);
  assert.deepEqual(empty.decks.value, []);
  await first.repo.edit('collection', stored([card('Sol Ring', 2, { binderSlot: 'page-3', scryfallId: 'abc' })]));
  await first.repo.edit('decks', [
    {
      cards: [{ name: 'Lightning Bolt', quantity: 4, section: 'main' }],
      createdAt: 1,
      format: 'modern',
      id: 'deck-1',
      name: 'Burn',
      source: 'manual',
      updatedAt: 1,
    },
  ]);
  await first.repo.edit('preferences', { addPurchasesToCollection: true, homeCountry: 3, theme: 'dark' });
  await first.repo.edit('printings', { 'sol-ring': { scryfallId: 'abc', setCode: 'c21' } });
  first.close();

  const second = await open(file, 'ignored');
  const data = await second.repo.read();
  assert.equal(data.collection.value.cards[0].binderSlot, 'page-3');
  assert.equal(data.collection.value.cards[0].quantity, 2);
  assert.equal(data.decks.value[0].name, 'Burn');
  assert.equal(data.preferences.value.homeCountry, 3);
  assert.equal(data.printings.value['sol-ring'].setCode, 'c21');
  const meta = await second.repo.readMeta();
  assert.equal(meta.deviceId, 'phone-a');
  assert.ok(meta.dirtyAt);
  const found = await second.repo.searchCards('sol', 10);
  assert.equal(found[0].name, 'Sol Ring');
  const counts = await second.repo.counts();
  assert.equal(counts.copies, 2);
  assert.equal(counts.rows, 1);
  second.close();
});

test('invalid collection is rejected and the previous rows stay', async () => {
  const file = join(out, 'invalid.db');
  const { close, repo } = await open(file, 'phone-b');
  await repo.edit('collection', stored([card('Negate')]));
  await assert.rejects(() => repo.edit('collection', { cards: [{ name: '', quantity: 1 }] }));
  const data = await repo.read();
  assert.equal(data.collection.value.cards[0].name, 'Negate');
  close();
});

test('scan intake withholds, rejects a stale session, and bumps a repeat scan', () => {
  const printing = card('Lightning Bolt', 1, { collectorNumber: '146', setCode: 'm10' });
  const withheld = decideScanIntake({
    card: printing,
    committedSessionId: null,
    liveSessionId: 4,
    ownerSessionId: 4,
    status: 'insufficient-confidence',
  });
  assert.equal(withheld.ok, false);
  assert.equal(withheld.reason, 'withheld');

  const stale = decideScanIntake({
    card: printing,
    committedSessionId: null,
    liveSessionId: 5,
    ownerSessionId: 4,
    status: 'identified',
  });
  assert.equal(stale.reason, 'stale');

  const once = decideScanIntake({
    card: printing,
    committedSessionId: null,
    liveSessionId: 4,
    ownerSessionId: 4,
    status: 'identified',
  });
  assert.equal(once.ok, true);
  const again = decideScanIntake({
    card: printing,
    committedSessionId: once.sessionId,
    liveSessionId: 4,
    ownerSessionId: 4,
    status: 'identified',
  });
  assert.equal(again.reason, 'duplicate-tap');

  const manual = decideScanIntake({
    card: nameOnlyCard('Negate'),
    committedSessionId: null,
    liveSessionId: 9,
    ownerSessionId: 9,
    status: 'manual',
  });
  assert.equal(manual.ok, true);
  assert.equal(manual.card.name, 'Negate');

  let rows = [];
  rows = mergeScanCard(rows, once.card);
  const secondScan = decideScanIntake({
    card: printing,
    committedSessionId: null,
    liveSessionId: 8,
    ownerSessionId: 8,
    status: 'identified',
  });
  rows = mergeScanCard(rows, secondScan.card);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 2);
});

test('a phone pulls a desktop library and a later phone edit pushes back', async () => {
  const remote = new InMemorySyncRepository();
  const desktop = new InMemoryLocalRepository('desktop');
  desktop.edit(
    'collection',
    stored([card('Sol Ring', 1, { scryfallId: 'keep-me', setCode: 'c21' })]),
    '2026-05-01T00:00:00.000Z',
  );
  desktop.edit(
    'decks',
    [
      {
        cards: [{ name: 'Sol Ring', quantity: 1, section: 'main' }],
        createdAt: 1,
        format: 'commander',
        id: 'd1',
        name: 'From desktop',
        source: 'manual',
        updatedAt: 1,
      },
    ],
    '2026-05-01T00:00:00.000Z',
  );
  const desktopEngine = createSyncEngine({
    local: desktop,
    now: () => '2026-05-01T00:00:00.000Z',
    remote,
  });
  await desktopEngine.sync();

  const phoneFile = join(out, 'phone.db');
  const phone = await open(phoneFile, 'phone-c');
  const phoneEngine = createSyncEngine({
    local: phone.repo,
    now: () => '2026-05-02T00:00:00.000Z',
    remote,
  });
  const pulled = await phoneEngine.sync();
  assert.ok(pulled.applied.includes('collection'));
  const afterPull = await phone.repo.read();
  assert.equal(afterPull.collection.value.cards[0].scryfallId, 'keep-me');
  assert.equal(afterPull.decks.value[0].name, 'From desktop');

  await phone.repo.edit(
    'collection',
    stored([card('Sol Ring', 3, { scryfallId: 'keep-me', setCode: 'c21' })]),
  );
  const pushed = await phoneEngine.sync();
  assert.ok(pushed.pushed.includes('collection'));
  const other = new InMemoryLocalRepository('desktop-2');
  const otherEngine = createSyncEngine({
    local: other,
    now: () => '2026-05-03T00:00:00.000Z',
    remote,
  });
  await otherEngine.sync();
  assert.equal(other.snapshot().collection.value.cards[0].quantity, 3);

  const round = toSyncedState(await phone.repo.read(), 'phone-c');
  const text = JSON.stringify(round);
  const parsed = readSyncedState(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.state.data.collection.value.cards[0].scryfallId, 'keep-me');
  phone.close();
});

test('a Drive document keeps card and printing fields through SQLite', async () => {
  const document = {
    data: {
      collection: {
        updatedAt: '2026-04-01T00:00:00.000Z',
        value: {
          cards: [
            {
              binderSlot: 'p1',
              foil: false,
              name: 'Birds of Paradise',
              quantity: 1,
              scryfallId: 'bird',
              setCode: 'm12',
              source: 'import',
            },
          ],
          format: 'manabox',
          importedAt: 10,
          shelf: 'box-a',
          source: 'manabox',
        },
      },
      decks: {
        updatedAt: '2026-04-01T00:00:00.000Z',
        value: [
          {
            cards: [{ name: 'Birds of Paradise', printing: { scryfallId: 'bird' }, quantity: 1, section: 'main' }],
            createdAt: 1,
            format: 'commander',
            id: 'deck-bird',
            name: 'Birds',
            source: 'manual',
            updatedAt: 1,
          },
        ],
      },
      preferences: {
        updatedAt: '2026-04-01T00:00:00.000Z',
        value: { addPurchasesToCollection: false, currency: 'EUR', homeCountry: 3, theme: 'dark' },
      },
      printings: {
        updatedAt: '2026-04-01T00:00:00.000Z',
        value: { birds: { note: 'keep', scryfallId: 'bird', setCode: 'm12' } },
      },
    },
    deviceId: 'pwa',
    schemaVersion: 1,
    updatedAt: '2026-04-01T00:00:00.000Z',
  };
  const parsed = readSyncedState(JSON.stringify(document));
  assert.equal(parsed.ok, true);
  const phone = await open(join(out, 'drive.db'), 'phone-d');
  await phone.repo.write(parsed.state.data, ['collection', 'decks', 'preferences', 'printings']);
  const data = await phone.repo.read();
  assert.equal(data.collection.value.cards[0].binderSlot, 'p1');
  assert.equal(data.collection.value.shelf, 'box-a');
  assert.equal(data.collection.value.format, 'manabox');
  assert.equal(data.decks.value[0].cards[0].printing.scryfallId, 'bird');
  assert.equal(data.preferences.value.homeCountry, 3);
  assert.equal(data.preferences.value.currency, 'EUR');
  assert.equal(data.printings.value.birds.note, 'keep');
  const again = readSyncedState(JSON.stringify(toSyncedState(data, 'phone-d')));
  assert.equal(again.ok, true);
  assert.equal(again.state.data.collection.value.cards[0].binderSlot, 'p1');
  assert.equal(again.state.data.collection.value.shelf, 'box-a');
  assert.equal(again.state.data.preferences.value.currency, 'EUR');
  assert.equal(again.state.data.printings.value.birds.note, 'keep');
  phone.close();
});

test('a version-1 database gains the scryfall index without losing rows', async () => {
  assert.equal(SCHEMA_VERSION, 2);
  const file = join(out, 'upgrade.db');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(MIGRATIONS[0]);
  db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY NOT NULL)');
  db.prepare('INSERT INTO schema_migrations (version) VALUES (1)').run();
  db.prepare(
    `INSERT INTO domains (key, updated_at, payload) VALUES ('collection', ?, ?)`,
  ).run('2026-01-01T00:00:00.000Z', JSON.stringify({ cards: [{ foil: false, name: 'Negate', quantity: 1 }], format: 'list', importedAt: 1, source: '' }));
  db.close();
  const opened = await open(file, 'phone-upgrade');
  const version = await opened.repo.read();
  assert.equal(version.collection.value.cards[0].name, 'Negate');
  const check = new DatabaseSync(file);
  const row = check.prepare('SELECT MAX(version) AS version FROM schema_migrations').get();
  const index = check.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_collection_items_scryfall'").get();
  assert.equal(row.version, 2);
  assert.equal(index.name, 'idx_collection_items_scryfall');
  check.close();
  opened.close();
});

test('malformed remote text is not a document', () => {
  const parsed = readSyncedState('{');
  assert.equal(parsed.ok, false);
  assert.equal(parsed.reason, 'malformed');
});

test('both sides editing one domain keeps the newer stamp and archives the other', async () => {
  const remote = new InMemorySyncRepository();
  const a = new InMemoryLocalRepository('a');
  a.edit('decks', [], '2026-01-01T00:00:00.000Z');
  await createSyncEngine({ local: a, now: () => '2026-01-01T00:00:00.000Z', remote }).sync();
  const bFile = join(out, 'conflict.db');
  const b = await open(bFile, 'b');
  await createSyncEngine({ local: b.repo, now: () => '2026-01-02T00:00:00.000Z', remote }).sync();
  a.edit(
    'decks',
    [
      {
        cards: [],
        createdAt: 1,
        format: 'commander',
        id: 'from-a',
        name: 'Desktop',
        source: 'manual',
        updatedAt: 2,
      },
    ],
    '2026-02-01T00:00:00.000Z',
  );
  await b.repo.edit('decks', [
    {
      cards: [],
      createdAt: 1,
      format: 'commander',
      id: 'from-b',
      name: 'Phone',
      source: 'manual',
      updatedAt: 3,
    },
  ]);
  await createSyncEngine({ local: a, now: () => '2026-02-01T00:00:00.000Z', remote }).sync();
  const report = await createSyncEngine({
    local: b.repo,
    now: () => '2026-03-01T00:00:00.000Z',
    remote,
  }).sync();
  assert.ok(report.conflicted.includes('decks'));
  const shown = await b.repo.read();
  assert.equal(shown.decks.value[0].name, 'Phone');
  assert.equal(remote.archived.length > 0, true);
  b.close();
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`  ok ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  fail ${name}`);
    console.error(error);
  }
}
await rm(out, { force: true, recursive: true });
if (failed > 0) {
  console.error(`sqlite-library: ${failed} failed`);
  process.exit(1);
}
console.log('sqlite-library ok');
