/**
 * Canonical expected-name / oracle identity scoring for recognition bakeoff.
 * Prefer oracleId equality; fall back to folded name match.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Short / OCR-ish labels → canonical English card names. */
export const EXPECTED_ALIASES = {
  "epee datre et de foyer": 'Sword of Hearth and Home',
  "epee d'atre et de foyer": 'Sword of Hearth and Home',
  "épée d'âtre et de foyer": 'Sword of Hearth and Home',
  'teferi veil': "Teferi's Veil",
  "teferi's veil": "Teferi's Veil",
  'negate unsleeved': 'Negate',
  negate: 'Negate',
  'maddening hex': 'Maddening Hex',
};

/** Same fold as CardNameIndex — apostrophes dropped, letters+digits kept. */
export const foldName = raw =>
  String(raw || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]/gu, '');

export const normalizeExpectedName = raw => {
  let s = String(raw || '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const foldKey = s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9'+]+/g, ' ')
    .trim();
  if (EXPECTED_ALIASES[foldKey] || EXPECTED_ALIASES[s.toLowerCase()]) {
    return EXPECTED_ALIASES[foldKey] || EXPECTED_ALIASES[s.toLowerCase()];
  }
  return s;
};

let nameOracleCache = null;

const loadNameOracleMap = root => {
  if (nameOracleCache) return nameOracleCache;
  const map = new Map();
  const artPath = join(root, '.scan-fixtures/art-index.production.json');
  if (existsSync(artPath)) {
    const art = JSON.parse(readFileSync(artPath, 'utf8'));
    for (const e of art.art?.entries ?? []) {
      if (!e.name || !e.oracleId) continue;
      const k = foldName(e.name);
      if (!map.has(k)) map.set(k, { oracleId: e.oracleId, canonicalName: e.name });
      // Also index front face of DFC "A // B"
      if (e.name.includes(' // ')) {
        const front = e.name.split(' // ')[0];
        const fk = foldName(front);
        if (!map.has(fk)) map.set(fk, { oracleId: e.oracleId, canonicalName: e.name });
      }
    }
  }
  const namesPath = join(root, '.scan-fixtures/card-names.json');
  if (existsSync(namesPath)) {
    const data = JSON.parse(readFileSync(namesPath, 'utf8'));
    for (const e of data.entries ?? data.cards ?? []) {
      const name = e.name ?? e.n;
      const oracleId = e.oracleId ?? e.oracle_id ?? null;
      if (!name) continue;
      const k = foldName(name);
      if (!map.has(k) && oracleId) map.set(k, { oracleId, canonicalName: name });
    }
  }
  nameOracleCache = map;
  return map;
};

/**
 * Resolve a corpus item / raw label to { oracleId, canonicalName, fold }.
 */
export const resolveExpected = (root, itemOrName) => {
  const raw =
    typeof itemOrName === 'string'
      ? itemOrName
      : itemOrName?.expectedName ?? itemOrName?.canonicalName ?? '';
  const canonicalName = normalizeExpectedName(raw);
  const fold = foldName(canonicalName);
  const map = loadNameOracleMap(root);
  const hit = map.get(fold);
  const fromItem =
    typeof itemOrName === 'object' && itemOrName?.oracleId ? itemOrName.oracleId : null;
  return {
    canonicalName,
    fold,
    oracleId: fromItem || hit?.oracleId || null,
    resolvedName: hit?.canonicalName ?? canonicalName,
  };
};

/** True if prediction matches expected by oracleId or folded name. */
export const identityMatches = (expected, prediction) => {
  if (!expected || !prediction) return false;
  if (expected.oracleId && prediction.oracleId && expected.oracleId === prediction.oracleId) {
    return true;
  }
  const a = foldName(expected.canonicalName ?? expected.name ?? expected.resolvedName);
  const b = foldName(prediction.name ?? prediction.canonicalName);
  if (a && b && a === b) return true;
  // DFC: expected full name vs front-only prediction (or reverse).
  if (a && b && (a.startsWith(b) || b.startsWith(a)) && Math.min(a.length, b.length) >= 8) {
    return true;
  }
  return false;
};

export const rankHasMatch = (expected, ranked, k) =>
  (ranked ?? []).slice(0, k).some(c => identityMatches(expected, c));
