import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  FIXTURES_DIR,
  HARD_DIR,
  MANIFEST_PATH,
  SCHEMA_VERSION,
  SPLITS_PATH,
  TEST_DIR,
  TRAIN_DIR,
  VALIDATION_DIR,
  CORPUS_ROOT,
} from './paths.mjs';
import { fixtureTrustedEval, fixtureUsableForGeometry, validateFixture } from './schema.mjs';

export const ensureCorpusDirs = async () => {
  for (const d of [CORPUS_ROOT, FIXTURES_DIR, TRAIN_DIR, VALIDATION_DIR, TEST_DIR, HARD_DIR]) {
    await mkdir(d, { recursive: true });
  }
};

export const fixturePath = id => join(FIXTURES_DIR, `${id}.json`);

export const loadFixture = async idOrPath => {
  const p = idOrPath.endsWith('.json') ? idOrPath : fixturePath(idOrPath);
  const raw = JSON.parse(await readFile(p, 'utf8'));
  const errors = validateFixture(raw);
  if (errors.length) throw new Error(`${p}: ${errors.join('; ')}`);
  return raw;
};

export const saveFixture = async fixture => {
  await ensureCorpusDirs();
  const errors = validateFixture(fixture);
  if (errors.length) throw new Error(errors.join('; '));
  const p = fixturePath(fixture.id);
  const next = { ...fixture, updatedAt: new Date().toISOString() };
  await writeFile(p, `${JSON.stringify(next, null, 2)}\n`);
  return p;
};

export const listFixtures = async () => {
  if (!existsSync(FIXTURES_DIR)) return [];
  const names = (await readdir(FIXTURES_DIR)).filter(n => n.endsWith('.json'));
  const out = [];
  for (const n of names) {
    try {
      out.push(await loadFixture(join(FIXTURES_DIR, n)));
    } catch (e) {
      console.warn(`skip bad fixture ${n}: ${e.message}`);
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
};

export const writeManifest = async fixtures => {
  await ensureCorpusDirs();
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    fixtureCount: fixtures.length,
    trustedCount: fixtures.filter(fixtureTrustedEval).length,
    usableCount: fixtures.filter(f => fixtureUsableForGeometry(f).ok).length,
    hardRegressionCount: fixtures.filter(f => f.hardRegression).length,
    fixtures: fixtures.map(f => ({
      id: f.id,
      image: f.image,
      source: f.source,
      seriesId: f.seriesId,
      captureGroup: f.captureGroup,
      trusted: f.trusted,
      hardRegression: f.hardRegression,
      split: f.split,
      tags: f.tags,
      cards: f.cards?.length ?? 0,
      usable: fixtureUsableForGeometry(f).ok,
      trustedEval: fixtureTrustedEval(f),
    })),
  };
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
};

/**
 * Deterministic 70/15/15 split by captureGroup hash.
 * Related frames from the same series stay together.
 */
export const assignSplits = (fixtures, { train = 0.7, validation = 0.15 } = {}) => {
  const groups = new Map();
  for (const f of fixtures) {
    const g = f.captureGroup || f.seriesId || f.id;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(f);
  }
  const ordered = [...groups.keys()].sort((a, b) => {
    const ha = createHash('sha256').update(a).digest('hex');
    const hb = createHash('sha256').update(b).digest('hex');
    return ha.localeCompare(hb);
  });
  const n = ordered.length || 1;
  const nTrain = Math.max(1, Math.floor(n * train));
  const nVal = Math.max(0, Math.floor(n * validation));
  const splits = { train: [], validation: [], test: [], hard: [] };
  ordered.forEach((g, i) => {
    let split = 'test';
    if (i < nTrain) split = 'train';
    else if (i < nTrain + nVal) split = 'validation';
    for (const f of groups.get(g)) {
      if (f.hardRegression || f.tags?.includes('hard-case')) {
        splits.hard.push(f.id);
      }
      splits[split].push(f.id);
      f.split = split;
    }
  });
  return { splits, fixtures };
};

export const writeSplits = async (fixtures, splitResult) => {
  await ensureCorpusDirs();
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    policy: {
      train: 0.7,
      validation: 0.15,
      test: 0.15,
      groupBy: 'captureGroup',
      note:
        fixtures.length < 30
          ? 'Corpus is small — splits are structural only, not statistically significant.'
          : 'Deterministic hash split by capture series.',
    },
    ...splitResult.splits,
  };
  await writeFile(SPLITS_PATH, `${JSON.stringify(payload, null, 2)}\n`);

  // Lightweight pointer files in split dirs (no image copies).
  for (const [name, dir] of [
    ['train', TRAIN_DIR],
    ['validation', VALIDATION_DIR],
    ['test', TEST_DIR],
    ['hard', HARD_DIR],
  ]) {
    const ids = splitResult.splits[name] ?? [];
    await writeFile(join(dir, 'fixtures.json'), `${JSON.stringify({ ids }, null, 2)}\n`);
  }

  for (const f of splitResult.fixtures) {
    await saveFixture(f);
  }
  return payload;
};

export const loadSplits = async () => {
  if (!existsSync(SPLITS_PATH)) return null;
  return JSON.parse(await readFile(SPLITS_PATH, 'utf8'));
};
