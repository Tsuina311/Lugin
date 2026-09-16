#!/usr/bin/env node
/**
 * Mobile-oriented encoder bakeoff (host only). No EAS / no native install.
 *
 *   yarn recognition:model-bakeoff --gallery 800 --dataset core44
 *
 * Compares CLIP_VIT_B32 (baseline) vs MobileCLIP S0/S2 when loadable.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import * as esbuild from 'esbuild';

import { ENCODERS, loadEncoder } from './encoders.mjs';
import { buildGalleryIndex, loadGalleryIndex, searchGallery } from './gallery.mjs';
import { identityMatches, rankHasMatch, resolveExpected } from './scoring.mjs';
import { selectTrustedCorpus } from './trusted-corpus.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const opt = name => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const galleryArg = opt('gallery') || '800';
const gallery = galleryArg === 'full' ? 'full' : Number(galleryArg);
const dataset = opt('dataset') || 'core44';
const encodersArg = (opt('encoders') || 'CLIP_VIT_B32,MOBILECLIP_S0,MOBILECLIP_S2')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const now = () => performance.now();
const percentile = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

const bundleDir = await mkdtemp(join(tmpdir(), 'lugin-model-bakeoff-'));
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
    `,
    resolveDir: root,
    sourcefile: 'model-bakeoff-entry.ts',
  },
});
const scan = await import(`file://${bundle}`);

const corpus = selectTrustedCorpus(root, { dataset });
console.log(`\n=== model bakeoff ===`);
console.log(`dataset=${dataset} gallery=${galleryArg} queries=${corpus.length}`);
console.log(`encoders: ${encodersArg.join(', ')}`);

const table = [];

for (const encoderId of encodersArg) {
  const def = ENCODERS[encoderId];
  if (!def) {
    table.push({ encoderId, status: 'unknown_encoder' });
    continue;
  }
  console.log(`\n--- ${encoderId} ---`);
  let runtime;
  try {
    ({ runtime } = await loadEncoder(encoderId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  load failed: ${msg}`);
    table.push({
      encoderId,
      label: def.label,
      hfId: def.hfId,
      estimatedModelMb: def.estimatedModelMb,
      status: 'LOAD_FAILED',
      error: msg,
      mobileFeasibility:
        'Host load failed with current @xenova/transformers — likely needs @huggingface/transformers or native ORT. NO EAS started.',
    });
    continue;
  }

  let index = loadGalleryIndex(encoderId, gallery);
  if (!index || gallery !== 'full') {
    // Probe galleries must pin CORE_44 identities (rebuild if missing pins).
    const mustIncludeOracleIds = new Set();
    const mustIncludeNames = new Set();
    for (const item of corpus) {
      const exp = resolveExpected(root, item);
      if (exp.oracleId) mustIncludeOracleIds.add(exp.oracleId);
      if (exp.fold) mustIncludeNames.add(exp.fold);
    }
    const needsRebuild =
      !index ||
      ![...mustIncludeOracleIds].every(id => index.refs.some(r => r.oracleId === id));
    if (needsRebuild) {
      console.log(`  building/rebuilding gallery ${galleryArg} for ${encoderId} (CORE_44 pinned)…`);
      try {
        await buildGalleryIndex({
          encoderId,
          gallery,
          checkpointEvery: 100,
          mustIncludeOracleIds,
          mustIncludeNames,
          onProgress: ({ i, total }) => {
            if (i % 100 === 0) console.log(`    ${i}/${total}`);
          },
        });
        index = loadGalleryIndex(encoderId, gallery);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        table.push({
          encoderId,
          status: 'INDEX_BUILD_FAILED',
          error: msg,
          estimatedModelMb: def.estimatedModelMb,
        });
        continue;
      }
    }
  }

  const encodeMs = [];
  const searchMs = [];
  let top1 = 0;
  let top3 = 0;
  let top5 = 0;
  const n = corpus.length;

  for (const item of corpus) {
    const buf = await readFile(item.imagePath);
    const png = PNG.sync.read(buf);
    const card = {
      data: new Uint8ClampedArray(png.data),
      width: png.width,
      height: png.height,
    };
    const expected = resolveExpected(root, item);
    const art = scan.cropImage(card, scan.ARTWORK_REGION);
    const tmp = join(bundleDir, `${encoderId}-${item.id.replace(/[/:]/g, '_')}.png`);
    const out = new PNG({ width: art.width, height: art.height });
    out.data = Buffer.from(art.data);
    await writeFile(tmp, PNG.sync.write(out));

    const t0 = now();
    const emb = await runtime.embedPath(tmp);
    const eMs = now() - t0;
    encodeMs.push(eMs);
    const searched = searchGallery(index, emb, 10);
    searchMs.push(searched.searchMs);
    if (identityMatches(expected, searched.hits[0])) top1 += 1;
    if (rankHasMatch(expected, searched.hits, 3)) top3 += 1;
    if (rankHasMatch(expected, searched.hits, 5)) top5 += 1;
  }

  const float32Mb = (index.metadata.float32Bytes || index.count * index.dims * 4) / 1e6;
  const row = {
    encoderId,
    label: def.label,
    hfId: def.hfId,
    status: 'OK',
    quantization: 'onnx-int8 (quantized:true)',
    estimatedModelMb: def.estimatedModelMb,
    dims: index.dims,
    galleryArts: index.count,
    galleryOracles: index.metadata.oracleIdentities,
    indexFloat32Mb: Number(float32Mb.toFixed(2)),
    indexFloat16Mb: Number((float32Mb / 2).toFixed(2)),
    expectedApkDeltaMb: def.estimatedModelMb + float32Mb / 2,
    core44: {
      n,
      top1: top1 / n,
      top3: top3 / n,
      top5: top5 / n,
    },
    hostLatency: {
      medianEncodeMs: percentile(encodeMs, 50),
      p95EncodeMs: percentile(encodeMs, 95),
      medianSearchMs: percentile(searchMs, 50),
      p95SearchMs: percentile(searchMs, 95),
      note: 'Host CPU via transformers.js/ORT — not Android device latency',
    },
    mobileCandidate: def.mobileCandidate,
    runtimeOptions: def.mobileCandidate
      ? [
          {
            runtime: 'onnxruntime-react-native',
            easRequired: true,
            nativeDependency: 'onnxruntime-react-native (+ Expo config plugin)',
            notes: 'Most direct path for ONNX MobileCLIP/CLIP vision. DO NOT start EAS without approval.',
          },
          {
            runtime: 'custom Expo native module',
            easRequired: true,
            nativeDependency: 'platform ORT / CoreML / NNAPI wrapper',
            notes: 'Only if RN package insufficient for ABI/perf.',
          },
          {
            runtime: 'JS-only transformers.js',
            easRequired: false,
            nativeDependency: 'none',
            notes: 'Unlikely to hit 200–300ms continuous budget on-device for CLIP-class models.',
          },
        ]
      : [
          {
            runtime: 'research baseline only',
            easRequired: true,
            nativeDependency: 'onnxruntime-react-native',
            notes: `~${def.estimatedModelMb}MB quantized vision tower; justify only if quality gap is large.`,
          },
        ],
    continuousBudget:
      'Geometry ~8Hz; visual 2–4Hz while unresolved; pause after strong identity. Host encode medians below are a lower bound for phone cost.',
  };
  table.push(row);
  console.log(
    `  top1=${(100 * row.core44.top1).toFixed(0)}% top3=${(100 * row.core44.top3).toFixed(0)}%  encMed=${row.hostLatency.medianEncodeMs?.toFixed(0)}ms searchMed=${row.hostLatency.medianSearchMs?.toFixed(0)}ms`,
  );
}

const outDir = join(root, '.scan-fixtures/recognition-bakeoff');
mkdirSync(outDir, { recursive: true });
const report = {
  generated: new Date().toISOString(),
  phase: 'A.2-model-bakeoff',
  dataset,
  gallery: galleryArg,
  table,
  decisionNote:
    'Pick smaller model only if quality stays close to CLIP_VIT_B32. No EAS / no app integration in this phase.',
};
const path = join(outDir, `model-bakeoff-${dataset}-g${galleryArg}-${Date.now()}.json`);
writeFileSync(path, JSON.stringify(report, null, 2));
writeFileSync(join(outDir, 'model-bakeoff-latest.json'), JSON.stringify(report, null, 2));
console.log(`\nwrote ${path}`);
console.log('\nMODEL TABLE');
for (const r of table) {
  if (r.status !== 'OK') {
    console.log(`${r.encoderId}: ${r.status} — ${r.error?.slice?.(0, 120) || ''}`);
  } else {
    console.log(
      `${r.encoderId}: model~${r.estimatedModelMb}MB dim=${r.dims} top1=${(100 * r.core44.top1).toFixed(0)}% top3=${(100 * r.core44.top3).toFixed(0)}% encMed=${r.hostLatency.medianEncodeMs?.toFixed(0)}ms idxF32=${r.indexFloat32Mb}MB`,
    );
  }
}

await rm(bundleDir, { force: true, recursive: true });
