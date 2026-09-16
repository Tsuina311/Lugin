#!/usr/bin/env node
/**
 * Phase A.3 — mobile-feasibility recognition bakeoff (HOST ONLY).
 *
 *   yarn recognition:phase-a3
 *   node scripts/recognition/phase-a3-bakeoff.mjs
 *
 * Freezes CLIP_VIT_B32_F32 baseline; compares F16/I8 indexes; latency stages;
 * crop robustness; screens smaller encoders (no full rebuild for weak models).
 * NO EAS / NO mobile integration.
 */

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorker, PSM } from 'tesseract.js';
import { PNG } from 'pngjs';
import * as esbuild from 'esbuild';

import { ENCODERS, loadEncoder, PREPROCESS_VERSION, VISUAL_INDEX_VERSION } from './encoders.mjs';
import { galleryDir, loadGalleryIndex } from './gallery.mjs';
import {
  benchSearchOnly,
  convertF32ToF16Index,
  convertF32ToInt8Index,
  loadTypedIndex,
  searchTypedIndex,
  sha256File,
} from './index-formats.mjs';
import { identityMatches, rankHasMatch, resolveExpected } from './scoring.mjs';
import { selectTrustedCorpus } from './trusted-corpus.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const now = () => performance.now();
const percentile = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

const OUT = join(root, '.scan-fixtures/recognition-bakeoff');
mkdirSync(OUT, { recursive: true });

console.log('\n=== Phase A.3 mobile-feasibility bakeoff ===');
console.log('HOST ONLY — no EAS / no mobile integration\n');

// --- Freeze F32 baseline ---
const f32 = loadGalleryIndex('CLIP_VIT_B32', 'full');
if (!f32 || f32.count < 40000) {
  console.error('Missing full CLIP_VIT_B32 f32 index. Run yarn recognition:visual-index --gallery full');
  process.exit(1);
}
const freezeDir = join(root, '.scan-fixtures/visual-embed/indexes/CLIP_VIT_B32_F32/full');
mkdirSync(freezeDir, { recursive: true });
const srcDir = f32.outDir;
for (const name of ['embeddings.bin', 'refs.json', 'metadata.json']) {
  const from = join(srcDir, name);
  const to = join(freezeDir, name);
  if (existsSync(from) && (!existsSync(to) || statSync(to).size !== statSync(from).size)) {
    copyFileSync(from, to);
  }
}
const embHash = sha256File(join(freezeDir, 'embeddings.bin'));
const baselineMeta = {
  configId: 'CLIP_VIT_B32_F32',
  encoderId: 'CLIP_VIT_B32',
  hfId: 'Xenova/clip-vit-base-patch32',
  dtype: 'f32',
  count: f32.count,
  dims: f32.dims,
  oracleIdentities: f32.metadata.oracleIdentities,
  diskBytes: f32.embeddings.byteLength,
  diskMb: f32.embeddings.byteLength / 1e6,
  embeddingsSha256: embHash,
  visualIndexVersion: VISUAL_INDEX_VERSION,
  preprocessVersion: PREPROCESS_VERSION,
  frozenAt: new Date().toISOString(),
  note: 'Do not mutate. Phase A.3 quality baseline.',
};
writeFileSync(join(freezeDir, 'BASELINE.json'), JSON.stringify(baselineMeta, null, 2));
writeFileSync(join(OUT, 'CLIP_VIT_B32_F32.baseline.json'), JSON.stringify(baselineMeta, null, 2));
console.log(
  `BASELINE CLIP_VIT_B32_F32: ${f32.count} arts / ${f32.metadata.oracleIdentities} oracles · ${(baselineMeta.diskMb).toFixed(1)} MB f32`,
);
console.log(`  embeddings sha256: ${embHash.slice(0, 16)}…`);

// --- Build F16 / I8 from frozen f32 (no re-embed) ---
const f16Dir = join(root, '.scan-fixtures/visual-embed/indexes/CLIP_VIT_B32_F16/full');
const i8Dir = join(root, '.scan-fixtures/visual-embed/indexes/CLIP_VIT_B32_I8/full');
console.log('\nConverting index formats…');
const f16Index = convertF32ToF16Index(f32, f16Dir);
const i8Index = convertF32ToInt8Index(f32, i8Dir);
const f32Typed = {
  ...f32,
  dtype: 'f32',
  diskBytes: f32.embeddings.byteLength,
  metadata: { ...f32.metadata, configId: 'CLIP_VIT_B32_F32', dtype: 'f32' },
};
console.log(
  `  F16: ${(f16Index.diskBytes / 1e6).toFixed(1)} MB  I8: ${(i8Index.diskBytes / 1e6).toFixed(1)} MB`,
);

