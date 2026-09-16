#!/usr/bin/env node
/**
 * Host recognition bakeoff — SAME pixels through every engine.
 *
 *   yarn recognition:bakeoff --dataset core44 --gallery 800 --encoder CLIP_VIT_B32
 *   yarn recognition:bakeoff --dataset core44 --gallery full --encoder CLIP_VIT_B32
 *
 * Engines: LEGACY_OCR | LEGACY_ART | LEGACY_BOTH | VISUAL | VISUAL_PLUS_OCR
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createWorker, PSM } from 'tesseract.js';
import { PNG } from 'pngjs';
import * as esbuild from 'esbuild';

import { DEFAULT_ENCODER_ID, loadEncoder } from './encoders.mjs';
import { loadGalleryIndex, loadLegacyJsonIndex, searchGallery } from './gallery.mjs';
import {
  identityMatches,
  rankHasMatch,
  resolveExpected,
} from './scoring.mjs';
import { selectTrustedCorpus } from './trusted-corpus.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const flag = name => process.argv.includes(`--${name}`);
const opt = name => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const limit = opt('limit') ? Number(opt('limit')) : Infinity;
const legacyOnly = flag('legacy-only');
const dataset = opt('dataset') || 'core44';
const galleryArg = opt('gallery') || '800';
const gallery = galleryArg === 'full' ? 'full' : Number(galleryArg);
const encoderId = (opt('encoder') || DEFAULT_ENCODER_ID).toUpperCase();

const now = () =>
  typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

const percentile = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

const summarizeEngine = (rows, engine) => {
  const xs = rows.filter(r => r.engine === engine);
  const n = xs.length;
  const atk = k => (n ? xs.filter(r => r[`top${k}Correct`]).length / n : 0);
  const lats = xs.map(r => r.latencyMs).filter(x => x != null);
  const enc = xs.map(r => r.timing?.encodeMs).filter(x => x != null);
  const sch = xs.map(r => r.timing?.searchMs).filter(x => x != null);
  return {
    engine,
    n,
    top1: atk(1),
    top3: atk(3),
    top5: atk(5),
    top10: atk(10),
    medianMs: percentile(lats, 50),
    p95Ms: percentile(lats, 95),
    medianEncodeMs: percentile(enc, 50),
    medianSearchMs: percentile(sch, 50),
    p95SearchMs: percentile(sch, 95),
  };
};

const byLanguage = (rows, engine) => {
  const out = {};
  for (const lang of ['en', 'localized']) {
    const xs = rows.filter(r => r.engine === engine && r.language === lang);
    const n = xs.length;
    out[lang] = {
      n,
      top1: n ? xs.filter(r => r.top1Correct).length / n : null,
      top3: n ? xs.filter(r => r.top3Correct).length / n : null,
    };
  }
  return out;
};

// --- Bundle portable scan libs ---
const bundleDir = await mkdtemp(join(tmpdir(), 'lugin-bakeoff-'));
const bundle = join(bundleDir, 'scan.mjs');
await esbuild.build({
  bundle: true,
  format: 'esm',
  outfile: bundle,
  platform: 'neutral',
  stdin: {
    contents: `
      export * from '${join(root, 'src/lib/scan/types.ts')}';
      export * from '${join(root, 'src/lib/scan/geometry.ts')}';
      export * from '${join(root, 'src/lib/scan/regions.ts')}';
      export * from '${join(root, 'src/lib/scan/matchName.ts')}';
      export * from '${join(root, 'src/lib/scan/artwork/descriptors.ts')}';
      export * from '${join(root, 'src/lib/scan/artwork/match.ts')}';
      export * from '${join(root, 'src/lib/scan/session/recognize.ts')}';
      export * from '${join(root, 'src/lib/scan/recognizeCaptured.ts')}';
      export * from '${join(root, 'src/lib/scan/titleDecode.ts')}';
    `,
    resolveDir: root,
    sourcefile: 'bakeoff-entry.ts',
  },
});
const scan = await import(pathToFileURL(bundle).href);

const nameIndexPath = join(root, '.scan-fixtures/card-names.json');
const artIndexPath = existsSync(join(root, '.scan-fixtures/art-index.production.json'))
  ? join(root, '.scan-fixtures/art-index.production.json')
  : join(root, '.scan-fixtures/art-index.json');

const nameData = JSON.parse(await readFile(nameIndexPath, 'utf8'));
const nameIndex = scan.buildNameIndex(nameData);
const artRaw = JSON.parse(await readFile(artIndexPath, 'utf8'));
const artwork = scan.createArtworkMatcher(artRaw.art ?? artRaw);

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
    const buf = PNG.sync.write(png);
    const result = await worker.recognize(buf);
    return {
      text: result.data.text,
      confidence: (result.data.confidence ?? 0) / 100,
      words: (result.data.words ?? []).map(w => ({
        text: w.text,
        confidence: (w.confidence ?? 0) / 100,
      })),
    };
  },
};

let corpus = selectTrustedCorpus(root, { dataset }).slice(0, limit);
console.log(`\n=== recognition bakeoff ===`);
console.log(`dataset: ${dataset}  corpus: ${corpus.length}`);
console.log(`gallery: ${gallery === 'full' ? 'full' : gallery}  encoder: ${encoderId}`);
console.log(`name index: ${nameData.names?.length ?? nameData.entries?.length ?? '?'}`);
console.log(`art index: ${(artRaw.art?.entries ?? artRaw.entries ?? []).length}`);

/** Formal art crop (matches src/lib/scan/regions ARTWORK_REGION). */
const ART_CROP = { ...scan.ARTWORK_REGION };
console.log(`art crop region: ${JSON.stringify(ART_CROP)}`);

