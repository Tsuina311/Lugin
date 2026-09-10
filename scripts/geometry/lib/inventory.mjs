import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

import {
  INBOX_SESSIONS,
  REAL_PHOTOS,
  REPLAY_ROOT,
  rootDir,
  SCAN_CORPUS_DOWNLOAD,
  SCAN_REAL,
} from './paths.mjs';
import { cornersToGtQuad, createCard, createFixture, isCompleteQuad } from './schema.mjs';
import { deriveTags, markFrozenFocusSeries } from './tags.mjs';

const IMAGE_RE = /\.(png|jpe?g|webp)$/i;

const rel = p => relative(rootDir, p).replace(/\\/g, '/');

const fileHashQuick = async abs => {
  const st = statSync(abs);
  const hash = createHash('sha256');
  hash.update(`${st.size}:${st.mtimeMs}`);
  // Sample head + tail for collision resistance without full read of multi-MB PNGs.
  const head = await readFile(abs, { encoding: null, flag: 'r' }).catch(() => null);
  if (head) {
    hash.update(head.subarray(0, Math.min(65536, head.length)));
    if (head.length > 65536) hash.update(head.subarray(Math.max(0, head.length - 65536)));
  }
  return hash.digest('hex').slice(0, 16);
};

export const readImageSize = async abs => {
  const buf = await readFile(abs);
  const lower = abs.toLowerCase();
  try {
    if (lower.endsWith('.png')) {
      const png = PNG.sync.read(buf);
      return { width: png.width, height: png.height, bytes: buf.length };
    }
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
      const j = jpeg.decode(buf, { useTArray: true });
      return { width: j.width, height: j.height, bytes: buf.length };
    }
  } catch {
    return { width: null, height: null, bytes: buf.length };
  }
  return { width: null, height: null, bytes: buf.length };
};

const classifyImageRole = name => {
  const n = name.toLowerCase();
  if (
    n === 'source-highres.png' ||
    n.endsWith('-source.png') ||
    n === 'fast-source.png' ||
    n === 'photo-source.png' ||
    /^swap-\d+-source\.png$/.test(n)
  ) {
    return 'source';
  }
  if (
    n === 'current-warp.png' ||
    n.endsWith('-card.png') ||
    n.startsWith('recognition-card') ||
    /^t\d+-card\.png$/.test(n) ||
    /^swap-\d+-card\.png$/.test(n)
  ) {
    return 'warp';
  }
  if (n.startsWith('detector-')) return 'detector-debug';
  if (n.includes('title')) return 'title-crop';
  if (n.includes('overlay')) return 'overlay';
  if (n.includes('recognition-attempt')) return 'recognition-attempt';
  return 'other';
};

const walkImages = async dir => {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = async d => {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (IMAGE_RE.test(e.name)) out.push(p);
    }
  };
  await walk(dir);
  return out;
};

const loadJson = async p => {
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch {
    return null;
  }
};

const record = ({
  abs,
  role,
  source,
  seriesId,
  label,
  tags,
  quads,
  groundTruthSource,
  bootstrapQuadKind,
  trusted,
  notes,
  quadMode,
  captureGroup,
  metadataPaths,
}) => ({
  abs,
  path: rel(abs),
  role,
  source,
  seriesId,
  captureGroup: captureGroup ?? seriesId ?? null,
  label: label ?? null,
  tags: tags ?? [],
  quads: quads ?? {},
  groundTruthSource: groundTruthSource ?? 'none',
  bootstrapQuadKind: bootstrapQuadKind ?? null,
  trusted: trusted ?? false,
  notes: notes ?? '',
  quadMode: quadMode ?? null,
  metadataPaths: metadataPaths ?? [],
});