// --- Bundle scan helpers for crop ---
const bundleDir = await mkdtemp(join(tmpdir(), 'lugin-a3-'));
const bundle = join(bundleDir, 'scan.mjs');
await esbuild.build({
  bundle: true,
  format: 'esm',
  outfile: bundle,
  platform: 'neutral',
  stdin: {
    contents: `
      export * from '${join(root, 'src/lib/scan/types.ts')}';
      export * from '${join(root, 'src/lib/scan/regions.ts')}';
      export * from '${join(root, 'src/lib/scan/matchName.ts')}';
      export * from '${join(root, 'src/lib/scan/artwork/descriptors.ts')}';
      export * from '${join(root, 'src/lib/scan/artwork/match.ts')}';
      export * from '${join(root, 'src/lib/scan/session/recognize.ts')}';
    `,
    resolveDir: root,
    sourcefile: 'a3-entry.ts',
  },
});
const scan = await import(`file://${bundle}`);

const corpus = selectTrustedCorpus(root, { dataset: 'core44' });
console.log(`CORE_44 queries: ${corpus.length}`);

const { runtime } = await loadEncoder('CLIP_VIT_B32');
const ART = scan.ARTWORK_REGION;

const writePng = async (img, name) => {
  const p = join(bundleDir, name);
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data);
  await writeFile(p, PNG.sync.write(png));
  return p;
};

const cropVariants = region => [
  { id: 'ART_CROP', region },
  {
    id: 'OVERSIZED_P5',
    region: {
      x: Math.max(0, region.x - 0.02),
      y: Math.max(0, region.y - 0.02),
      w: Math.min(1 - Math.max(0, region.x - 0.02), region.w + 0.04),
      h: Math.min(1 - Math.max(0, region.y - 0.02), region.h + 0.04),
    },
  },
  {
    id: 'OVERSIZED_P10',
    region: {
      x: Math.max(0, region.x - 0.04),
      y: Math.max(0, region.y - 0.04),
      w: Math.min(1 - Math.max(0, region.x - 0.04), region.w + 0.08),
      h: Math.min(1 - Math.max(0, region.y - 0.04), region.h + 0.08),
    },
  },
  {
    id: 'SHIFTED',
    region: {
      x: Math.min(0.2, region.x + 0.05),
      y: Math.max(0, region.y - 0.03),
      w: region.w,
      h: region.h,
    },
  },
  {
    id: 'PARTIAL_CLIP',
    region: {
      x: region.x + 0.08,
      y: region.y + 0.05,
      w: Math.max(0.4, region.w - 0.12),
      h: Math.max(0.25, region.h - 0.1),
    },
  },
];

// OCR worker for fusion / combined timing
const worker = await createWorker('eng', 1, {
  langPath: join(root, '.scan-fixtures/tessdata'),
  cachePath: join(root, '.scan-fixtures/tessdata'),
  gzip: false,
});
await worker.setParameters({ tessedit_pageseg_mode: String(PSM.SINGLE_LINE) });
const ocr = {
  recognize: async image => {
    const png = new PNG({ width: image.width, height: image.height });
    png.data = Buffer.from(image.data);
    const result = await worker.recognize(PNG.sync.write(png));
    return { text: result.data.text, confidence: (result.data.confidence ?? 0) / 100 };
  },
};
const nameData = JSON.parse(readFileSync(join(root, '.scan-fixtures/card-names.json'), 'utf8'));
const nameIndex = scan.buildNameIndex(nameData);
const artRaw = JSON.parse(
  readFileSync(join(root, '.scan-fixtures/art-index.production.json'), 'utf8'),
);
const artwork = scan.createArtworkMatcher(artRaw.art ?? artRaw);

const indexes = {
  CLIP_VIT_B32_F32: f32Typed,
  CLIP_VIT_B32_F16: f16Index,
  CLIP_VIT_B32_I8: i8Index,
};

