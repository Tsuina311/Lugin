#!/usr/bin/env node
/**
 * Shared LocalRepository expectations. Today this runs against the in-memory
 * port (current native seam). The same checks should pass on Expo SQLite
 * once that APK exists.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(mobileRoot, 'src/scan/memoryRepository.ts');
const esbuild = await createRequire(join(mobileRoot, '..', 'package.json')).call(null, 'esbuild');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) return;
  failures++;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
};

const bundleDir = await mkdtemp(join(tmpdir(), 'lugin-repo-'));
const outfile = join(bundleDir, 'memoryRepository.mjs');

try {
  await esbuild.build({
    bundle: true,
    entryPoints: [entry],
    format: 'esm',
    outfile,
    platform: 'neutral',
    tsconfigRaw: {
      compilerOptions: { baseUrl: mobileRoot, paths: { '@/*': ['../src/*'] } },
    },
  });

  const { InMemoryLocalRepository } = await import(pathToFileURL(outfile).href);

  const repo = new InMemoryLocalRepository('native-test');
  const data = await repo.read();
  check('starts with empty collection', data.collection.value == null);
  check('starts with empty decks', Array.isArray(data.decks.value) && data.decks.value.length === 0);

  const at = new Date().toISOString();
  const next = {
    ...data,
    collection: {
      updatedAt: at,
      value: {
        cards: [
          {
            foil: false,
            name: 'Sol Ring',
            quantity: 2,
            scryfallId: 'abc',
            setCode: 'c21',
            source: 'import',
          },
        ],
        format: 'manabox',
        importedAt: at,
        source: 'scan',
      },
    },
  };
  await repo.write(next, ['collection']);
  const read = await repo.read();
  check('collection write is isolated', read.collection.value?.cards?.[0]?.quantity === 2);
  check('decks untouched', read.decks.value.length === 0);
  check('write log names only collection', repo.writes[0]?.[0] === 'collection');

  const meta = await repo.readMeta();
  check('device id is stable', meta.deviceId === 'native-test');
  await repo.writeMeta({ dirtyAt: at });
  const meta2 = await repo.readMeta();
  check('meta patch sticks', meta2.dirtyAt === at);

  if (failures > 0) {
    console.error(`repository-conformance smoke: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('repository-conformance smoke ok');
} finally {
  await rm(bundleDir, { force: true, recursive: true });
}
