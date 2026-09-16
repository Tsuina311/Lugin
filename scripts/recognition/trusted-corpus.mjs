/**
 * Trusted corpus for recognition bakeoff.
 * CORE_44 is frozen; EXTENDED_REAL is additional labeled captures only.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { normalizeExpectedName } from './scoring.mjs';

const MIN_WARP_BYTES = 40_000; // reject tiny/thumbnail traps

const findWarp = dir => {
  for (const name of [
    'current-warp.png',
    'recognition-card.png',
    join('recognition-card', 'recognition-card.png'),
  ]) {
    const p = join(dir, name);
    if (existsSync(p) && statSync(p).size >= MIN_WARP_BYTES) return p;
  }
  return null;
};

const loadCore44Ids = root => {
  const p = join(root, '.scan-fixtures/recognition-bakeoff/core44-ids.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8')).ids ?? [];
};

/** Discover all currently trusted labeled warps (unfiltered). */
export const discoverTrustedItems = root => {
  const out = [];
  const seen = new Set();

  const push = item => {
    const key = item.id;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };

  const replayRoot = join(root, '.scan-fixtures/replay');
  if (existsSync(replayRoot)) {
    for (const id of readdirSync(replayRoot)) {
      if (id.startsWith('.') || id === 'last-regression.json') continue;
      const dir = join(replayRoot, id);
      if (!statSync(dir).isDirectory()) continue;
      const fixturePath = join(dir, 'fixture.json');
      if (!existsSync(fixturePath)) continue;
      let fixture = {};
      try {
        fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
      } catch {
        continue;
      }
      const expectedName = normalizeExpectedName(fixture.expectedName || fixture.label);
      if (!expectedName) continue;
      const imagePath = findWarp(dir);
      if (!imagePath) continue;
      const lang =
        /french|italian|german|spanish|japanese|localized/i.test(id) ||
        /french|italian|german|spanish|japanese/i.test(String(fixture.label ?? ''))
          ? 'localized'
          : 'en';
      push({
        id: `replay:${id}`,
        source: 'replay',
        imagePath,
        expectedName,
        language: lang,
        tags: [lang, ...(fixture.tags ?? [])],
        scryfallId: fixture.scryfallId ?? null,
        oracleId: fixture.oracleId ?? null,
        quality: 'GOOD_INPUT',
      });
    }
  }

  const manifestPath = join(root, 'scripts/fixtures/cards.json');
  const cache = join(root, '.scan-fixtures');
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      for (const card of manifest.cards ?? []) {
        const png = join(cache, `${card.id}.png`);
        if (!existsSync(png) || statSync(png).size < MIN_WARP_BYTES) continue;
        push({
          id: `fixture:${card.id}`,
          source: 'fixture',
          imagePath: png,
          expectedName: normalizeExpectedName(card.expectedName),
          language: card.lang === 'en' ? 'en' : 'localized',
          tags: [card.tag, card.lang].filter(Boolean),
          scryfallId: card.id,
          oracleId: card.oracleId ?? null,
          quality: 'GOOD_INPUT',
        });
      }
    } catch {
      /* ignore */
    }
  }

  const inboxRoot = join(root, '.scan-inbox/sessions');
  if (existsSync(inboxRoot)) {
    for (const id of readdirSync(inboxRoot)) {
      if (!id.startsWith('normal-scan-session-')) continue;
      const dir = join(inboxRoot, id);
      if (!statSync(dir).isDirectory()) continue;
      let meta = null;
      for (const rel of ['metadata/metadata.json', 'metadata.json']) {
        const p = join(dir, rel);
        if (existsSync(p)) {
          try {
            meta = JSON.parse(readFileSync(p, 'utf8'));
          } catch {
            meta = null;
          }
          break;
        }
      }
      if (!meta || meta.terminalStatus !== 'FOUND') continue;
      const expectedName = normalizeExpectedName(meta.finalCard || meta.proposedCard);
      if (!expectedName) continue;
      const imagePath = findWarp(dir);
      if (!imagePath) continue;
      const lang = /[àâäéèêëïîôùûüç]/i.test(String(meta.ocr?.ocrRawText ?? ''))
        ? 'localized'
        : 'en';
      push({
        id: `inbox:${id}`,
        source: 'inbox-labeled',
        imagePath,
        expectedName,
        language: lang,
        tags: ['inbox', lang],
        scryfallId: null,
        oracleId: null,
        quality: 'GOOD_INPUT',
      });
    }
  }

  return out;
};

/**
 * @param {string} root
 * @param {{ dataset?: 'core44' | 'extended' | 'combined' }} [opts]
 */
export const selectTrustedCorpus = (root, opts = {}) => {
  const dataset = opts.dataset ?? 'core44';
  const all = discoverTrustedItems(root);
  const byId = new Map(all.map(i => [i.id, i]));
  const coreIds = loadCore44Ids(root) ?? all.map(i => i.id);

  if (dataset === 'core44') {
    const out = [];
    for (const id of coreIds) {
      const item = byId.get(id);
      if (item) out.push(item);
      else console.warn(`CORE_44 missing item: ${id}`);
    }
    return out;
  }

  const coreSet = new Set(coreIds);
  if (dataset === 'extended') {
    return all.filter(i => !coreSet.has(i.id));
  }
  // combined: core order first, then extended
  const core = selectTrustedCorpus(root, { dataset: 'core44' });
  const ext = all.filter(i => !coreSet.has(i.id));
  return [...core, ...ext];
};

/** @deprecated use selectTrustedCorpus — kept for older imports */
export { normalizeExpectedName };