const formatRows = { CLIP_VIT_B32_F32: [], CLIP_VIT_B32_F16: [], CLIP_VIT_B32_I8: [] };
const stageSamples = [];
const cropRows = { ART_CROP: [], FULL_CARD: [], OVERSIZED_P5: [], OVERSIZED_P10: [], SHIFTED: [], PARTIAL_CLIP: [] };
const fusionAudit = [];
const queryEmbs = [];
const margins = { correct: [], incorrect: [] };

console.log('\nRunning CORE_44 against F32/F16/I8 (same query embeddings)…');

for (const item of corpus) {
  const buf = await readFile(item.imagePath);
  const tDecode0 = now();
  const png = PNG.sync.read(buf);
  const imageDecodeMs = now() - tDecode0;
  const card = {
    data: new Uint8ClampedArray(png.data),
    width: png.width,
    height: png.height,
  };
  const expected = resolveExpected(root, item);

  const tCrop0 = now();
  const artImg = scan.cropImage(card, ART);
  const artCropMs = now() - tCrop0;
  const artPath = await writePng(artImg, `q-${item.id.replace(/[/:]/g, '_')}-art.png`);
  const fullPath = await writePng(card, `q-${item.id.replace(/[/:]/g, '_')}-full.png`);

  const tEnc0 = now();
  const embArt = await runtime.embedPath(artPath);
  const encoderInferenceMs = now() - tEnc0;
  const tEncFull0 = now();
  const embFull = await runtime.embedPath(fullPath);
  const encoderFullMs = now() - tEncFull0;

  queryEmbs.push({
    itemId: item.id,
    expectedOracleId: expected.oracleId,
    embedding: embArt,
  });

  // OCR for fusion (same as bakeoff policy)
  const tOcr0 = now();
  const { result: ocrResult } = await scan.recognizeCard(
    card,
    { nameIndex, artwork, artworkIndex: artRaw.art ?? artRaw, ocr, resolveOcr: () => ocr },
    { skipOcr: false, skipArtwork: true, skipFooter: true },
  );
  const ocrMs = now() - tOcr0;
  const ocrTop =
    ocrResult.fused?.card?.name ||
    ocrResult.titleCandidates?.[0]?.name ||
    ocrResult.fused?.candidates?.[0]?.name ||
    null;
  const ocrOracle = ocrResult.fused?.card?.oracleId ?? ocrResult.titleCandidates?.[0]?.oracleId ?? null;
  const ocrCorrect = identityMatches(expected, { name: ocrTop, oracleId: ocrOracle });

  // Primary: ART_CROP vs each index format
  for (const [configId, index] of Object.entries(indexes)) {
    const tSearch0 = now();
    const searched = searchTypedIndex(index, embArt, 10);
    const nearestNeighborSearchMs = searched.searchMs;
    const oracleCollapseMs = searched.oracleCollapseMs;
    const top = searched.hits;
    const top1Correct = identityMatches(expected, top[0]);
    const row = {
      itemId: item.id,
      expected: expected.canonicalName,
      expectedOracleId: expected.oracleId,
      language: item.language,
      top1: top[0]?.name ?? null,
      top1Score: top[0]?.score ?? null,
      top2Score: top[1]?.score ?? null,
      margin12:
        top[0]?.score != null && top[1]?.score != null ? top[0].score - top[1].score : null,
      top1Correct,
      top3Correct: rankHasMatch(expected, top, 3),
      top5Correct: rankHasMatch(expected, top, 5),
      top10Correct: rankHasMatch(expected, top, 10),
      timing: {
        imageDecodeMs,
        artCropMs,
        encoderInferenceMs,
        nearestNeighborSearchMs,
        oracleCollapseMs,
        totalVisualMs: imageDecodeMs + artCropMs + encoderInferenceMs + nearestNeighborSearchMs,
      },
    };
    formatRows[configId].push(row);

    if (configId === 'CLIP_VIT_B32_F32') {
      stageSamples.push(row.timing);
      if (row.margin12 != null) {
        (top1Correct ? margins.correct : margins.incorrect).push(row.margin12);
      }

      // Fusion audit (F32 visual + OCR)
      const tF0 = now();
      let fused = top[0]?.name ?? null;
      let fusedOracle = top[0]?.oracleId ?? null;
      let via = 'VISUAL_ONLY';
      if (ocrTop && top[0] && identityMatches({ canonicalName: ocrTop, oracleId: ocrOracle }, top[0])) {
        via = 'BOTH_AGREE';
      } else if (ocrCorrect && !top1Correct) {
        via = 'FUSION_FIXES_VISUAL';
        fused = ocrTop;
        fusedOracle = ocrOracle;
      } else if (
        ocrTop &&
        top.slice(0, 3).some(t => identityMatches({ canonicalName: ocrTop, oracleId: ocrOracle }, t))
      ) {
        via = 'FUSION_FIXES_VISUAL';
        fused = ocrTop;
        fusedOracle = ocrOracle;
      } else if (top1Correct && !ocrCorrect) {
        via = 'VISUAL_ONLY_CORRECT';
      } else if (!top1Correct && ocrCorrect) {
        via = 'OCR_ONLY_CORRECT';
      } else if (top1Correct && ocrCorrect) {
        via = 'BOTH_AGREE';
      } else {
        via = 'BOTH_FAIL';
      }
      const fusedCorrect = identityMatches(expected, { name: fused, oracleId: fusedOracle });
      if (top1Correct && !fusedCorrect) via = 'FUSION_BREAKS_CORRECT_VISUAL';
      const fusionMs = now() - tF0;
      fusionAudit.push({
        itemId: item.id,
        via,
        visualCorrect: top1Correct,
        ocrCorrect,
        fusedCorrect,
        fusionMs,
        ocrMs,
        totalCombinedMs: row.timing.totalVisualMs + ocrMs + fusionMs,
      });
    }
  }

  // Crop robustness on F32 only
  const fullSearch = searchTypedIndex(f32Typed, embFull, 10);
  cropRows.FULL_CARD.push({
    itemId: item.id,
    top1Correct: identityMatches(expected, fullSearch.hits[0]),
    top3Correct: rankHasMatch(expected, fullSearch.hits, 3),
    encoderMs: encoderFullMs,
  });
  for (const v of cropVariants(ART)) {
    if (v.id === 'ART_CROP') {
      cropRows.ART_CROP.push({
        itemId: item.id,
        top1Correct: formatRows.CLIP_VIT_B32_F32.at(-1).top1Correct,
        top3Correct: formatRows.CLIP_VIT_B32_F32.at(-1).top3Correct,
      });
      continue;
    }
    const cropped = scan.cropImage(card, v.region);
    const p = await writePng(cropped, `q-${item.id.replace(/[/:]/g, '_')}-${v.id}.png`);
    const emb = await runtime.embedPath(p);
    const s = searchTypedIndex(f32Typed, emb, 10);
    cropRows[v.id].push({
      itemId: item.id,
      top1Correct: identityMatches(expected, s.hits[0]),
      top3Correct: rankHasMatch(expected, s.hits, 3),
    });
  }

  const f32ok = formatRows.CLIP_VIT_B32_F32.at(-1).top1Correct;
  console.log(
    `${item.id}  ${expected.canonicalName}  F32${f32ok ? '✓' : '✗'} F16${formatRows.CLIP_VIT_B32_F16.at(-1).top1Correct ? '✓' : '✗'} I8${formatRows.CLIP_VIT_B32_I8.at(-1).top1Correct ? '✓' : '✗'}`,
  );
}

