import { splitSession } from './metrics.mjs';

const QUOTAS = {
  geometry: 36,
  deck: 18,
  'single-card': 16,
  focus: 10,
  'capture-quality': 8,
  swap: 4,
  'phone-trace': 8,
};

const TAG_RULES = [
  [/foil/i, 'FOIL'],
  [/french|fr\b|lames|epee|épée/i, 'FOREIGN_LANGUAGE'],
  [/italian|svignar/i, 'FOREIGN_LANGUAGE'],
  [/unsleeved/i, 'UNSLEEVED'],
  [/sleeve/i, 'SLEEVED'],
  [/glare/i, 'GLARE'],
  [/alt-art|alt art|showcase/i, 'ALT_ART'],
  [/old-edition|old edition|teferi/i, 'OLD_FRAME'],
  [/binder/i, 'BINDER'],
];

export const autoTagsFor = (path, sourceType) => {
  const tags = new Set();
  if (sourceType === 'binder') tags.add('BINDER');
  for (const [re, tag] of TAG_RULES) {
    if (re.test(path) || re.test(sourceType)) tags.add(tag);
  }
  return [...tags];
};

const pickRepresentatives = images => {
  const bySession = new Map();
  for (const image of images) {
    if (!bySession.has(image.sessionId)) bySession.set(image.sessionId, []);
    bySession.get(image.sessionId).push(image);
  }
  const picked = [];
  for (const group of bySession.values()) {
    const sorted = [...group].sort((a, b) => a.imageId.localeCompare(b.imageId));
    const clusters = new Map();
    for (const image of sorted) {
      const key = image.nearCluster ?? image.imageId;
      if (!clusters.has(key)) clusters.set(key, image);
    }
    const reps = [...clusters.values()].sort((a, b) => a.imageId.localeCompare(b.imageId));
    picked.push(reps[Math.floor(reps.length / 2)]);
    if (reps.length > 3) picked.push(reps[0]);
  }
  return picked;
};

/**
 * Diverse full frames for corner annotation.
 * Replay fixtures are always included and split out as regression sanity.
 */
export const selectStills = inventory => {
  const images = inventory.images ?? [];
  const sessionById = new Map(inventory.sessions.map(s => [s.sessionId, s]));
  const seen = new Set();
  const items = [];

  const push = (image, split, reason) => {
    if (!image || seen.has(image.sha256) || seen.has(image.imageId)) return;
    seen.add(image.sha256);
    seen.add(image.imageId);
    const session = sessionById.get(image.sessionId);
    const confirmed = Boolean(session?.expectedIdentityAvailable && session.expectedIdentity);
    items.push({
      imageId: image.imageId,
      path: image.path,
      sessionId: image.sessionId,
      date: session?.date ?? null,
      sourceType: image.sourceType,
      width: image.width,
      height: image.height,
      split,
      reason,
      identityStatus: confirmed ? 'CONFIRMED' : 'UNKNOWN',
      cardName: confirmed ? session.expectedIdentity : null,
      needsIdentityAnnotation: !confirmed,
      needsCornerAnnotation: true,
      autoTags: autoTagsFor(image.path, image.sourceType),
      nearCluster: image.nearCluster,
    });
  };

  for (const image of images) {
    if (image.sourceType === 'replay' && image.role === 'source') {
      push(image, 'REGRESSION_SANITY', 'explicit replay fixture');
    }
  }
  for (const image of images) {
    if (image.sourceType === 'real-photo' && image.role !== 'overlay') {
      push(image, 'DEV', 'explicit real-photo label');
    }
  }

  const pool = images.filter(
    im =>
      im.role === 'source' &&
      im.width != null &&
      im.width >= 700 &&
      im.sourceType !== 'binder' &&
      im.sourceType !== 'replay' &&
      im.sourceType !== 'real-photo',
  );
  const reps = pickRepresentatives(pool).sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  const taken = {};
  for (const image of reps) {
    const cap = QUOTAS[image.sourceType] ?? 0;
    taken[image.sourceType] = taken[image.sourceType] ?? 0;
    if (taken[image.sourceType] >= cap) continue;
    taken[image.sourceType] += 1;
    push(image, splitSession(image.sessionId), 'diversity sample');
  }

  return {
    datasetVersion: 'stills-v1',
    generatedAt: new Date().toISOString(),
    limitation:
      'Confirmed identities are the explicit replay labels and the real-photo sidecar. Other frames are UNKNOWN until annotated. No reviewed corner ground truth was found.',
    counts: {
      frames: items.length,
      confirmedIdentity: items.filter(i => i.identityStatus === 'CONFIRMED').length,
      unknownIdentity: items.filter(i => i.identityStatus === 'UNKNOWN').length,
      needsCornerAnnotation: items.filter(i => i.needsCornerAnnotation).length,
      regressionSanity: items.filter(i => i.split === 'REGRESSION_SANITY').length,
      dev: items.filter(i => i.split === 'DEV').length,
      lockedTest: items.filter(i => i.split === 'LOCKED_TEST').length,
    },
    quotas: QUOTAS,
    items,
  };
};