let visualIndex = null;
let encoderRuntime = null;
if (!legacyOnly) {
  visualIndex = loadGalleryIndex(encoderId, gallery);
  if (!visualIndex && gallery !== 'full' && Number(gallery) === 800) {
    const legacyPath = join(root, '.scan-fixtures/visual-embed/clip-vit-b32-gallery800.json');
    const alt = existsSync(legacyPath)
      ? legacyPath
      : join(root, '.scan-fixtures/visual-embed/clip-vit-b32-index.json');
    visualIndex = loadLegacyJsonIndex(alt);
    if (visualIndex) console.log(`visual index: legacy JSON ${visualIndex.count} @ ${alt}`);
  }
  if (!visualIndex) {
    console.warn(
      `\nVISUAL engines skipped — build index first:\n` +
        `  yarn recognition:visual-index --gallery ${galleryArg} --encoder ${encoderId}\n`,
    );
  } else {
    console.log(
      `visual index: ${visualIndex.count} arts / ${visualIndex.metadata.oracleIdentities ?? '?'} oracles · ${encoderId}`,
    );
    try {
      ({ runtime: encoderRuntime } = await loadEncoder(encoderId));
    } catch (err) {
      console.warn(`encoder load failed: ${err instanceof Error ? err.message : err}`);
      visualIndex = null;
    }
  }
} else {
  console.log('legacy-only: skipping VISUAL / VISUAL_PLUS_OCR');
}

const rows = [];
const fusionAudit = [];
const queryEmbeddings = []; // for card-change signal

const cropVariants = (card, region) => {
  const variants = [
    { id: 'canonical', region },
    {
      id: 'oversized',
      region: {
        x: Math.max(0, region.x - 0.04),
        y: Math.max(0, region.y - 0.04),
        w: Math.min(1 - Math.max(0, region.x - 0.04), region.w + 0.08),
        h: Math.min(1 - Math.max(0, region.y - 0.04), region.h + 0.08),
      },
    },
    {
      id: 'shifted',
      region: {
        x: Math.min(0.2, region.x + 0.05),
        y: Math.max(0, region.y - 0.03),
        w: region.w,
        h: region.h,
      },
    },
  ];
  return variants;
};

const writeTempPng = async (image, name) => {
  const p = join(bundleDir, name);
  const png = new PNG({ width: image.width, height: image.height });
  png.data = Buffer.from(image.data);
  await writeFile(p, PNG.sync.write(png));
  return p;
};