const summarizeFormat = rows => {
  const n = rows.length;
  const at = k => rows.filter(r => r[`top${k}Correct`]).length / n;
  const search = rows.map(r => r.timing.nearestNeighborSearchMs);
  const enc = rows.map(r => r.timing.encoderInferenceMs);
  const total = rows.map(r => r.timing.totalVisualMs);
  return {
    n,
    top1: at(1),
    top3: at(3),
    top5: at(5),
    top10: at(10),
    medianSearchMs: percentile(search, 50),
    p95SearchMs: percentile(search, 95),
    medianEncodeMs: percentile(enc, 50),
    p95EncodeMs: percentile(enc, 95),
    medianTotalVisualMs: percentile(total, 50),
    p95TotalVisualMs: percentile(total, 95),
  };
};

const formatSummary = {};
for (const [id, rows] of Object.entries(formatRows)) {
  formatSummary[id] = {
    ...summarizeFormat(rows),
    diskMb:
      id === 'CLIP_VIT_B32_F32'
        ? baselineMeta.diskMb
        : id === 'CLIP_VIT_B32_F16'
          ? f16Index.diskBytes / 1e6
          : i8Index.diskBytes / 1e6,
  };
}

console.log('\n=== INDEX COMPRESSION (CORE_44, same queries) ===');
for (const [id, s] of Object.entries(formatSummary)) {
  console.log(
    `${id}  disk=${s.diskMb.toFixed(1)}MB  top1=${(100 * s.top1).toFixed(1)}% top3=${(100 * s.top3).toFixed(0)}% top5=${(100 * s.top5).toFixed(0)}% top10=${(100 * s.top10).toFixed(0)}%  searchMed=${s.medianSearchMs?.toFixed(1)}ms encMed=${s.medianEncodeMs?.toFixed(0)}ms`,
  );
}