const inventoryReplay = async () => {
  const rows = [];
  if (!existsSync(REPLAY_ROOT)) return rows;
  for (const name of await readdir(REPLAY_ROOT)) {
    const dir = join(REPLAY_ROOT, name);
    const fixture = await loadJson(join(dir, 'fixture.json'));
    if (!fixture) continue;
    const src = join(dir, 'source-highres.png');
    const warp = join(dir, 'current-warp.png');
    const rec = await loadJson(join(dir, 'recognition-quad.json'));
    const tags = deriveTags({ label: fixture.label ?? name });
    const recognition = fixture.quads?.recognition ?? rec?.recognition ?? null;
    const tracked = fixture.quads?.tracked ?? rec?.tracked ?? null;
    const raw = fixture.quads?.raw ?? rec?.raw ?? null;
    if (existsSync(src)) {
      rows.push(
        record({
          abs: src,
          role: 'source',
          source: 'replay',
          seriesId: name,
          captureGroup: name,
          label: fixture.label ?? name,
          tags,
          quads: { recognition, tracked, raw },
          groundTruthSource: recognition ? 'existing-recognition-quad' : 'none',
          bootstrapQuadKind: recognition ? 'recognition' : null,
          trusted: false,
          notes: 'Bootstrap only — recognitionQuad is not reviewed ground truth.',
          metadataPaths: [rel(join(dir, 'fixture.json'))],
        }),
      );
    }
    if (existsSync(warp)) {
      rows.push(
        record({
          abs: warp,
          role: 'warp',
          source: 'replay',
          seriesId: name,
          captureGroup: name,
          label: fixture.label ?? name,
          tags,
          trusted: false,
          notes: 'Card warp — not a geometry source frame.',
        }),
      );
    }
  }
  return rows;
};

const inventoryScanReal = async () => {
  const rows = [];
  for (const root of [SCAN_REAL, REAL_PHOTOS]) {
    if (!existsSync(root)) continue;
    const files = await readdir(root);
    for (const f of files) {
      if (!IMAGE_RE.test(f)) continue;
      const abs = join(root, f);
      const side = await loadJson(join(root, f.replace(IMAGE_RE, '.json')));
      const tags = deriveTags({
        label: side?.tag ?? side?.expectedName,
        hardReasons: side?.hardReasons,
        explicit: side?.negative ? [] : [],
      });
      const corners = side?.corners ?? null;
      rows.push(
        record({
          abs,
          role: 'source',
          source: root.includes('real-photos') ? 'real-photos' : 'scan-real',
          seriesId: f.replace(IMAGE_RE, ''),
          captureGroup: f.replace(IMAGE_RE, ''),
          label: side?.expectedName ?? side?.tag ?? f,
          tags,
          quads: { annotation: corners },
          groundTruthSource: corners
            ? 'existing-annotation'
            : side?.negative
              ? 'none'
              : 'none',
          bootstrapQuadKind: corners ? 'annotation' : null,
          trusted: Boolean(corners) || Boolean(side?.negative),
          notes: side?.notes ?? (side?.negative ? 'Negative fixture (no card).' : ''),
          metadataPaths: side ? [rel(join(root, f.replace(IMAGE_RE, '.json')))] : [],
        }),
      );
    }
  }
  return rows;
};

const inventoryFocusSeries = async sessionDir => {
  const rows = [];
  const name = basename(sessionDir);
  if (!name.startsWith('focus-series-')) return rows;
  const meta = await loadJson(join(sessionDir, 'metadata.json'));
  if (!meta) return rows;
  const quadMode = meta.quadMode ?? null;
  let tags = deriveTags({
    objectTags: meta.tags,
    label: meta.label,
    quadMode,
  });
  tags = markFrozenFocusSeries(tags, { source: 'focus-series', quadMode });
  const frozen = quadMode !== 'per-snapshot';
  const samples = meta.samples ?? [];
  const snapFiles = ['t000', 't250', 't500', 't800'];
  for (let i = 0; i < snapFiles.length; i++) {
    const prefix = snapFiles[i];
    const src = join(sessionDir, `${prefix}-source.png`);
    const card = join(sessionDir, `${prefix}-card.png`);
    const sample = samples[i] ?? null;
    const quad = sample?.quad ?? null;
    if (existsSync(src)) {
      rows.push(
        record({
          abs: src,
          role: 'source',
          source: 'focus-series',
          seriesId: name,
          captureGroup: name,
          label: meta.label ?? name,
          tags,
          quads: { snapshot: quad },
          groundTruthSource: quad
            ? frozen
              ? 'existing-recognition-quad'
              : 'per-snapshot-quad'
            : 'none',
          bootstrapQuadKind: quad ? 'snapshot' : null,
          trusted: false,
          quadMode,
          notes: frozen
            ? 'Legacy frozen-quad Focus Series — invalid for multi-frame geometry eval; untrusted bootstrap only.'
            : 'Per-snapshot quad bootstrap — still needs manual review for trusted eval.',
          metadataPaths: [rel(join(sessionDir, 'metadata.json'))],
        }),
      );
    }
    if (existsSync(card)) {
      rows.push(
        record({
          abs: card,
          role: 'warp',
          source: 'focus-series',
          seriesId: name,
          captureGroup: name,
          label: meta.label ?? name,
          tags,
          trusted: false,
          notes: 'Focus-series card warp.',
        }),
      );
    }
  }
  return rows;
};