const topNames = (cands, k = 10) =>
  (cands ?? []).slice(0, k).map(c => ({
    name: c.name,
    oracleId: c.oracleId ?? null,
    score: c.score ?? null,
  }));

for (const item of corpus) {
  const buf = await readFile(item.imagePath);
  const png = PNG.sync.read(buf);
  const cardImg = {
    data: new Uint8ClampedArray(png.data),
    height: png.height,
    width: png.width,
  };
  const expected = resolveExpected(root, item);

  const runLegacy = async (engine, options) => {
    const t0 = now();
    const { result } = await scan.recognizeCard(
      cardImg,
      { nameIndex, artwork, artworkIndex: artRaw.art ?? artRaw, ocr, resolveOcr: () => ocr },
      options,
    );
    const latencyMs = now() - t0;
    const cands = [];
    if (result.fused?.card?.name) {
      cands.push({
        name: result.fused.card.name,
        oracleId: result.fused.card.oracleId ?? null,
        score: result.fused.card.confidence ?? null,
      });
    }
    for (const c of result.fused?.candidates ?? []) {
      cands.push({
        name: c.name ?? c.card?.name,
        oracleId: c.oracleId ?? c.card?.oracleId ?? null,
        score: c.score ?? c.titleScore ?? c.visualScore ?? null,
      });
    }
    for (const c of result.titleCandidates ?? []) {
      cands.push({ name: c.name, oracleId: c.oracleId ?? null, score: c.score });
    }
    for (const c of result.visualTop ?? []) {
      cands.push({ name: c.name, oracleId: c.oracleId ?? null, score: c.score });
    }
    const dedup = [];
    const seen = new Set();
    for (const c of cands) {
      if (!c.name) continue;
      const k = `${c.oracleId || ''}|${c.name}`.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      dedup.push(c);
    }
    const top = topNames(dedup, 10);
    return {
      engine,
      itemId: item.id,
      expected: expected.canonicalName,
      expectedOracleId: expected.oracleId,
      language: item.language,
      source: item.source,
      quality: item.quality ?? 'GOOD_INPUT',
      top1: top[0]?.name ?? null,
      top1OracleId: top[0]?.oracleId ?? null,
      top1Score: top[0]?.score ?? null,
      top2Score: top[1]?.score ?? null,
      margin: top[0]?.score != null && top[1]?.score != null ? top[0].score - top[1].score : null,
      top3: top.slice(0, 3),
      top10: top,
      top1Correct: identityMatches(expected, top[0]),
      top3Correct: rankHasMatch(expected, top, 3),
      top5Correct: rankHasMatch(expected, top, 5),
      top10Correct: rankHasMatch(expected, top, 10),
      latencyMs,
    };
  };

  rows.push(
    await runLegacy('LEGACY_OCR', { skipOcr: false, skipArtwork: true, skipFooter: true }),
  );
  rows.push(
    await runLegacy('LEGACY_ART', { skipOcr: true, skipArtwork: false, skipFooter: true }),
  );
  rows.push(
    await runLegacy('LEGACY_BOTH', { skipOcr: false, skipArtwork: false, skipFooter: true }),
  );

  if (encoderRuntime && visualIndex) {
    const tPre0 = now();
    const fullPath = await writeTempPng(cardImg, `q-${rows.length}-full.png`);
    const variants = cropVariants(cardImg, ART_CROP);
    const variantHits = [];
    for (const v of variants) {
      const cropped = scan.cropImage(cardImg, v.region);
      const artPath = await writeTempPng(cropped, `q-${rows.length}-${v.id}.png`);
      const tEnc0 = now();
      const emb = await encoderRuntime.embedPath(artPath);
      const encodeMs = now() - tEnc0;
      const { hits, searchMs } = searchGallery(visualIndex, emb, 10);
      variantHits.push({
        id: v.id,
        hits,
        encodeMs,
        searchMs,
        top1Score: hits[0]?.score ?? 0,
        emb,
      });
    }
    const preprocessMs = now() - tPre0;

    // Prefer highest top1 score among crop variants (canonical usually wins).
    variantHits.sort((a, b) => b.top1Score - a.top1Score);
    const best = variantHits[0];
    const fullEmb = await encoderRuntime.embedPath(fullPath);
    const fullSearch = searchGallery(visualIndex, fullEmb, 10);
    const useFull = (fullSearch.hits[0]?.score ?? 0) > (best.top1Score ?? 0);
    const chosen = useFull
      ? {
          id: 'full_card',
          hits: fullSearch.hits,
          encodeMs: best.encodeMs,
          searchMs: fullSearch.searchMs,
          emb: fullEmb,
        }
      : best;

    queryEmbeddings.push({
      itemId: item.id,
      expectedOracleId: expected.oracleId,
      expectedName: expected.canonicalName,
      embedding: chosen.emb,
    });

    const top = topNames(chosen.hits, 10);
    const visualRow = {
      engine: 'VISUAL',
      itemId: item.id,
      expected: expected.canonicalName,
      expectedOracleId: expected.oracleId,
      language: item.language,
      source: item.source,
      quality: item.quality ?? 'GOOD_INPUT',
      top1: top[0]?.name ?? null,
      top1OracleId: top[0]?.oracleId ?? null,
      top1Score: top[0]?.score ?? null,
      top2Score: top[1]?.score ?? null,
      margin: top[0]?.score != null && top[1]?.score != null ? top[0].score - top[1].score : null,
      top3: top.slice(0, 3),
      top10: top,
      top1Correct: identityMatches(expected, top[0]),
      top3Correct: rankHasMatch(expected, top, 3),
      top5Correct: rankHasMatch(expected, top, 5),
      top10Correct: rankHasMatch(expected, top, 10),
      latencyMs: preprocessMs,
      representation: chosen.id,
      cropSensitivity: variantHits.map(v => ({
        id: v.id,
        top1: v.hits[0]?.name ?? null,
        score: v.top1Score,
        correct: identityMatches(expected, v.hits[0]),
      })),
      timing: {
        preprocessMs,
        encodeMs: chosen.encodeMs,
        searchMs: chosen.searchMs,
        collapseMs: 0,
        fusionMs: 0,
      },
    };
    rows.push(visualRow);

    // VISUAL_PLUS_OCR fusion (documented, not retuned)
    const tF0 = now();
    const ocrRow = [...rows].reverse().find(r => r.engine === 'LEGACY_OCR' && r.itemId === item.id);
    let top1 = visualRow.top1;
    let top1OracleId = visualRow.top1OracleId;
    let top1Score = visualRow.top1Score;
    let topMerged = visualRow.top10;
    let via = 'visual';
    /*
      Fusion policy (host prototype):
      1. If OCR top1 and VISUAL top1 agree (oracle/name) → publish agreement, take max score.
      2. Else if OCR correct and VISUAL wrong → prefer OCR.
      3. Else if OCR top1 appears in VISUAL top3 → promote OCR candidate.
      4. Else keep VISUAL top1.
      Channels are conceptually parallel; this bakeoff fuses post-hoc on same pixels.
    */
    if (ocrRow?.top1 && visualRow?.top1 && identityMatches(
      { canonicalName: ocrRow.top1, oracleId: ocrRow.top1OracleId },
      { name: visualRow.top1, oracleId: visualRow.top1OracleId },
    )) {
      via = 'BOTH_AGREE';
      top1Score = Math.max(ocrRow.top1Score ?? 0, visualRow.top1Score ?? 0);
    } else if (ocrRow?.top1Correct && !visualRow.top1Correct) {
      via = 'FUSION_FIXES_VISUAL';
      top1 = ocrRow.top1;
      top1OracleId = ocrRow.top1OracleId;
      top1Score = ocrRow.top1Score;
      topMerged = ocrRow.top10;
    } else if (
      ocrRow?.top1 &&
      visualRow.top10?.some(t =>
        identityMatches(
          { canonicalName: ocrRow.top1, oracleId: ocrRow.top1OracleId },
          t,
        ),
      )
    ) {
      via = 'FUSION_FIXES_VISUAL';
      top1 = ocrRow.top1;
      top1OracleId = ocrRow.top1OracleId;
      top1Score = Math.max(ocrRow.top1Score ?? 0, 0.5);
      topMerged = [
        { name: top1, oracleId: top1OracleId, score: top1Score },
        ...visualRow.top10.filter(
          t =>
            !identityMatches({ canonicalName: top1, oracleId: top1OracleId }, t),
        ),
      ].slice(0, 10);
    } else if (visualRow.top1Correct && ocrRow && !ocrRow.top1Correct) {
      via = 'VISUAL_ONLY_CORRECT';
    } else if (!visualRow.top1Correct && ocrRow?.top1Correct) {
      via = 'OCR_ONLY_CORRECT';
    } else if (visualRow.top1Correct && ocrRow?.top1Correct) {
      via = 'BOTH_AGREE';
    } else {
      via = 'BOTH_FAIL';
    }

    const fusedCorrect = identityMatches(expected, { name: top1, oracleId: top1OracleId });
    // Detect fusion break: visual was correct, fused wrong
    if (visualRow.top1Correct && !fusedCorrect) via = 'FUSION_BREAKS_CORRECT_RESULT';
    if (!visualRow.top1Correct && ocrRow?.top1Correct && fusedCorrect && via === 'BOTH_FAIL') {
      via = 'FUSION_FIXES_VISUAL';
    }

    const fusionMs = now() - tF0;
    const fusedRow = {
      engine: 'VISUAL_PLUS_OCR',
      itemId: item.id,
      expected: expected.canonicalName,
      expectedOracleId: expected.oracleId,
      language: item.language,
      source: item.source,
      quality: item.quality ?? 'GOOD_INPUT',
      top1,
      top1OracleId,
      top1Score,
      top2Score: topMerged[1]?.score ?? null,
      margin:
        top1Score != null && topMerged[1]?.score != null ? top1Score - topMerged[1].score : null,
      top3: topMerged.slice(0, 3),
      top10: topMerged,
      top1Correct: fusedCorrect,
      top3Correct: rankHasMatch(expected, topMerged, 3) || fusedCorrect,
      top5Correct: rankHasMatch(expected, topMerged, 5) || fusedCorrect,
      top10Correct: rankHasMatch(expected, topMerged, 10) || fusedCorrect,
      latencyMs: (visualRow.latencyMs ?? 0) + fusionMs,
      via,
      timing: { ...visualRow.timing, fusionMs },
    };
    rows.push(fusedRow);

    fusionAudit.push({
      itemId: item.id,
      expected: expected.canonicalName,
      expectedOracleId: expected.oracleId,
      visualTop: visualRow.top10,
      ocrTop1: ocrRow?.top1 ?? null,
      ocrCorrect: ocrRow?.top1Correct ?? false,
      visualCorrect: visualRow.top1Correct,
      fused: top1,
      fusedCorrect,
      via,
    });

    const mark =
      (fusedRow.top1Correct ? '✓' : '✗') +
      (visualRow.top1Correct ? '' : '');
    console.log(
      `${item.id}  expect=${expected.canonicalName}  OCR${rows[rows.length - 5]?.top1Correct ? '✓' : '✗'} ART${rows[rows.length - 4]?.top1Correct ? '✓' : '✗'} BOTH${rows[rows.length - 3]?.top1Correct ? '✓' : '✗'} VIS${visualRow.top1Correct ? '✓' : '✗'} V+O${fusedRow.top1Correct ? '✓' : '✗'}  [${chosen.id}]`,
    );
  } else {
    console.log(
      `${item.id}  expect=${expected.canonicalName}  OCR${rows[rows.length - 3]?.top1Correct ? '✓' : '✗'} ART${rows[rows.length - 2]?.top1Correct ? '✓' : '✗'} BOTH${rows[rows.length - 1]?.top1Correct ? '✓' : '✗'} VIS· V+O·`,
    );
  }
}