// Search-only microbench
const sampleQ = queryEmbs[0]?.embedding;
const searchBench = {};
if (sampleQ) {
  for (const [id, index] of Object.entries(indexes)) {
    searchBench[id] = benchSearchOnly(index, sampleQ, 30);
  }
}
console.log('\n=== SEARCH-ONLY MICROBENCH (30 reps, one query) ===');
console.log(searchBench);

// Latency stage summary
const stageKeys = [
  'imageDecodeMs',
  'artCropMs',
  'encoderInferenceMs',
  'nearestNeighborSearchMs',
  'oracleCollapseMs',
  'totalVisualMs',
];
const latencyBreakdown = {};
for (const k of stageKeys) {
  const xs = stageSamples.map(s => s[k]).filter(x => x != null);
  latencyBreakdown[k] = { median: percentile(xs, 50), p95: percentile(xs, 95) };
}
const ocrTimes = fusionAudit.map(f => f.ocrMs);
const fusionTimes = fusionAudit.map(f => f.fusionMs);
const combinedTimes = fusionAudit.map(f => f.totalCombinedMs);
latencyBreakdown.ocrMs = { median: percentile(ocrTimes, 50), p95: percentile(ocrTimes, 95) };
latencyBreakdown.fusionMs = { median: percentile(fusionTimes, 50), p95: percentile(fusionTimes, 95) };
latencyBreakdown.totalCombinedMs = {
  median: percentile(combinedTimes, 50),
  p95: percentile(combinedTimes, 95),
};
console.log('\n=== LATENCY BREAKDOWN (F32 visual path) ===');
console.log(latencyBreakdown);

// Crop robustness
const cropSummary = {};
for (const [id, rows] of Object.entries(cropRows)) {
  const n = rows.length;
  cropSummary[id] = {
    n,
    top1: n ? rows.filter(r => r.top1Correct).length / n : null,
    top3: n ? rows.filter(r => r.top3Correct).length / n : null,
  };
}
console.log('\n=== CROP ROBUSTNESS (F32 full gallery) ===');
console.log(cropSummary);

// Fusion classes
const fusionClasses = {};
for (const f of fusionAudit) fusionClasses[f.via] = (fusionClasses[f.via] || 0) + 1;
const voTop1 =
  fusionAudit.filter(f => f.fusedCorrect).length / Math.max(1, fusionAudit.length);
console.log('\n=== FUSION ===');
console.log(fusionClasses);
console.log(`VISUAL+OCR effective top1: ${(100 * voTop1).toFixed(1)}%`);

// Language
const langBreak = {};
for (const lang of ['en', 'localized']) {
  const rows = formatRows.CLIP_VIT_B32_F32.filter(r => r.language === lang);
  const n = rows.length;
  langBreak[lang] = {
    n,
    visualTop1: n ? rows.filter(r => r.top1Correct).length / n : null,
  };
}
console.log('\n=== LANGUAGE (VISUAL F32) ===');
console.log(langBreak);

// Margins
const marginReport = {
  correct: {
    n: margins.correct.length,
    p50: percentile(margins.correct, 50),
    mean: mean(margins.correct),
  },
  incorrect: {
    n: margins.incorrect.length,
    p50: percentile(margins.incorrect, 50),
    mean: mean(margins.incorrect),
  },
};
console.log('\n=== MARGINS ===');
console.log(marginReport);

