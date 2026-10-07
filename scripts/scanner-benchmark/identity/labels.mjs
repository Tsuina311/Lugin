/**
 * Identity labels for trusted phone frames.
 * Titles were read from the printed card, then matched to gallery names.
 * Embedding predictions are not labels.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { rootDir } from '../lib/paths.mjs';
import { isCompleteQuad } from '../../geometry/lib/schema.mjs';

const fold = value =>
  String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Printed-title resolutions for the October 2026 geometry-test photos. */
const PRINTED = {
  'geometry-test-20261006-150559 geom-001': ['Yuriko, the Tiger\'s Shadow', true],
  'geometry-test-20261006-150559 geom-002': ['Yuriko, the Tiger\'s Shadow', true],
  'geometry-test-20261006-150559 geom-003': ['Swamp', true],
  'geometry-test-20261006-150559 geom-004': ['Yuriko, the Tiger\'s Shadow', true],
  'geometry-test-20261006-150559 geom-005': ['Yuriko, the Tiger\'s Shadow', true],
  'geometry-test-20261006-150559 geom-006': ['Island', true],
  'geometry-test-20261006-150559 geom-007': ['Moonsnare Specialist', false],
  'geometry-test-20261006-150559 geom-008': ['Moonsnare Specialist', false],
  'geometry-test-20261006-150559 geom-009': ['Moonsnare Specialist', false],
  'geometry-test-20261006-150559 geom-010': ['Kaito, Bane of Nightmares', false],
  'geometry-test-20261006-150559 geom-011': ['Island', true],
  'geometry-test-20261006-150559 geom-012': ['Island', true],
  'geometry-test-20261006-150559 geom-013': ['Agent of the Shadow Thieves', true],
  'geometry-test-20261006-150559 geom-014': ['Darkwater Catacombs', false],
  'geometry-test-20261006-150559 geom-015': ['Drowned Catacomb', false],
  'geometry-test-20261006-150559 geom-016': ['Island', true],
  'geometry-test-20261006-152155 geom-001': ['Drowned Catacomb', false],
  'geometry-test-20261006-152155 geom-002': ['Darkwater Catacombs', false],
  'geometry-test-20261006-152155 geom-003': ['Kaito, Bane of Nightmares', false],
  'geometry-test-20261006-152155 geom-004': ['Moonsnare Specialist', false],
  'geometry-test-20261006-152155 geom-005': ['Swamp', true],
  'geometry-test-20261006-152155 geom-006': ['Swamp', true],
  'geometry-test-20261006-152155 geom-007': ['Island', false],
  'geometry-test-20261006-152155 geom-008': ['Index', true],
  'geometry-test-20261006-152155 geom-009': ['Chasm Skulker', false],
  'geometry-test-20261006-152155 geom-010': ['Daze', true],
  'geometry-test-20261006-152155 geom-011': ['Silver-Fur Master', false],
  'geometry-test-20261006-152155 geom-012': ['Wingcrafter', false],
  'geometry-test-20261006-152155 geom-013': ['Island', true],
  'geometry-test-20261006-152155 geom-014': ['Saiba Cryptomancer', true],
  'geometry-test-20261006-152155 geom-015': ['Command Tower', false],
  'geometry-test-20261006-152155 geom-016': ['Pilgrim\'s Eye', false],
  'geometry-test-20261006-152155 geom-017': ['Mist-Syndicate Naga', false],
  'geometry-test-20261006-152155 geom-018': ['Island', true],
  'geometry-test-20261006-152155 geom-019': ['Sword Coast Sailor', true],
  'geometry-test-20261006-152155 geom-020': ['Eliminate', false],
  'geometry-test-20261006-152155 geom-021': ['Sakashima\'s Student', false],
  'geometry-test-20261006-152155 geom-022': ['Island', false],
  'geometry-test-20261006-152155 geom-023': ['Distortion Strike', false],
  'geometry-test-20261006-152155 geom-024': ['Sage Owl', true],
  'geometry-test-20261006-152155 geom-025': ['Deep-Cavern Bat', false],
  'geometry-test-20261006-152155 geom-026': ['Swamp', false],
  'geometry-test-20261006-152155 geom-027': ['Throatseeker', true],
  'geometry-test-20261006-152155 geom-028': ['Swamp', true],
  'geometry-test-20261006-152155 geom-029': ['Satoru Umezawa', true],
  'geometry-test-20261006-152155 geom-030': ['Swamp', true],
  'geometry-test-20261006-152155 geom-031': ['Dirge of Dread', true],
  'geometry-test-20261006-152155 geom-032': ['Ulamog\'s Crusher', true],
  'geometry-test-20261006-152155 geom-033': ['Whiplash Trap', false],
  'geometry-test-20261006-152155 geom-034': ['Vela the Night-Clad', false],
  'geometry-test-20261006-152155 geom-035': ['Lightning Greaves', false],
  'geometry-test-20261006-152155 geom-036': ['Ornithopter', true],
  'geometry-test-20261006-152155 geom-037': ['Swamp', true],
  'geometry-test-20261006-152155 geom-038': ['Island', false],
  'geometry-test-20261006-152155 geom-039': ['Crafty Pathmage', false],
  'geometry-test-20261006-152155 geom-040': ['Brainstorm', false],
  'geometry-test-20261006-152155 geom-041': ['Deadly Rollick', true],
  'geometry-test-20261006-152155 geom-042': ['Commandeer', false],
  'geometry-test-20261006-152155 geom-043': ['Darkslick Shores', true],
  'geometry-test-20261006-152155 geom-044': ['Island', false],
  'geometry-test-20261006-152155 geom-045': ['Ingenious Prodigy', false],
  'geometry-test-20261006-152155 geom-046': ['Kaito, Dancing Shadow', true],
  'geometry-test-20261006-152155 geom-047': ['Swamp', false],
  'geometry-test-20261006-152155 geom-048': ['Island', true],
  'geometry-test-20261006-152155 geom-049': ['Fallen Shinobi', false],
  'geometry-test-20261006-152155 geom-050': ['Deluge', true],
  'geometry-test-20261006-153936 geom-001': ['Glamdring, Foe-hammer', false],
  'geometry-test-20261006-153936 geom-002': ['Bilbo, Luckwearer', false],
  'geometry-test-20261006-153936 geom-003': ['The Queen of Dale', false],
  'geometry-test-20261006-153936 geom-004': ['Dáin Ironfoot', false],
  'geometry-test-20261006-153936 geom-005': ['Treasure', false],
};

