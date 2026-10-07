/** Geometry fixture schema v1 — source-image pixel coordinates only. */

import { SCHEMA_VERSION } from './paths.mjs';

export const GROUND_TRUTH_SOURCES = [
  'existing-recognition-quad',
  'existing-tracked-quad',
  'existing-raw-quad',
  'per-snapshot-quad',
  'existing-annotation',
  'manually-reviewed',
  'synthetic',
  'none',
];

export const FIXTURE_SOURCES = [
  'scanner-lab',
  'focus-series',
  'capture-quality',
  'swap-test',
  'replay',
  'scan-real',
  'geometry-trace',
  'detector-debug',
  'real-photos',
  'unknown',
];

/** Per-card frame family. Missing on old fixtures means `unknown` — never infer modern. */
export const FRAME_FAMILIES = [
  'modern_standard',
  'borderless',
  'showcase',
  'retro',
  'old',
  'other',
  'unknown',
];

/** Internal structural regions. The outer card stays on groundTruthQuad. */
export const FRAME_REGION_KEYS = ['titleBand', 'artBox', 'typeLine', 'textBox', 'footer'];

export const REGION_SOURCES = ['auto', 'auto-accepted', 'auto-edited', 'manual'];

export const ALLOWED_TAGS = [
  'sleeved',
  'unsleeved',
  'foil',
  'nonfoil',
  'dark-card',
  'dark-background',
  'dark-border',
  'glare',
  'bad-lighting',
  'perspective',
  'partial',
  'binder',
  'overlap',
  'multi-card',
  'borderless',
  'classic-frame',
  'showcase',
  'language-fr',
  'language-it',
  'language-de',
  'language-es',
  'language-en',
  'bad-capture',
  'hard-case',
  'frozen-quad-series',
  'per-snapshot-series',
];

export const emptyQuad = () => ({
  tl: [0, 0],
  tr: [0, 0],
  br: [0, 0],
  bl: [0, 0],
});

export const cornersToGtQuad = corners => {
  if (!corners?.topLeft) return null;
  return {
    tl: [corners.topLeft.x, corners.topLeft.y],
    tr: [corners.topRight.x, corners.topRight.y],
    br: [corners.bottomRight.x, corners.bottomRight.y],
    bl: [corners.bottomLeft.x, corners.bottomLeft.y],
  };
};

export const gtQuadToCorners = q => {
  if (!q?.tl) return null;
  return {
    topLeft: { x: q.tl[0], y: q.tl[1] },
    topRight: { x: q.tr[0], y: q.tr[1] },
    bottomRight: { x: q.br[0], y: q.br[1] },
    bottomLeft: { x: q.bl[0], y: q.bl[1] },
  };
};

export const isCompleteQuad = q => {
  if (!q?.tl || !q?.tr || !q?.br || !q?.bl) return false;
  const pts = [q.tl, q.tr, q.br, q.bl];
  return pts.every(p => Array.isArray(p) && p.length === 2 && p.every(n => Number.isFinite(n)));
};

export const createFixture = partial => ({
  schemaVersion: SCHEMA_VERSION,
  id: partial.id,
  image: partial.image,
  imageWidth: partial.imageWidth ?? null,
  imageHeight: partial.imageHeight ?? null,
  source: partial.source ?? 'unknown',
  seriesId: partial.seriesId ?? null,
  captureGroup: partial.captureGroup ?? partial.seriesId ?? partial.id,
  trusted: partial.trusted ?? false,
  hardRegression: partial.hardRegression ?? false,
  negative: partial.negative ?? false,
  split: partial.split ?? null,
  cards: partial.cards ?? [],
  tags: partial.tags ?? [],
  label: partial.label ?? null,
  notes: partial.notes ?? '',
  bootstrapNotes: partial.bootstrapNotes ?? '',
  createdAt: partial.createdAt ?? new Date().toISOString(),
  updatedAt: partial.updatedAt ?? new Date().toISOString(),
  provenance: partial.provenance ?? {},
});