const engines = ['LEGACY_OCR', 'LEGACY_ART', 'LEGACY_BOTH', 'VISUAL', 'VISUAL_PLUS_OCR'];
const summary = engines.map(e => summarizeEngine(rows, e)).filter(s => s.n > 0);

console.log(`\n=== SUMMARY (${dataset}, gallery=${galleryArg}, encoder=${encoderId}) ===`);
console.log(
  'engine'.padEnd(18) +
    ['n', 'top1', 'top3', 'top5', 'top10', 'medMs', 'p95Ms', 'schMed'].map(h => h.padStart(7)).join(''),
);
for (const s of summary) {
  const pct = x => (x == null ? '   ·' : `${(100 * x).toFixed(0)}%`.padStart(7));
  const ms = x => (x == null ? '   ·' : `${x.toFixed(0)}`.padStart(7));
  console.log(
    s.engine.padEnd(18) +
      String(s.n).padStart(7) +
      pct(s.top1) +
      pct(s.top3) +
      pct(s.top5) +
      pct(s.top10) +
      ms(s.medianMs) +
      ms(s.p95Ms) +
      ms(s.medianSearchMs),
  );
}

// Language breakdown
console.log('\n=== LANGUAGE ===');
for (const e of ['LEGACY_OCR', 'VISUAL', 'VISUAL_PLUS_OCR']) {
  const b = byLanguage(rows, e);
  if (!rows.some(r => r.engine === e)) continue;
  console.log(
    `${e}  EN n=${b.en.n} top1=${b.en.top1 != null ? (100 * b.en.top1).toFixed(0) : '·'}%  LOC n=${b.localized.n} top1=${b.localized.top1 != null ? (100 * b.localized.top1).toFixed(0) : '·'}%`,
  );
}