const inventoryCaptureQuality = async sessionDir => {
  const rows = [];
  const name = basename(sessionDir);
  if (!name.startsWith('cq-')) return rows;
  const meta = await loadJson(join(sessionDir, 'metadata.json'));
  const tags = deriveTags({ objectTags: meta?.tags, label: meta?.label ?? name });
  for (const kind of ['fast', 'photo']) {
    const src = join(sessionDir, `${kind}-source.png`);
    const card = join(sessionDir, `${kind}-card.png`);
    const block = meta?.[kind] ?? null;
    const quad = block?.quad ?? null;
    if (existsSync(src)) {
      rows.push(
        record({
          abs: src,
          role: 'source',
          source: 'capture-quality',
          seriesId: name,
          captureGroup: name,
          label: meta?.label ?? name,
          tags,
          quads: { recognition: quad },
          groundTruthSource: quad ? 'existing-recognition-quad' : 'none',
          bootstrapQuadKind: quad ? 'recognition' : null,
          trusted: false,
          notes: 'Capture A/B source — bootstrap from saved quad; untrusted until reviewed.',
          metadataPaths: meta ? [rel(join(sessionDir, 'metadata.json'))] : [],
        }),
      );
    }
    if (existsSync(card)) {
      rows.push(
        record({
          abs: card,
          role: 'warp',
          source: 'capture-quality',
          seriesId: name,
          captureGroup: name,
          label: meta?.label ?? name,
          tags,
          trusted: false,
        }),
      );
    }
  }
  return rows;
};

const inventorySwapTest = async sessionDir => {
  const rows = [];
  const name = basename(sessionDir);
  if (!name.startsWith('swap-test-')) return rows;
  const summary = await loadJson(join(sessionDir, 'summary.json'));
  const tags = deriveTags({ label: name });
  const swaps = summary?.swaps ?? [];
  for (const s of swaps) {
    const id = s.swapId ?? s.label;
    if (!id) continue;
    const src = join(sessionDir, `${id}-source.png`);
    const card = join(sessionDir, `${id}-card.png`);
    if (existsSync(src)) {
      rows.push(
        record({
          abs: src,
          role: 'source',
          source: 'swap-test',
          seriesId: name,
          captureGroup: name,
          label: s.identity ?? s.label ?? id,
          tags,
          quads: {},
          groundTruthSource: 'none',
          trusted: false,
          notes: 'Swap-test source — no saved recognitionQuad in summary; annotate in Geometry Lab.',
          metadataPaths: [rel(join(sessionDir, 'summary.json'))],
        }),
      );
    }
    if (existsSync(card)) {
      rows.push(
        record({
          abs: card,
          role: 'warp',
          source: 'swap-test',
          seriesId: name,
          captureGroup: name,
          label: s.identity ?? s.label ?? id,
          tags,
          trusted: false,
        }),
      );
    }
  }
  return rows;
};