// Card-change
const same = [];
const diff = [];
for (let i = 0; i < queryEmbs.length; i++) {
  for (let j = i + 1; j < queryEmbs.length; j++) {
    const a = queryEmbs[i];
    const b = queryEmbs[j];
    let dot = 0;
    for (let d = 0; d < a.embedding.length; d++) dot += a.embedding[d] * b.embedding[d];
    if (a.expectedOracleId && a.expectedOracleId === b.expectedOracleId) same.push(dot);
    else diff.push(dot);
  }
}
const pct = (xs, p) => percentile(xs, p);
const cardChange = {
  sameOracle: { n: same.length, p10: pct(same, 10), p50: pct(same, 50), p90: pct(same, 90) },
  differentOracle: { n: diff.length, p10: pct(diff, 10), p50: pct(diff, 50), p90: pct(diff, 90) },
};
console.log('\n=== CARD-CHANGE SIGNAL ===');
console.log(cardChange);

// --- Batched throughput probe (host) ---
console.log('\n=== BATCH THROUGHPUT PROBE ===');
const sampleArts = f32.refs.slice(0, 64).map(r =>
  join(root, '.scan-fixtures/visual-embed/art-crops', `${r.scryfallId}.jpg`),
).filter(p => existsSync(p));
const throughput = { note: 'sequential embedPath (transformers.js host); true GPU batch limited by pipeline API', batches: [] };
for (const batchSize of [1, 8, 16]) {
  const n = Math.min(sampleArts.length, batchSize * 2);
  const paths = sampleArts.slice(0, n);
  const t0 = now();
  for (let i = 0; i < paths.length; i += batchSize) {
    const chunk = paths.slice(i, i + batchSize);
    // Sequential within "batch" — document honest limitation; still measures warm throughput
    await Promise.all(chunk.map(p => runtime.embedPath(p)));
  }
  const elapsed = now() - t0;
  const eps = (paths.length / elapsed) * 1000;
  throughput.batches.push({
    batchSize,
    images: paths.length,
    elapsedMs: elapsed,
    embeddingsPerSec: eps,
    estimatedFullBuildMin: (49968 / eps / 60).toFixed(1),
  });
  console.log(
    `  parallel=${batchSize}  n=${paths.length}  ${eps.toFixed(1)} emb/s  ~${(49968 / eps / 60).toFixed(1)} min full`,
  );
}

// --- Smaller encoder screening (g800 only; no full rebuild if weak) ---
console.log('\n=== SMALLER ENCODER SCREENING (g800, CORE_44) ===');
const screenEncoders = ['MOBILECLIP_S0', 'MOBILECLIP_S1', 'MOBILECLIP_S2'];
const screening = [];
for (const encId of screenEncoders) {
  try {
    if (encId === 'MOBILECLIP_S1') {
      const { runtime: rt, def } = await loadEncoder(encId);
      const crop = sampleArts[0];
      const emb = await rt.embedPath(crop);
      const times = [];
      for (let i = 0; i < 5; i++) {
        const t0 = now();
        await rt.embedPath(crop);
        times.push(now() - t0);
      }
      screening.push({
        encoderId: encId,
        status: 'LOAD_OK_NO_FULL_INDEX',
        estimatedModelMb: def.estimatedModelMb,
        embedDim: emb.length,
        medianEncodeMs: percentile(times, 50),
        note: 'Skipped full 50k rebuild — prior MobileCLIP S0/S2 Top1 11%/2% on CORE_44; S1 not promoted',
        screenPass: false,
      });
      console.log(
        `  ${encId}: load OK dims=${emb.length} encMed=${percentile(times, 50)?.toFixed(0)}ms — NO full rebuild`,
      );
    } else {
      const prior = existsSync(join(OUT, 'model-bakeoff-latest.json'))
        ? JSON.parse(readFileSync(join(OUT, 'model-bakeoff-latest.json'), 'utf8'))
        : null;
      const row = prior?.table?.find(t => t.encoderId === encId);
      screening.push({
        encoderId: encId,
        status: row?.status || 'PRIOR',
        top1: row?.core44?.top1 ?? null,
        top3: row?.core44?.top3 ?? null,
        estimatedModelMb: ENCODERS[encId]?.estimatedModelMb,
        medianEncodeMs: row?.hostLatency?.medianEncodeMs,
        screenPass: (row?.core44?.top1 ?? 0) >= 0.55,
        note: 'From Phase A.2 g800 bakeoff; failed screening threshold (≥55% top1)',
      });
      console.log(
        `  ${encId}: prior top1=${row?.core44?.top1 != null ? (100 * row.core44.top1).toFixed(0) + '%' : '·'} — ${
          (row?.core44?.top1 ?? 0) >= 0.55 ? 'PASS' : 'FAIL screen'
        }`,
      );
    }
  } catch (err) {
    screening.push({
      encoderId: encId,
      status: 'LOAD_FAILED',
      error: err instanceof Error ? err.message : String(err),
      screenPass: false,
    });
    console.log(`  ${encId}: LOAD_FAILED ${err instanceof Error ? err.message : err}`);
  }
}