// Margin distributions
const marginStats = engine => {
  const xs = rows.filter(r => r.engine === engine);
  const correct = xs.filter(r => r.top1Correct).map(r => r.margin).filter(x => x != null);
  const incorrect = xs.filter(r => !r.top1Correct).map(r => r.margin).filter(x => x != null);
  return {
    correct: { n: correct.length, mean: mean(correct), p50: percentile(correct, 50) },
    incorrect: { n: incorrect.length, mean: mean(incorrect), p50: percentile(incorrect, 50) },
  };
};

// Fusion class counts
const fusionClasses = {};
for (const f of fusionAudit) {
  fusionClasses[f.via] = (fusionClasses[f.via] || 0) + 1;
}
console.log('\n=== FUSION AUDIT ===');
console.log(fusionClasses);

// Hard negatives (visual misses)
const hardNegatives = rows
  .filter(r => r.engine === 'VISUAL' && !r.top1Correct)
  .map(r => ({
    itemId: r.itemId,
    expected: r.expected,
    expectedOracleId: r.expectedOracleId,
    top10: r.top10,
    margin: r.margin,
    note: 'inspect for same-character / similar-composition / alt-art / generic',
  }));
console.log(`\nhard negatives (VISUAL top1 miss): ${hardNegatives.length}`);

