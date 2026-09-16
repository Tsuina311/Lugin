/**
 * Production-scale visual reference gallery + binary index I/O.
 *
 * Cache key: encoderId + artId + preprocessVersion
 * Search collapses multiple art hits to oracleId (max score).
 */

import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import {
  DEFAULT_ENCODER_ID,
  PREPROCESS_VERSION,
  VISUAL_INDEX_VERSION,
  getEncoderDef,
  loadEncoder,
} from './encoders.mjs';
import { cosine as cosineVec } from './visual-math.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE_ROOT = join(root, '.scan-fixtures/visual-embed');
const ART_CACHE = join(CACHE_ROOT, 'art-crops');
const AGENT = 'Lugin/1.0 (+https://github.com/Tsuina311/Lugin; recognition-bakeoff)';

export const galleryDir = (encoderId, galleryTag) =>
  join(CACHE_ROOT, 'indexes', encoderId, galleryTag);

export const artCropCdnUrl = scryfallId =>
  `https://cards.scryfall.io/art_crop/front/${scryfallId[0]}/${scryfallId[1]}/${scryfallId}.jpg`;

const ensureDirs = (...dirs) => {
  for (const d of dirs) mkdirSync(d, { recursive: true });
};

export const loadArtIndexEntries = () => {
  const artPath = join(root, '.scan-fixtures/art-index.production.json');
  if (!existsSync(artPath)) throw new Error(`missing ${artPath}`);
  const art = JSON.parse(readFileSync(artPath, 'utf8'));
  return art.art?.entries ?? [];
};

/**
 * Build ordered reference list.
 * @param {'full'|number} gallery  'full' or integer subsample size
 * @param {{ mustIncludeOracleIds?: Set<string>, mustIncludeNames?: Set<string> }} [opts]
 */
export const selectGalleryRefs = (gallery = 'full', opts = {}) => {
  const entries = loadArtIndexEntries();
  const skipBasics = new Set(['forest', 'island', 'mountain', 'plains', 'swamp', 'wastes']);

  /** @type {Map<string, object>} artId → ref */
  const byArt = new Map();
  for (const e of entries) {
    if (!e.scryfallId || !e.name || !e.oracleId) continue;
    const artId = e.illustrationId || e.scryfallId;
    if (byArt.has(artId)) continue;
    byArt.set(artId, {
      artId,
      oracleId: e.oracleId,
      canonicalName: e.name,
      scryfallId: e.scryfallId,
      setCode: e.setCode ?? null,
      collectorNumber: e.collectorNumber ?? null,
      isBasic: skipBasics.has(String(e.name).toLowerCase()),
    });
  }

  let refs = [...byArt.values()];
  if (gallery !== 'full' && Number(gallery) > 0) {
    const n = Number(gallery);
    const mustOracle = opts.mustIncludeOracleIds ?? new Set();
    const mustNames = opts.mustIncludeNames ?? new Set();
    const fold = s =>
      String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^\p{Letter}\p{Number}]/gu, '');

    // Always pin trusted-corpus identities into probe galleries.
    const pinned = [];
    const pinnedArt = new Set();
    for (const r of refs) {
      const nameHit = mustNames.has(fold(r.canonicalName));
      const oracleHit = mustOracle.has(r.oracleId);
      if (!nameHit && !oracleHit) continue;
      if (pinnedArt.has(r.artId)) continue;
      pinned.push(r);
      pinnedArt.add(r.artId);
    }

    const nonBasic = refs.filter(r => !r.isBasic && !pinnedArt.has(r.artId));
    const basics = refs.filter(r => r.isBasic && !pinnedArt.has(r.artId));
    const picked = [...pinned];
    const stride = Math.max(1, Math.floor(nonBasic.length / Math.max(1, n - pinned.length)));
    for (let i = 0; i < nonBasic.length && picked.length < n; i += stride) {
      picked.push(nonBasic[i]);
    }
    for (let i = 0; picked.length < n && i < nonBasic.length; i++) {
      if (!picked.includes(nonBasic[i])) picked.push(nonBasic[i]);
    }
    for (let i = 0; picked.length < n && i < basics.length; i++) picked.push(basics[i]);
    refs = picked.slice(0, n);
  }

  const oracles = new Set(refs.map(r => r.oracleId));
  const artsPerOracle = new Map();
  for (const r of refs) {
    artsPerOracle.set(r.oracleId, (artsPerOracle.get(r.oracleId) || 0) + 1);
  }
  const counts = [...artsPerOracle.values()];
  const stats = {
    expected: refs.length,
    oracleIdentities: oracles.size,
    artworkReferences: refs.length,
    averageArtsPerOracle: counts.length ? counts.reduce((a, b) => a + b, 0) / counts.length : 0,
    maxArtsPerOracle: counts.length ? Math.max(...counts) : 0,
  };
  return { refs, stats };
};

