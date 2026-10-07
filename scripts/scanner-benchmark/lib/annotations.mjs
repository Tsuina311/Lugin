import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { datasetHash } from './metrics.mjs';
import { annotationsDir } from './paths.mjs';

const readJson = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
};

export const identitiesPath = join(annotationsDir, 'identities.json');
export const cornersPath = join(annotationsDir, 'corners.json');
export const tagsPath = join(annotationsDir, 'tags.json');
export const videosPath = join(annotationsDir, 'videos.json');

export const loadAnnotations = async () => ({
  identities: await readJson(identitiesPath, []),
  corners: await readJson(cornersPath, []),
  tags: await readJson(tagsPath, []),
  videos: await readJson(videosPath, { schema: 'scanner-video-v0', videos: [] }),
});

const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);

/**
 * Seed CONFIRMED identities from explicit fixture labels.
 * Manual rows win. Scanner predictions are never written.
 */
export const seedIdentities = (stills, existing) => {
  const byId = new Map((existing ?? []).map(row => [row.imageId, row]));
  for (const item of stills.items) {
    const prev = byId.get(item.imageId);
    if (prev && (prev.source === 'MANUAL' || prev.status === 'CONFIRMED')) continue;
    if (item.identityStatus !== 'CONFIRMED' || !item.cardName) continue;
    byId.set(item.imageId, {
      imageId: item.imageId,
      cardName: item.cardName,
      status: 'CONFIRMED',
      source: 'EXISTING_FIXTURE',
      notes: item.reason,
    });
  }
  return [...byId.values()].sort((a, b) => a.imageId.localeCompare(b.imageId));
};

export const seedTags = (stills, existing) => {
  const manual = (existing ?? []).filter(row => row.source === 'MANUAL');
  const auto = [];
  for (const item of stills.items) {
    if (!item.autoTags?.length) continue;
    auto.push({
      imageId: item.imageId,
      tags: item.autoTags,
      source: 'AUTO',
    });
  }
  return [...manual, ...auto].sort((a, b) => a.imageId.localeCompare(b.imageId));
};

export const saveAnnotationBundle = async ({ identities, corners, tags, videos }) => {
  await writeJson(identitiesPath, identities);
  await writeJson(cornersPath, corners);
  await writeJson(tagsPath, tags);
  await writeJson(
    videosPath,
    videos ?? { schema: 'scanner-video-v0', videos: [] },
  );
};

export const hashDataset = (stills, annotations) =>
  datasetHash({
    version: stills.datasetVersion,
    items: stills.items.map(item => ({
      imageId: item.imageId,
      path: item.path,
      sessionId: item.sessionId,
      split: item.split,
    })),
    identities: annotations.identities,
    corners: annotations.corners,
    tags: annotations.tags,
  });