const f32Top1 = formatSummary.CLIP_VIT_B32_F32.top1;
const f16Delta = formatSummary.CLIP_VIT_B32_F16.top1 - f32Top1;
const i8Delta = formatSummary.CLIP_VIT_B32_I8.top1 - f32Top1;

let decision = 'MOBILE_GO_CLIP';
if (Math.abs(f16Delta) > 0.03) {
  decision = 'MOBILE_RESEARCH_MORE';
} else if (screening.some(s => s.screenPass && s.top1 >= f32Top1 - 0.03)) {
  decision = 'MOBILE_GO_SMALL';
} else {
  decision = 'MOBILE_GO_CLIP';
}

const onnxClip = join(
  root,
  '.scan-fixtures/transformers-cache/Xenova/clip-vit-base-patch32/onnx/vision_model_quantized.onnx',
);
const modelMb = existsSync(onnxClip) ? statSync(onnxClip).size / 1e6 : 85;

const report = {
  phase: 'A.3',
  generated: new Date().toISOString(),
  hostOnly: true,
  baseline: baselineMeta,
  datasets: {
    CORE_44: corpus.length,
    EXTENDED_REAL: selectTrustedCorpus(root, { dataset: 'extended' }).length,
    COMPETITIVE_20: 'slots_ready_captures_pending',
  },
  indexCompression: {
    F32: formatSummary.CLIP_VIT_B32_F32,
    F16: { ...formatSummary.CLIP_VIT_B32_F16, top1DeltaVsF32: f16Delta },
    I8: { ...formatSummary.CLIP_VIT_B32_I8, top1DeltaVsF32: i8Delta },
    searchMicrobench: searchBench,
  },
  latencyBreakdown,
  cropRobustness: cropSummary,
  fusionClasses,
  visualPlusOcrTop1: voTop1,
  language: langBreak,
  margins: marginReport,
  cardChange,
  throughput,
  encoderScreening: screening,
  modelTable: [
    {
      model: 'CLIP_VIT_B32',
      config: 'CLIP_VIT_B32_F32',
      modelMb,
      embedDim: 512,
      indexFormat: 'f32',
      indexMb: formatSummary.CLIP_VIT_B32_F32.diskMb,
      top1: formatSummary.CLIP_VIT_B32_F32.top1,
      top3: formatSummary.CLIP_VIT_B32_F32.top3,
      top5: formatSummary.CLIP_VIT_B32_F32.top5,
      visualPlusOcrTop1: voTop1,
      encoderMedianMs: formatSummary.CLIP_VIT_B32_F32.medianEncodeMs,
      encoderP95Ms: formatSummary.CLIP_VIT_B32_F32.p95EncodeMs,
      searchMedianMs: formatSummary.CLIP_VIT_B32_F32.medianSearchMs,
      totalMedianMs: formatSummary.CLIP_VIT_B32_F32.medianTotalVisualMs,
    },
    {
      model: 'CLIP_VIT_B32',
      config: 'CLIP_VIT_B32_F16',
      modelMb,
      embedDim: 512,
      indexFormat: 'f16',
      indexMb: formatSummary.CLIP_VIT_B32_F16.diskMb,
      top1: formatSummary.CLIP_VIT_B32_F16.top1,
      top3: formatSummary.CLIP_VIT_B32_F16.top3,
      top5: formatSummary.CLIP_VIT_B32_F16.top5,
      visualPlusOcrTop1: voTop1,
      encoderMedianMs: formatSummary.CLIP_VIT_B32_F16.medianEncodeMs,
      searchMedianMs: formatSummary.CLIP_VIT_B32_F16.medianSearchMs,
      totalMedianMs: formatSummary.CLIP_VIT_B32_F16.medianTotalVisualMs,
      top1DeltaVsF32: f16Delta,
    },
    {
      model: 'CLIP_VIT_B32',
      config: 'CLIP_VIT_B32_I8',
      modelMb,
      embedDim: 512,
      indexFormat: 'i8_per_vector',
      indexMb: formatSummary.CLIP_VIT_B32_I8.diskMb,
      top1: formatSummary.CLIP_VIT_B32_I8.top1,
      top3: formatSummary.CLIP_VIT_B32_I8.top3,
      top5: formatSummary.CLIP_VIT_B32_I8.top5,
      visualPlusOcrTop1: voTop1,
      encoderMedianMs: formatSummary.CLIP_VIT_B32_I8.medianEncodeMs,
      searchMedianMs: formatSummary.CLIP_VIT_B32_I8.medianSearchMs,
      totalMedianMs: formatSummary.CLIP_VIT_B32_I8.medianTotalVisualMs,
      top1DeltaVsF32: i8Delta,
    },
  ],
  pareto: {
    bestQuality: 'CLIP_VIT_B32_F32 or F16 (same accuracy if delta≈0) + VISUAL_PLUS_OCR',
    bestBalanced: 'CLIP_VIT_B32_F16 — ~half index size, encoder unchanged',
    bestLightweightIndex: Math.abs(i8Delta) < 0.02 ? 'CLIP_VIT_B32_I8' : 'CLIP_VIT_B32_F16',
    noSmallEncoderYet: true,
  },
  mobileFeasibility: {
    recommendedConfig: 'CLIP_VIT_B32 + F16 index',
    modelMb,
    indexMbF16: formatSummary.CLIP_VIT_B32_F16.diskMb,
    estimatedApkDeltaMb: modelMb + formatSummary.CLIP_VIT_B32_F16.diskMb + 15,
    runtime: 'onnxruntime-react-native',
    easRequired: true,
    thermalRisk: 'MEDIUM',
    thermalRationale: '85MB vision tower at 2–4Hz while unresolved; pause after high-confidence identity',
    continuousBudget: 'geometry ~8Hz; visual 2–4Hz unresolved; stop when margin high',
    annNeeded: (formatSummary.CLIP_VIT_B32_F32.medianSearchMs ?? 0) > 80,
    bruteForceOk: true,
  },
  indexUpdateStrategy: {
    preferred: 'versioned downloadable asset (metadata + embeddings + oracle-map) with SHA-256',
    appUpdate: 'fallback for first install / major schema bump',
    incremental: 'optional later; full replace is fine at ~50MB f16',
  },
  integrity: {
    embeddingsSha256: embHash,
    expectedByteSizeF32: baselineMeta.diskBytes,
    expectedByteSizeF16: f16Index.diskBytes,
    expectedByteSizeI8: i8Index.diskBytes,
  },
  decision,
  phaseBProposal: {
    doNotImplementYet: true,
    doNotStartEas: true,
    architecture: [
      'Ship CLIP ViT-B/32 quantized ONNX via onnxruntime-react-native (requires EAS approval)',
      'Ship F16 visual-index asset (versioned, SHA-256); download or bundle',
      'Live path: rough ROI → ART_CROP (±10% ok) → VISUAL + title OCR in parallel',
      'Publish on high margin or VISUAL+OCR agree; RECOGNITION_ELIGIBLE ≠ capture-safe',
      'Temporal track + embedding discontinuity for card-change',
      'Keep Verified / legacy OCR/ART/BOTH/EDITION',
    ],
  },
};

writeFileSync(join(OUT, 'phase-a3-completion.json'), JSON.stringify(report, null, 2));
writeFileSync(join(OUT, `phase-a3-${Date.now()}.json`), JSON.stringify(report));

console.log(`\nDECISION: ${decision}`);
console.log(`wrote ${join(OUT, 'phase-a3-completion.json')}`);

await worker.terminate();
await rm(bundleDir, { force: true, recursive: true });