const UNRESOLVED = {
  'geometry-test-20261006-153936 geom-006': 'Adventure reminder token. No single gallery card.',
  'geometry-test-20261006-153936 geom-007': 'Stone Boulder token is not in the gallery.',
  'geometry-test-20261006-153936 geom-008': 'Robot Villain token is not in the gallery.',
  'geometry-test-20261006-153936 geom-009': 'Goblin token matches two different gallery oracle ids.',
};

const readJson = path => JSON.parse(readFileSync(path, 'utf8'));

export const loadGalleryNames = () => {
  const refs = readJson(join(rootDir, '.scan-fixtures/visual-embed/indexes/CLIP_VIT_B32/full/refs.json'));
  const byFold = new Map();
  for (const ref of refs) {
    const key = fold(ref.canonicalName);
    if (!byFold.has(key)) byFold.set(key, { canonicalName: ref.canonicalName, oracleIds: new Set(), scryfallIds: new Map() });
    const row = byFold.get(key);
    row.oracleIds.add(ref.oracleId);
    if (!row.scryfallIds.has(ref.oracleId)) row.scryfallIds.set(ref.oracleId, []);
    row.scryfallIds.get(ref.oracleId).push(ref.scryfallId);
  }
  return byFold;
};

const trustedFrames = () => {
  const dir = join(rootDir, '.geometry-corpus/fixtures');
  const frames = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const fixture = readJson(join(dir, file));
    const card = (fixture.cards ?? []).find(row => isCompleteQuad(row.groundTruthQuad) && row.groundTruthSource === 'manually-reviewed');
    if (!fixture.trusted || !card) continue;
    frames.push({ fixture, card });
  }
  return frames.sort((a, b) => a.fixture.id.localeCompare(b.fixture.id));
};

