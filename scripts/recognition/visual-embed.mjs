/**
 * Compatibility shim — prefer gallery.mjs + encoders.mjs.
 * Keeps prior imports working: VISUAL_MODEL_ID, getClipExtractor, etc.
 */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { DEFAULT_ENCODER_ID, getEncoderDef, loadEncoder } from './encoders.mjs';
import {
  downloadArtCrop,
  loadLegacyJsonIndex,
  searchGallery,
} from './gallery.mjs';
import { cosine, l2Normalize } from './visual-math.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = join(root, '.scan-fixtures/visual-embed');
const INDEX_PATH = join(CACHE, 'clip-vit-b32-index.json');

export const VISUAL_MODEL_ID = getEncoderDef(DEFAULT_ENCODER_ID).hfId;
export const VISUAL_INDEX_PATH = INDEX_PATH;
export const ENCODER_ID = DEFAULT_ENCODER_ID;

export { cosine, l2Normalize, downloadArtCrop };

export const getClipExtractor = async () => {
  const { runtime } = await loadEncoder(DEFAULT_ENCODER_ID);
  return {
    // Mimic transformers pipeline callable
    embedPath: runtime.embedPath,
  };
};

export const embedImagePath = async (imagePath, extractor) => {
  if (extractor?.embedPath) return extractor.embedPath(imagePath);
  const { runtime } = await loadEncoder(DEFAULT_ENCODER_ID);
  return runtime.embedPath(imagePath);
};

export const loadVisualIndex = (path = INDEX_PATH) => {
  const legacy = loadLegacyJsonIndex(path);
  if (!legacy) return null;
  return {
    model: VISUAL_MODEL_ID,
    entries: legacy.refs.map((r, i) => ({
      name: r.canonicalName,
      oracleId: r.oracleId,
      scryfallId: r.scryfallId,
      representation: 'art_crop',
      embedding: legacy.embeddings.slice(i * legacy.dims, (i + 1) * legacy.dims),
    })),
    _gallery: legacy,
  };
};

export const saveVisualIndex = () => {
  throw new Error('saveVisualIndex deprecated — use buildGalleryIndex in gallery.mjs');
};

export const searchVisualIndex = (index, queryEmbedding, topK = 5) => {
  if (index?._gallery) {
    return searchGallery(index._gallery, queryEmbedding, topK).hits;
  }
  // Fallback for ad-hoc entry arrays
  const scored = [];
  for (const e of index.entries ?? []) {
    scored.push({
      name: e.name,
      oracleId: e.oracleId,
      scryfallId: e.scryfallId,
      score: cosine(queryEmbedding, e.embedding),
      representation: e.representation,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  const seen = new Set();
  const out = [];
  for (const s of scored) {
    const key = (s.oracleId || s.name || '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= topK) break;
  }
  return out;
};