// Card-change signal
const cardChange = { sameOracle: [], differentOracle: [] };
for (let i = 0; i < queryEmbeddings.length; i++) {
  for (let j = i + 1; j < queryEmbeddings.length; j++) {
    const a = queryEmbeddings[i];
    const b = queryEmbeddings[j];
    if (!a.embedding || !b.embedding) continue;
    let dot = 0;
    const n = Math.min(a.embedding.length, b.embedding.length);
    for (let d = 0; d < n; d++) dot += a.embedding[d] * b.embedding[d];
    if (a.expectedOracleId && b.expectedOracleId && a.expectedOracleId === b.expectedOracleId) {
      cardChange.sameOracle.push(dot);
    } else {
      cardChange.differentOracle.push(dot);
    }
  }
}
const cardChangeSummary = {
  sameOracle: {
    n: cardChange.sameOracle.length,
    mean: mean(cardChange.sameOracle),
    p50: percentile(cardChange.sameOracle, 50),
  },
  differentOracle: {
    n: cardChange.differentOracle.length,
    mean: mean(cardChange.differentOracle),
    p50: percentile(cardChange.differentOracle, 50),
  },
};
console.log('\n=== CARD-CHANGE EMBEDDING SIGNAL ===');
console.log(cardChangeSummary);

// Gates
const artSum = summary.find(s => s.engine === 'LEGACY_ART');
const visSum = summary.find(s => s.engine === 'VISUAL');
const voSum = summary.find(s => s.engine === 'VISUAL_PLUS_OCR');
const bothSum = summary.find(s => s.engine === 'LEGACY_BOTH');
const ocrSum = summary.find(s => s.engine === 'LEGACY_OCR');
const gain = (visSum?.top1 ?? 0) - (artSum?.top1 ?? 0);