const geometryKey = fixture => {
  const series = fixture.seriesId || '';
  const label = fixture.label || '';
  const match = label.match(/^(geometry-test-\d{8}-\d+)\s+(geom-\d+)/);
  if (match) return `${match[1]} ${match[2]}`;
  if (series.startsWith('geometry-test-20261006')) {
    const item = label.match(/(geom-\d+)/);
    if (item) return `${series} ${item[1]}`;
  }
  return null;
};

export const buildLabels = () => {
  const names = loadGalleryNames();
  const identities = readJson(join(rootDir, 'scanner-benchmark/annotations/identities.json'));
  const confirmed = new Map(
    identities
      .filter(row => row.status === 'CONFIRMED' && row.cardName && row.source !== 'SCANNER_PREDICTION')
      .map(row => [row.imageId.replace(/^\.\//, ''), row]),
  );
  const frames = [];
  for (const { fixture, card } of trustedFrames()) {
    const image = fixture.image.replace(/^\.\//, '');
    const key = geometryKey(fixture);
    const base = {
      frameId: fixture.id,
      image,
      label: fixture.label,
      tags: [...new Set([...(fixture.tags ?? []), ...(card.tags ?? [])])],
      frameFamily: card.frameFamily ?? 'unknown',
      hardRegression: Boolean(fixture.hardRegression),
    };
    if (key && UNRESOLVED[key]) {
      frames.push({ ...base, status: 'missing', reason: UNRESOLVED[key], cardName: null, oracleId: null, nonEnglish: false });
      continue;
    }
    let cardName = null;
    let nonEnglish = false;
    let source = null;
    if (key && PRINTED[key]) {
      cardName = PRINTED[key][0];
      nonEnglish = PRINTED[key][1];
      source = 'printed-title';
    } else if (confirmed.has(image)) {
      const row = confirmed.get(image);
      cardName = row.cardName;
      source = row.source;
      nonEnglish = (fixture.tags ?? []).some(tag => String(tag).startsWith('language-'));
    }
    if (!cardName) {
      frames.push({ ...base, status: 'missing', reason: 'no printed title or confirmed annotation', cardName: null, oracleId: null, nonEnglish: false });
      continue;
    }
    const hit = names.get(fold(cardName));
    const rankedOracles = hit
      ? [...hit.oracleIds].sort((a, b) => hit.scryfallIds.get(b).length - hit.scryfallIds.get(a).length || a.localeCompare(b))
      : [];
    const dominant = rankedOracles[0] ?? null;
    const dominantArts = dominant ? hit.scryfallIds.get(dominant).length : 0;
    const runnerArts = rankedOracles[1] ? hit.scryfallIds.get(rankedOracles[1]).length : 0;
    const oracleId = dominant && (rankedOracles.length === 1 || runnerArts * 20 < dominantArts) ? dominant : null;
    if (!oracleId) {
      frames.push({
        ...base,
        status: 'ambiguous',
        reason: hit ? `name matches ${hit.oracleIds.size} oracle ids` : 'name is not in the gallery',
        cardName,
        oracleId: null,
        nonEnglish,
        source,
      });
      continue;
    }
    const printings = hit.scryfallIds.get(oracleId) ?? [];
    frames.push({
      ...base,
      status: 'known',
      reason: null,
      cardName: hit.canonicalName,
      oracleId,
      printingId: printings.length === 1 ? printings[0] : null,
      nonEnglish,
      source,
    });
  }
  return frames;
};