export const downloadArtCrop = async (scryfallId, { force = false } = {}) => {
  ensureDirs(ART_CACHE);
  const dest = join(ART_CACHE, `${scryfallId}.jpg`);
  if (!force && existsSync(dest) && statSync(dest).size > 1000) return dest;
  const url = artCropCdnUrl(scryfallId);
  const imgRes = await fetch(url, { headers: { 'User-Agent': AGENT } });
  if (!imgRes.ok) throw new Error(`art_crop download ${scryfallId}: ${imgRes.status}`);
  const tmp = `${dest}.${process.pid}.${Date.now()}.partial`;
  await pipeline(imgRes.body, createWriteStream(tmp));
  await rename(tmp, dest);
  if (statSync(dest).size < 500) throw new Error(`tiny image ${scryfallId}`);
  return dest;
};

const embeddingCachePath = (encoderId, artId) =>
  join(CACHE_ROOT, 'embedding-cache', encoderId, `pp${PREPROCESS_VERSION}`, `${artId}.f32`);

export const readCachedEmbedding = (encoderId, artId, dims) => {
  const p = embeddingCachePath(encoderId, artId);
  if (!existsSync(p)) return null;
  const buf = readFileSync(p);
  if (buf.byteLength !== dims * 4) return null;
  return new Float32Array(buf.buffer, buf.byteOffset, dims);
};

export const writeCachedEmbedding = (encoderId, artId, embedding) => {
  const p = embeddingCachePath(encoderId, artId);
  ensureDirs(dirname(p));
  writeFileSync(p, Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength));
};

/**
 * Embed all gallery refs for an encoder; write binary index + build report.
 */