let decision = 'INCOMPLETE_VISUAL';
if (visSum || voSum) {
  const fullOk =
    (visSum?.top1 ?? 0) >= (artSum?.top1 ?? 0) + 0.1 && (visSum?.top3 ?? 0) >= 0.7;
  const voOk = (voSum?.top1 ?? 0) >= (artSum?.top1 ?? 0) + 0.1;
  if (gallery === 'full') {
    decision = fullOk && voOk ? 'GO_FULL_GALLERY' : fullOk ? 'GO_VISUAL_WEAK_FUSION' : 'NO-GO_FULL_GALLERY';
  } else {
    decision =
      (visSum?.top1 ?? 0) >= (artSum?.top1 ?? 0) + 0.1 && (visSum?.top3 ?? 0) >= 0.85
        ? 'GO_GALLERY_PROBE'
        : 'NO-GO_PROBE';
  }
}

console.log(
  `\nLEGACY baseline — OCR top1=${((ocrSum?.top1 ?? 0) * 100).toFixed(0)}%  ART=${((artSum?.top1 ?? 0) * 100).toFixed(0)}%  BOTH=${((bothSum?.top1 ?? 0) * 100).toFixed(0)}%`,
);
if (visSum) console.log(`GATE vs LEGACY_ART top1 gain: ${(100 * gain).toFixed(1)} pp`);
console.log(`DECISION: ${decision}`);

const outDir = join(root, '.scan-fixtures/recognition-bakeoff');
mkdirSync(outDir, { recursive: true });
const stamp = Date.now();
const report = {
  generated: new Date().toISOString(),
  phase: 'A.2',
  dataset,
  gallery: galleryArg,
  encoderId,
  visualIndex: visualIndex
    ? {
        count: visualIndex.count,
        dims: visualIndex.dims,
        oracles: visualIndex.metadata?.oracleIdentities,
        path: visualIndex.outDir,
      }
    : null,
  artCrop: ART_CROP,
  fusionPolicy:
    'agree→max; OCR-correct overrides wrong visual; OCR-in-visual-top3 promotes OCR; else visual',
  corpus: corpus.map(c => ({
    id: c.id,
    expectedName: c.expectedName,
    language: c.language,
    source: c.source,
    quality: c.quality,
  })),
  summary,
  language: {
    LEGACY_OCR: byLanguage(rows, 'LEGACY_OCR'),
    VISUAL: byLanguage(rows, 'VISUAL'),
    VISUAL_PLUS_OCR: byLanguage(rows, 'VISUAL_PLUS_OCR'),
  },
  margins: {
    VISUAL: marginStats('VISUAL'),
    VISUAL_PLUS_OCR: marginStats('VISUAL_PLUS_OCR'),
  },
  fusionClasses,
  fusionAudit,
  hardNegatives,
  cardChangeSummary,
  decision,
  rows,
};

const outPath = join(outDir, `bakeoff-${dataset}-g${galleryArg}-${encoderId}-${stamp}.json`);
writeFileSync(outPath, JSON.stringify(report));
writeFileSync(join(outDir, 'bakeoff-latest.json'), JSON.stringify(report));
console.log(`\nwrote ${outPath}`);

await worker.terminate();
await rm(bundleDir, { force: true, recursive: true });
