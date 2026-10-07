import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PNG } from 'pngjs';

import { clusterIndexes, hamming64 } from './metrics.mjs';
import { inboxSessions, realPhotos, replayRoot, scanReal, toRepoPath } from './paths.mjs';

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export const roleFromPath = rel => {
  const base = rel.split('/').pop().toLowerCase();
  if (base.includes('title')) return 'title';
  if (base.includes('overlay') || base.includes('detector')) return 'overlay';
  if (base.includes('source')) return 'source';
  if (base.includes('warp') || base.includes('card')) return 'warp';
  if (/^p\d+-f\d+/.test(base)) return 'binder-frame';
  return 'other';
};

export const collapseSessionId = name => name.replace(/--card-\d+$/, '');

export const sourceTypeFromId = (id, fallback = 'other') => {
  if (id.startsWith('normal-scan')) return 'single-card';
  if (id.startsWith('geometry')) return 'geometry';
  if (id.startsWith('deck')) return 'deck';
  if (id.startsWith('binder')) return 'binder';
  if (id.startsWith('focus-series')) return 'focus';
  if (id.startsWith('cq-')) return 'capture-quality';
  if (id.startsWith('swap-test') || id.startsWith('swap-')) return 'swap';
  if (id.startsWith('trace-')) return 'phone-trace';
  if (id === 'real-photos' || id === 'scan-real') return 'real-photo';
  return fallback;
};

export const dateFromId = id => {
  const compact = id.match(/(20\d{6})/);
  if (compact) {
    const s = compact[1];
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  const iso = id.match(/(20\d{2}-\d{2}-\d{2})/);
  return iso ? iso[1] : null;
};

const extOf = name => {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
};

const pngSize = buf => {
  if (buf.length < 24) return null;
  if (buf.toString('ascii', 1, 4) !== 'PNG') return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
};

const sha256 = buf => createHash('sha256').update(buf).digest('hex');

/** 64-bit difference hash. Used on source frames. */
export const dHashHex = buf => {
  let png;
  try {
    png = PNG.sync.read(buf);
  } catch {
    return null;
  }
  const w = 9;
  const h = 8;
  const sample = (x, y) => {
    const sx = Math.min(png.width - 1, Math.floor(((x + 0.5) * png.width) / w));
    const sy = Math.min(png.height - 1, Math.floor(((y + 0.5) * png.height) / h));
    const i = (sy * png.width + sx) * 4;
    return png.data[i] * 0.299 + png.data[i + 1] * 0.587 + png.data[i + 2] * 0.114;
  };
  const bits = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) bits.push(sample(x, y) < sample(x + 1, y) ? 1 : 0);
  }
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = (bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3];
    hex += nibble.toString(16);
  }
  return hex;
};

const walkFiles = async function* (dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(abs);
    else yield abs;
  }
};

const pickStamp = json => {
  if (!json || typeof json !== 'object') return null;
  return json.appStamp ?? json.runtimeFingerprint?.appStamp ?? null;
};

const jsonHasOcr = json => {
  if (!json || typeof json !== 'object') return false;
  if (Array.isArray(json.recordedOcr) && json.recordedOcr.some(r => r?.text)) return true;
  const text = json.ocr?.ocrRawText ?? json.ocr?.ocrNormalizedText;
  return Boolean(text);
};

const jsonHasResult = json => {
  if (!json || typeof json !== 'object') return false;
  return Boolean(json.terminalStatus || json.recognitionResult || json.expectedStatus);
};

/** Explicit fixture labels only. Scanner predictions are not identity. */
const explicitIdentity = (json, sourceType) => {
  if (!json || typeof json !== 'object') return null;
  if ((sourceType === 'replay' || sourceType === 'real-photo') && json.expectedName) {
    return String(json.expectedName);
  }
  return null;
};