const inventoryLabOrTrace = async sessionDir => {
  const rows = [];
  const name = basename(sessionDir);
  const meta = await loadJson(join(sessionDir, 'meta.json'));
  const fixture = await loadJson(join(sessionDir, 'fixture.json'));
  const lab = await loadJson(join(sessionDir, 'lab-live-orch.json'));
  const src = join(sessionDir, 'source-highres.png');

  let source = 'scanner-lab';
  if (meta?.traceType === 'geometry') source = 'geometry-trace';
  if (name.startsWith('trace-')) source = 'geometry-trace';

  const label = fixture?.label ?? lab?.label ?? meta?.traceId ?? name;
  const tags = deriveTags({ label });
  const recognition =
    fixture?.quads?.recognition ?? lab?.recognitionQuad ?? lab?.quads?.recognition ?? null;
  const tracked = fixture?.quads?.tracked ?? lab?.trackedQuad ?? null;

  if (existsSync(src)) {
    rows.push(
      record({
        abs: src,
        role: 'source',
        source,
        seriesId: name,
        captureGroup: name,
        label,
        tags,
        quads: { recognition, tracked, raw: fixture?.quads?.raw ?? null },
        groundTruthSource: recognition ? 'existing-recognition-quad' : 'none',
        bootstrapQuadKind: recognition ? 'recognition' : null,
        trusted: false,
        notes: 'Inbox/lab capture — bootstrap from recognitionQuad if present.',
        metadataPaths: [
          meta && rel(join(sessionDir, 'meta.json')),
          fixture && rel(join(sessionDir, 'fixture.json')),
          lab && rel(join(sessionDir, 'lab-live-orch.json')),
        ].filter(Boolean),
      }),
    );
  }

  for (const warpName of ['current-warp.png', 'recognition-card-1.png', 'recognition-card-2.png']) {
    const w = join(sessionDir, warpName);
    if (existsSync(w)) {
      rows.push(
        record({
          abs: w,
          role: 'warp',
          source,
          seriesId: name,
          captureGroup: name,
          label,
          tags,
          trusted: false,
        }),
      );
    }
  }

  for (const det of ['detector-first.png', 'detector-middle.png', 'detector-last.png']) {
    const d = join(sessionDir, det);
    if (existsSync(d)) {
      rows.push(
        record({
          abs: d,
          role: 'detector-debug',
          source: 'detector-debug',
          seriesId: name,
          captureGroup: name,
          label,
          tags,
          trusted: false,
          notes: 'Detector debug frame — may be analysis-resolution, not source-highres.',
        }),
      );
    }
  }
  return rows;
};