export const createCard = partial => ({
  id: partial.id ?? 'card-1',
  groundTruthQuad: partial.groundTruthQuad ?? null,
  /** Synthetic sleeve outer quad (exact). Distinct from groundTruthQuad (physical card). */
  sleeveQuad: partial.sleeveQuad ?? null,
  visibleFraction: partial.visibleFraction ?? null,
  zIndex: partial.zIndex ?? null,
  visibility: partial.visibility ?? 'full',
  occluded: partial.occluded ?? false,
  tags: partial.tags ?? [],
  groundTruthSource: partial.groundTruthSource ?? 'none',
  bootstrapQuadKind: partial.bootstrapQuadKind ?? null,
  label: partial.label ?? null,
  frameFamily: FRAME_FAMILIES.includes(partial.frameFamily) ? partial.frameFamily : 'unknown',
  ...(partial.regions ? { regions: partial.regions } : {}),
});

export const validateFixture = fixture => {
  const errors = [];
  if (!fixture || typeof fixture !== 'object') return ['fixture is not an object'];
  if (fixture.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  }
  if (!fixture.id || typeof fixture.id !== 'string') errors.push('id required');
  if (!fixture.image || typeof fixture.image !== 'string') errors.push('image path required');
  if (!FIXTURE_SOURCES.includes(fixture.source) && fixture.source !== 'unknown') {
    errors.push(`unknown source: ${fixture.source}`);
  }
  if (!Array.isArray(fixture.cards)) errors.push('cards must be an array');
  for (const card of fixture.cards ?? []) {
    if (!card.id) errors.push('card.id required');
    if (!GROUND_TRUTH_SOURCES.includes(card.groundTruthSource ?? 'none')) {
      errors.push(`card ${card.id}: bad groundTruthSource`);
    }
    if (card.groundTruthQuad && !isCompleteQuad(card.groundTruthQuad)) {
      errors.push(`card ${card.id}: incomplete groundTruthQuad`);
    }
    if (card.frameFamily != null && !FRAME_FAMILIES.includes(card.frameFamily)) {
      errors.push(`card ${card.id}: bad frameFamily`);
    }
    if (card.regions != null) {
      if (typeof card.regions !== 'object' || Array.isArray(card.regions)) {
        errors.push(`card ${card.id}: regions must be an object`);
      } else {
        for (const key of FRAME_REGION_KEYS) {
          const region = card.regions[key];
          if (region == null) continue;
          if (!REGION_SOURCES.includes(region.source)) {
            errors.push(`card ${card.id}: ${key} source invalid`);
          }
          if (!isCompleteQuad(region.quad)) errors.push(`card ${card.id}: ${key} quad incomplete`);
          if (region.autoQuad && !isCompleteQuad(region.autoQuad)) {
            errors.push(`card ${card.id}: ${key} autoQuad incomplete`);
          }
          if (region.reviewed != null && typeof region.reviewed !== 'boolean') {
            errors.push(`card ${card.id}: ${key} reviewed must be boolean`);
          }
          if (
            region.confidence != null &&
            (typeof region.confidence !== 'number' || region.confidence < 0 || region.confidence > 1)
          ) {
            errors.push(`card ${card.id}: ${key} confidence out of range`);
          }
        }
      }
    }
  }
  return errors;
};

export const fixtureUsableForGeometry = fixture => {
  if (!fixture?.image) return { ok: false, reason: 'missing-image' };
  if (fixture.negative) return { ok: true, reason: 'negative' };
  const withQuad = (fixture.cards ?? []).filter(c => isCompleteQuad(c.groundTruthQuad));
  if (!withQuad.length) return { ok: false, reason: 'no-quad' };
  return { ok: true, reason: 'has-quad' };
};

export const fixtureTrustedEval = fixture => {
  const use = fixtureUsableForGeometry(fixture);
  if (!use.ok) return false;
  if (!fixture.trusted) return false;
  if (fixture.tags?.includes('frozen-quad-series')) return false;
  const cards = fixture.cards ?? [];
  if (!cards.length && fixture.negative) return true;
  return cards.some(
    c =>
      isCompleteQuad(c.groundTruthQuad) &&
      (c.groundTruthSource === 'manually-reviewed' ||
        c.groundTruthSource === 'existing-annotation' ||
        c.groundTruthSource === 'synthetic'),
  );
};