export const buildInventory = async () => {
  const sessions = new Map();
  const ensure = (sessionId, sourceType) => {
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, {
        sessionId,
        date: dateFromId(sessionId),
        sourceType,
        files: 0,
        images: [],
        hasSource: false,
        hasWarp: false,
        hasTitle: false,
        hasOverlay: false,
        hasMetadata: false,
        expectedIdentity: null,
        ocrAvailable: false,
        scannerResultAvailable: false,
        appStamp: null,
        dimensions: {},
        sharpness: [],
        scannerPredictions: 0,
      });
    }
    return sessions.get(sessionId);
  };

  const considerJson = async (abs, sessionId, sourceType) => {
    const session = ensure(sessionId, sourceType);
    session.files += 1;
    session.hasMetadata = true;
    let json;
    try {
      json = JSON.parse(await readFile(abs, 'utf8'));
    } catch {
      return;
    }
    session.appStamp = session.appStamp ?? pickStamp(json);
    if (jsonHasOcr(json)) session.ocrAvailable = true;
    if (jsonHasResult(json)) session.scannerResultAvailable = true;
    const ident = explicitIdentity(json, sourceType);
    const base = abs.split('/').pop();
    if (ident && (base === 'replay.json' || !session.expectedIdentity)) session.expectedIdentity = ident;
    if (json.ocr?.bestCandidateName || json.proposedCard || json.finalCard) {
      session.scannerPredictions += 1;
    }
    if (typeof json.sharpness === 'number') session.sharpness.push(json.sharpness);
  };

  const considerImage = async (abs, sessionId, sourceType) => {
    const session = ensure(sessionId, sourceType);
    const buf = await readFile(abs);
    const rel = toRepoPath(abs);
    const role = roleFromPath(rel);
    const size = pngSize(buf);
    const phash = role === 'source' && buf.length < 8_000_000 ? dHashHex(buf) : null;
    session.files += 1;
    session.images.push({
      imageId: rel,
      path: rel,
      sessionId,
      sourceType,
      role,
      bytes: buf.length,
      width: size?.width ?? null,
      height: size?.height ?? null,
      sha256: sha256(buf),
      phash,
    });
    if (role === 'source') session.hasSource = true;
    if (role === 'warp') session.hasWarp = true;
    if (role === 'title') session.hasTitle = true;
    if (role === 'overlay') session.hasOverlay = true;
    if (size) {
      const dims = `${size.width}x${size.height}`;
      session.dimensions[dims] = (session.dimensions[dims] ?? 0) + 1;
    }
  };

  const ingestTree = async (dir, sessionId, sourceType) => {
    for await (const abs of walkFiles(dir)) {
      const ext = extOf(abs);
      if (ext === '.json') await considerJson(abs, sessionId, sourceType);
      else if (IMAGE_EXT.has(ext)) await considerImage(abs, sessionId, sourceType);
      else ensure(sessionId, sourceType).files += 1;
    }
  };

  try {
    const days = await readdir(inboxSessions, { withFileTypes: true });
    for (const day of days) {
      if (!day.isDirectory()) continue;
      const dayAbs = join(inboxSessions, day.name);
      if (/^phone-\d{8}$/.test(day.name)) {
        const children = await readdir(dayAbs, { withFileTypes: true });
        for (const child of children) {
          if (!child.isDirectory()) continue;
          await ingestTree(
            join(dayAbs, child.name),
            child.name,
            sourceTypeFromId(child.name, 'phone-trace'),
          );
        }
      } else {
        const id = collapseSessionId(day.name);
        await ingestTree(dayAbs, id, sourceTypeFromId(id));
      }
    }
  } catch {
    // inbox may be absent
  }

  try {
    const fixtures = await readdir(replayRoot, { withFileTypes: true });
    for (const fx of fixtures) {
      if (!fx.isDirectory()) continue;
      await ingestTree(join(replayRoot, fx.name), `replay:${fx.name}`, 'replay');
    }
  } catch {
    // replay may be absent
  }

  await ingestTree(realPhotos, 'real-photos', 'real-photo');
  await ingestTree(scanReal, 'scan-real', 'real-photo');

  const images = [];
  for (const session of sessions.values()) images.push(...session.images);

  const exactGroups = new Map();
  for (const image of images) {
    if (!exactGroups.has(image.sha256)) exactGroups.set(image.sha256, []);
    exactGroups.get(image.sha256).push(image.imageId);
  }
  const exactClusters = [...exactGroups.values()].filter(g => g.length > 1);

  const hashed = images.filter(im => im.phash);
  const nearClusters = clusterIndexes(hashed.length, (i, j) => {
    if (hashed[i].sessionId !== hashed[j].sessionId) return false;
    return hamming64(hashed[i].phash, hashed[j].phash) <= 8;
  }).map(idxs => idxs.map(i => hashed[i].imageId));

  const exactOf = new Map();
  exactClusters.forEach((ids, n) => ids.forEach(id => exactOf.set(id, `exact-${n + 1}`)));
  const nearOf = new Map();
  nearClusters.forEach((ids, n) => ids.forEach(id => nearOf.set(id, `near-${n + 1}`)));
  for (const image of images) {
    image.exactCluster = exactOf.get(image.imageId) ?? null;
    image.nearCluster = nearOf.get(image.imageId) ?? null;
  }

  const median = xs => {
    if (!xs?.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  const sessionRows = [...sessions.values()]
    .map(session => ({
      sessionId: session.sessionId,
      date: session.date,
      sourceType: session.sourceType,
      fileCount: session.files,
      imageCount: session.images.length,
      sourceHighres: session.hasSource,
      recognitionCard: session.hasWarp,
      titleCrop: session.hasTitle,
      detectorOverlay: session.hasOverlay,
      metadata: session.hasMetadata,
      expectedIdentityAvailable: Boolean(session.expectedIdentity),
      expectedIdentity: session.expectedIdentity,
      ocrAvailable: session.ocrAvailable,
      scannerResultAvailable: session.scannerResultAvailable,
      scannerPredictionCount: session.scannerPredictions,
      appStamp: session.appStamp,
      dimensions: Object.entries(session.dimensions)
        .sort((a, b) => b[1] - a[1])
        .map(([size, count]) => ({ size, count })),
      sharpnessMedian: median(session.sharpness),
      nearDuplicateClusters: new Set(session.images.map(im => im.nearCluster).filter(Boolean)).size,
      imageIds: session.images.map(im => im.imageId),
    }))
    .sort((a, b) => a.sessionId.localeCompare(b.sessionId));

  const bySourceType = {};
  for (const session of sessionRows) {
    bySourceType[session.sourceType] = bySourceType[session.sourceType] ?? { sessions: 0, images: 0 };
    bySourceType[session.sourceType].sessions += 1;
    bySourceType[session.sourceType].images += session.imageCount;
  }

  return {
    generatedAt: new Date().toISOString(),
    notes: [
      'Scanner predictions are counted and are not expected identity.',
      'Perceptual hashes cover source frames. sha256 covers every inventoried image.',
      'The Scryfall art-crop cache is not phone evidence and is not in this image total.',
    ],
    totals: {
      files: sessionRows.reduce((s, r) => s + r.fileCount, 0),
      images: images.length,
      sessions: sessionRows.length,
      videos: 0,
      exactDuplicateClusters: exactClusters.length,
      exactDuplicateExtraFrames: exactClusters.reduce((s, g) => s + g.length - 1, 0),
      nearDuplicateClusters: nearClusters.length,
      sourceFramesHashed: hashed.length,
    },
    bySourceType,
    usefulness: {
      'single-card': 'Recognition, after a human confirms the physical card.',
      deck: 'Recognition across one physical stack. Frames stay in one split.',
      geometry: 'Detector and warp. Recorded quads are not ground truth.',
      binder: 'Future multi-card detection. Excluded from the V1 single-card score.',
      focus: 'Sharpness and capture quality.',
      'capture-quality': 'Snapshot versus photo of one presentation.',
      swap: 'Card-change evidence without video.',
      'phone-trace': 'Debug traces. A human label is required before scoring.',
      replay: 'Explicit identities plus recorded OCR. Sanity set, not overall accuracy.',
      'real-photo': 'One explicit hard-case label.',
    },
    sessions: sessionRows,
    images: images.map(im => ({
      imageId: im.imageId,
      path: im.path,
      sessionId: im.sessionId,
      sourceType: im.sourceType,
      role: im.role,
      width: im.width,
      height: im.height,
      bytes: im.bytes,
      sha256: im.sha256,
      phash: im.phash,
      exactCluster: im.exactCluster,
      nearCluster: im.nearCluster,
    })),
    dedupe: { exactClusters, nearClusters },
  };
};

const yn = v => (v ? 'yes' : 'no');

export const inventoryMarkdown = inventory => {
  const t = inventory.totals;
  const lines = [
    '# Scanner corpus inventory',
    '',
    `Generated ${inventory.generatedAt}.`,
    '',
    'Counts are from a fresh walk. Canonical Scryfall art crops are not in the image total.',
    '',
    '| | |',
    '| --- | ---: |',
    `| Files | ${t.files} |`,
    `| Images | ${t.images} |`,
    `| Sessions | ${t.sessions} |`,
    `| Videos | ${t.videos} |`,
    `| Exact duplicate clusters | ${t.exactDuplicateClusters} |`,
    `| Extra frames in those clusters | ${t.exactDuplicateExtraFrames} |`,
    `| Near-duplicate source clusters | ${t.nearDuplicateClusters} |`,
    `| Source frames hashed | ${t.sourceFramesHashed} |`,
    '',
    '## What each group can tell us',
    '',
  ];
  for (const [k, v] of Object.entries(inventory.usefulness)) {
    const stats = inventory.bySourceType[k];
    const n = stats ? `${stats.sessions} sessions, ${stats.images} images` : 'none found';
    lines.push(`- **${k}** (${n}): ${v}`);
  }
  lines.push('', '## Sessions', '', '| Session | Date | Type | Images | Source | Warp | Title | Overlay | Identity | OCR | Scanner result |');
  lines.push('| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- |');
  for (const s of inventory.sessions) {
    if (!s.imageCount && !s.metadata) continue;
    lines.push(
      `| ${s.sessionId} | ${s.date ?? ''} | ${s.sourceType} | ${s.imageCount} | ${yn(s.sourceHighres)} | ${yn(s.recognitionCard)} | ${yn(s.titleCrop)} | ${yn(s.detectorOverlay)} | ${s.expectedIdentity ? 'explicit' : 'unknown'} | ${yn(s.ocrAvailable)} | ${yn(s.scannerResultAvailable)} |`,
    );
  }
  lines.push('', 'Identity is explicit only for a fixture label. A scanner prediction is not a label.', '');
  return `${lines.join('\n')}\n`;
};