const inventoryInbox = async () => {
  const rows = [];
  if (!existsSync(INBOX_SESSIONS)) return rows;
  for (const session of await readdir(INBOX_SESSIONS)) {
    const sessionPath = join(INBOX_SESSIONS, session);
    let entries;
    try {
      entries = await readdir(sessionPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = join(sessionPath, e.name);
      const name = e.name;
      if (name.startsWith('focus-series-')) {
        rows.push(...(await inventoryFocusSeries(dir)));
      } else if (name.startsWith('cq-')) {
        rows.push(...(await inventoryCaptureQuality(dir)));
      } else if (name.startsWith('swap-test-')) {
        rows.push(...(await inventorySwapTest(dir)));
      } else if (name.startsWith('_')) {
        continue;
      } else {
        rows.push(...(await inventoryLabOrTrace(dir)));
      }
    }
  }
  return rows;
};

const inventoryCorpusDownload = async () => {
  const rows = [];
  const imgs = await walkImages(SCAN_CORPUS_DOWNLOAD);
  for (const abs of imgs) {
    if (!/image\.(jpe?g|webp|png)$/i.test(basename(abs))) continue;
    const meta = await loadJson(join(dirname(abs), 'meta.json'));
    const sampleId = meta?.sampleId ?? basename(dirname(abs));
    const suggested = meta?.detector?.selectedQuad ?? meta?.detectedCards?.[0] ?? null;
    rows.push(
      record({
        abs,
        role: 'source',
        source: 'scan-real',
        seriesId: sampleId,
        captureGroup: sampleId,
        label: meta?.eventType ?? sampleId,
        tags: deriveTags({ label: meta?.eventType }),
        quads: { recognition: suggested },
        groundTruthSource: 'none',
        trusted: false,
        notes: 'Corpus download — detector suggestion is not ground truth.',
        metadataPaths: meta ? [rel(join(dirname(abs), 'meta.json'))] : [],
      }),
    );
  }
  return rows;
};

export const scanInventory = async () => {
  const rows = [
    ...(await inventoryReplay()),
    ...(await inventoryScanReal()),
    ...(await inventoryInbox()),
    ...(await inventoryCorpusDownload()),
  ];

  const byHash = new Map();
  const enriched = [];
  for (const row of rows) {
    const hash = await fileHashQuick(row.abs);
    const size = await readImageSize(row.abs);
    const key = `${hash}:${size.width}x${size.height}:${size.bytes}`;
    const dupOf = byHash.get(key) ?? null;
    if (!dupOf) byHash.set(key, row.path);
    enriched.push({
      ...row,
      contentKey: key,
      duplicateOf: dupOf && dupOf !== row.path ? dupOf : null,
      width: size.width,
      height: size.height,
      bytes: size.bytes,
      hasRecognitionQuad: Boolean(row.quads?.recognition || row.quads?.snapshot || row.quads?.annotation),
      hasTrackingQuad: Boolean(row.quads?.tracked),
      geometryFixtureCandidate:
        row.role === 'source' &&
        (Boolean(row.quads?.recognition) ||
          Boolean(row.quads?.snapshot) ||
          Boolean(row.quads?.annotation) ||
          row.notes?.includes('annotate')),
    });
  }
  return enriched;
};

export const summarizeInventory = rows => {
  const sources = rows.filter(r => r.role === 'source' && !r.duplicateOf);
  const warps = rows.filter(r => r.role === 'warp' && !r.duplicateOf);
  const withMeta = sources.filter(r => r.hasRecognitionQuad || r.hasTrackingQuad);
  const usable = sources.filter(r => r.geometryFixtureCandidate);
  const trusted = sources.filter(r => r.trusted);
  const bySource = {};
  const byTag = {};
  for (const r of sources) {
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    for (const t of r.tags) byTag[t] = (byTag[t] ?? 0) + 1;
  }
  const dims = {};
  for (const r of sources) {
    const k = r.width && r.height ? `${r.width}x${r.height}` : 'unknown';
    dims[k] = (dims[k] ?? 0) + 1;
  }
  return {
    uniqueSourceImages: sources.length,
    cardWarps: warps.length,
    detectorDebug: rows.filter(r => r.role === 'detector-debug' && !r.duplicateOf).length,
    totalRecords: rows.length,
    duplicatesSkipped: rows.filter(r => r.duplicateOf).length,
    withGeometryMetadata: withMeta.length,
    geometryFixtureCandidates: usable.length,
    trustedAnnotations: trusted.length,
    bySource,
    byTag,
    dimensions: dims,
  };
};

export const inventoryRowToFixtureDraft = row => {
  if (row.role !== 'source') return null;
  const annotation = row.quads?.annotation;
  const snapshot = row.quads?.snapshot;
  const recognition = row.quads?.recognition;
  const preferred = annotation ?? snapshot ?? recognition ?? null;
  const gt = cornersToGtQuad(preferred);
  const cards = [];
  if (gt && isCompleteQuad(gt)) {
    cards.push(
      createCard({
        id: 'card-1',
        groundTruthQuad: gt,
        groundTruthSource: row.groundTruthSource,
        bootstrapQuadKind: row.bootstrapQuadKind,
        tags: row.tags,
        label: row.label,
      }),
    );
  }
  // Unique per image path; captureGroup keeps related frames in the same split.
  const leaf = basename(row.path).replace(/\.[^.]+$/, '');
  const id = `${row.source}__${row.seriesId ?? 'img'}__${leaf}`.replace(/[^\w.-]+/g, '_');
  return createFixture({
    id,
    image: row.path,
    imageWidth: row.width,
    imageHeight: row.height,
    source: row.source,
    seriesId: row.seriesId,
    captureGroup: row.captureGroup,
    trusted: row.trusted && row.groundTruthSource === 'existing-annotation',
    hardRegression: row.tags.includes('hard-case'),
    negative: false,
    cards,
    tags: row.tags,
    label: row.label,
    notes: row.notes,
    bootstrapNotes: row.notes,
    provenance: {
      inventoryPath: row.path,
      metadataPaths: row.metadataPaths,
      contentKey: row.contentKey,
      groundTruthSource: row.groundTruthSource,
    },
  });
};