export const buildGalleryIndex = async ({
  encoderId = DEFAULT_ENCODER_ID,
  gallery = 'full',
  checkpointEvery = 50,
  onProgress = null,
  mustIncludeOracleIds = null,
  mustIncludeNames = null,
} = {}) => {
  const def = getEncoderDef(encoderId);
  const galleryTag = gallery === 'full' ? 'full' : `g${gallery}`;
  const outDir = galleryDir(def.id, galleryTag);
  ensureDirs(outDir, ART_CACHE);

  const { refs, stats } = selectGalleryRefs(gallery, {
    mustIncludeOracleIds: mustIncludeOracleIds ?? undefined,
    mustIncludeNames: mustIncludeNames ?? undefined,
  });
  const { runtime } = await loadEncoder(def.id);
  const dims = runtime.dims || def.dims;

  const report = {
    generated: new Date().toISOString(),
    encoderId: def.id,
    hfId: def.hfId,
    galleryTag,
    visualIndexVersion: VISUAL_INDEX_VERSION,
    encoderVersion: `${def.hfId}@q${def.quantized ? 1 : 0}`,
    preprocessVersion: PREPROCESS_VERSION,
    expected: stats.expected,
    oracleIdentities: stats.oracleIdentities,
    artworkReferences: stats.artworkReferences,
    averageArtsPerOracle: stats.averageArtsPerOracle,
    maxArtsPerOracle: stats.maxArtsPerOracle,
    downloaded: 0,
    embedded: 0,
    cachedHits: 0,
    skipped: [],
    failureReasons: {},
  };

  const skip = (ref, reason) => {
    report.skipped.push({ artId: ref.artId, name: ref.canonicalName, reason });
    report.failureReasons[reason] = (report.failureReasons[reason] || 0) + 1;
  };

  /** @type {Float32Array[]} */
  const vectors = [];
  /** @type {object[]} */
  const meta = [];

  let i = 0;
  for (const ref of refs) {
    i += 1;
    try {
      let emb = readCachedEmbedding(def.id, ref.artId, dims);
      if (emb) {
        report.cachedHits += 1;
      } else {
        const path = await downloadArtCrop(ref.scryfallId);
        report.downloaded += 1;
        emb = await runtime.embedPath(path);
        if (emb.length !== dims && runtime.dims == null) {
          // MobileCLIP dims discovered at runtime
        }
        if (!emb?.length) throw new Error('empty embedding');
        writeCachedEmbedding(def.id, ref.artId, emb);
      }
      vectors.push(emb instanceof Float32Array ? emb : Float32Array.from(emb));
      meta.push({
        artId: ref.artId,
        oracleId: ref.oracleId,
        canonicalName: ref.canonicalName,
        scryfallId: ref.scryfallId,
        setCode: ref.setCode,
        collectorNumber: ref.collectorNumber,
      });
      report.embedded += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      let reason = 'embed_failed';
      if (/download|404|status/i.test(msg)) reason = 'download_failed';
      else if (/tiny|unsupported|Corrupt|VipsJpeg|empty/i.test(msg)) reason = 'bad_image';
      else if (/format/i.test(msg)) reason = 'unsupported_format';
      skip(ref, `${reason}: ${msg}`);
    }

    if (onProgress && i % 25 === 0) onProgress({ i, total: refs.length, report });

    if (i % checkpointEvery === 0) {
      writeFileSync(join(outDir, 'gallery-build-report.json'), JSON.stringify(report, null, 2));
    }
  }

  const actualDims = vectors[0]?.length || dims;
  const embeddings = new Float32Array(vectors.length * actualDims);
  for (let j = 0; j < vectors.length; j++) {
    embeddings.set(vectors[j], j * actualDims);
  }

  const embPath = join(outDir, 'embeddings.bin');
  writeFileSync(embPath, Buffer.from(embeddings.buffer, embeddings.byteOffset, embeddings.byteLength));
  writeFileSync(join(outDir, 'refs.json'), JSON.stringify(meta));

  const metadata = {
    visualIndexVersion: VISUAL_INDEX_VERSION,
    encoderId: def.id,
    encoderVersion: report.encoderVersion,
    preprocessVersion: PREPROCESS_VERSION,
    galleryTag,
    dims: actualDims,
    count: vectors.length,
    dtype: 'f32',
    float32Bytes: embeddings.byteLength,
    float16Bytes: embeddings.byteLength / 2,
    oracleIdentities: new Set(meta.map(m => m.oracleId)).size,
    artworkReferences: meta.length,
    averageArtsPerOracle: report.averageArtsPerOracle,
    maxArtsPerOracle: report.maxArtsPerOracle,
    generated: new Date().toISOString(),
    collapseBy: 'oracleId',
  };
  writeFileSync(join(outDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
  writeFileSync(join(outDir, 'gallery-build-report.json'), JSON.stringify(report, null, 2));

  // Compact mobile-oriented artifact layout (not integrated into app).
  const mobileDir = join(outDir, 'visual-index');
  ensureDirs(mobileDir);
  writeFileSync(join(mobileDir, 'metadata.json'), JSON.stringify(metadata, null, 2));
  writeFileSync(join(mobileDir, 'oracle-map.json'), JSON.stringify(meta));
  writeFileSync(
    join(mobileDir, 'embeddings.bin'),
    Buffer.from(embeddings.buffer, embeddings.byteOffset, embeddings.byteLength),
  );

  return { outDir, metadata, report, embeddings, meta, dims: actualDims };
};

export const loadGalleryIndex = (encoderId = DEFAULT_ENCODER_ID, gallery = 'full') => {
  const def = getEncoderDef(encoderId);
  const galleryTag = gallery === 'full' ? 'full' : `g${gallery}`;
  const outDir = galleryDir(def.id, galleryTag);
  const metaPath = join(outDir, 'metadata.json');
  if (!existsSync(metaPath)) return null;
  const metadata = JSON.parse(readFileSync(metaPath, 'utf8'));
  const refs = JSON.parse(readFileSync(join(outDir, 'refs.json'), 'utf8'));
  const buf = readFileSync(join(outDir, 'embeddings.bin'));
  const embeddings = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return { outDir, metadata, refs, embeddings, dims: metadata.dims, count: metadata.count };
};

/**
 * Brute-force cosine NN, collapse by oracleId (max score wins).
 * @returns {{ hits: object[], searchMs: number, scoredArts: number }}
 */
export const searchGallery = (index, queryEmbedding, topK = 10) => {
  const t0 = performance.now();
  const { embeddings, refs, dims, count } = index;
  /** oracleId → best */
  const best = new Map();
  for (let i = 0; i < count; i++) {
    const offset = i * dims;
    let dot = 0;
    for (let d = 0; d < dims; d++) dot += queryEmbedding[d] * embeddings[offset + d];
    const ref = refs[i];
    const prev = best.get(ref.oracleId);
    if (!prev || dot > prev.score) {
      best.set(ref.oracleId, {
        name: ref.canonicalName,
        oracleId: ref.oracleId,
        scryfallId: ref.scryfallId,
        artId: ref.artId,
        score: dot,
      });
    }
  }
  const hits = [...best.values()].sort((a, b) => b.score - a.score).slice(0, topK);
  return { hits, searchMs: performance.now() - t0, scoredArts: count };
};

/** Legacy JSON index loader (gallery-800 era). */
export const loadLegacyJsonIndex = path => {
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const refs = (raw.entries ?? []).map(e => ({
    artId: e.scryfallId,
    oracleId: e.oracleId,
    canonicalName: e.name,
    scryfallId: e.scryfallId,
    setCode: null,
    collectorNumber: null,
  }));
  const dims = raw.entries?.[0]?.embedding?.length ?? 512;
  const embeddings = new Float32Array(refs.length * dims);
  raw.entries.forEach((e, i) => {
    embeddings.set(Float32Array.from(e.embedding), i * dims);
  });
  return {
    outDir: dirname(path),
    metadata: {
      encoderId: 'CLIP_VIT_B32',
      galleryTag: 'legacy-json',
      dims,
      count: refs.length,
      dtype: 'f32',
    },
    refs,
    embeddings,
    dims,
    count: refs.length,
  };
};

export const contentHash = buf => createHash('sha1').update(buf).digest('hex').slice(0, 12);
