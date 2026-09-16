#!/usr/bin/env node
/**
 * yarn geometry:physical-refine-report [--id=…] [--items=1,3,4,9,10,2,6,7,8]
 *
 * Host forensics for physical-refine V2 (global nested consensus) +
 * source-space anti-clip counterfactual.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { PNG } from 'pngjs';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);

const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(`--${name}=`.length);

const loadTs = async () => {
  const esbuild = await import('esbuild');
  const entry = `
    export { detectCardQuad } from '${join(rootDir, 'src/lib/scan/detectCard.ts')}';
    export {
      refinePhysicalCardBoundary,
      quadOccupancy,
      BAD_SEED_OCCUPANCY,
      MAX_PLAUSIBLE_SIDE_INSET,
      PHYSICAL_OUTWARD_PAD,
      MIN_GLOBAL_CONSENSUS,
    } from '${join(rootDir, 'src/lib/scan/geometryTest/physicalRefine.ts')}';
    export { evaluateCaptureSafe } from '${join(rootDir, 'src/lib/scan/geometryTest/captureSafe.ts')}';
    export {
      evaluateSourceCaptureSafe,
      MIN_SOURCE_MARGIN_PX,
      mapCornersToPredictedSource,
      predictedSourceSizeFromDetector,
      sourceCornerMargins,
    } from '${join(rootDir, 'src/lib/scan/geometryTest/sourceSafety.ts')}';
    export { warpQuadToCard, cornersToQuad } from '${join(rootDir, 'src/lib/scan/geometry.ts')}';
  `;
  const built = await esbuild.build({
    stdin: { contents: entry, resolveDir: rootDir, sourcefile: 'phys-refine-entry.ts', loader: 'ts' },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
  });
  const code = built.outputFiles[0].text;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
  return mod.exports;
};

const decodePng = path => {
  const png = PNG.sync.read(readFileSync(path));
  return { data: png.data, width: png.width, height: png.height };
};

const writePng = (path, img) => {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, PNG.sync.write(png));
};

const findSource = (sessionDir, idx) => {
  const stem = `geom-${String(idx).padStart(3, '0')}-source`;
  const nested = join(sessionDir, stem, `${stem}.png`);
  if (existsSync(nested)) return nested;
  const direct = join(sessionDir, `${stem}.png`);
  return existsSync(direct) ? direct : null;
};

const loadMeta = (sessionDir, idx) => {
  const stem = `geom-${String(idx).padStart(3, '0')}-metadata`;
  const p = join(sessionDir, stem, `${stem}.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
};

/** Map analysis-space locked quad → source (same-FOV 256×480 → source). */
const mapLockedToSource = (locked, img) => {
  const aw = 256;
  const ah = 480;
  const map = c => ({ x: (c.x / aw) * img.width, y: (c.y / ah) * img.height });
  return {
    topLeft: map(locked.topLeft),
    topRight: map(locked.topRight),
    bottomRight: map(locked.bottomRight),
    bottomLeft: map(locked.bottomLeft),
  };
};

const drawPoly = (img, corners, rgb) => {
  const pts = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
  const set = (x, y) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= img.width || yi >= img.height) return;
    const o = (yi * img.width + xi) * 4;
    img.data[o] = rgb[0];
    img.data[o + 1] = rgb[1];
    img.data[o + 2] = rgb[2];
  };
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    const n = Math.max(2, Math.hypot(b.x - a.x, b.y - a.y) | 0);
    for (let t = 0; t <= n; t++) {
      const u = t / n;
      set(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u);
    }
  }
};

const main = async () => {
  const id = arg('id') || 'geometry-test-20260910-165339';
  const sessionDir = join(rootDir, '.scan-inbox/sessions', id);
  if (!existsSync(sessionDir)) {
    console.error('Missing session', sessionDir);
    process.exit(1);
  }
  const itemsArg = arg('items') || '1,2,3,4,6,7,8,9,10';
  const items = itemsArg.split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n));
  const outDir = join(rootDir, '.scan-inbox/deck-reports', `${id}-physical-refine-v2`);
  mkdirSync(outDir, { recursive: true });

  const {
    refinePhysicalCardBoundary,
    evaluateCaptureSafe,
    evaluateSourceCaptureSafe,
    warpQuadToCard,
    cornersToQuad,
    BAD_SEED_OCCUPANCY,
    MAX_PLAUSIBLE_SIDE_INSET,
    MIN_SOURCE_MARGIN_PX,
    PHYSICAL_OUTWARD_PAD,
    MIN_GLOBAL_CONSENSUS,
  } = await loadTs();

  console.log(`PHYSICAL CARD REFINE V2 + SOURCE ANTI-CLIP — ${id}`);
  console.log(`items ${items.join(', ')}`);
  console.log(
    `BAD_SEED=${BAD_SEED_OCCUPANCY} MAX_SIDE=${MAX_PLAUSIBLE_SIDE_INSET} PAD=${PHYSICAL_OUTWARD_PAD} CONSENSUS=${MIN_GLOBAL_CONSENSUS} SRC_THR=${MIN_SOURCE_MARGIN_PX}`,
  );
  console.log('');

  const timings = [];
  let selectPhysical = 0;
  let selectOriginal = 0;
  let badSeed = 0;
  let sourceReject = 0;
  let sourceKeep = 0;

  for (const idx of items) {
    const srcPath = findSource(sessionDir, idx);
    const meta = loadMeta(sessionDir, idx);
    if (!srcPath || !meta?.lockedQuad) {
      console.log(`#${idx} MISSING source/locked`);
      continue;
    }
    const img = decodePng(srcPath);
    const aw = 256;
    const ah = 480;
    // Downsample source → analysis-sized buffer for refine (same FOV).
    const analysis = {
      width: aw,
      height: ah,
      data: new Uint8ClampedArray(aw * ah * 4),
    };
    for (let y = 0; y < ah; y++) {
      for (let x = 0; x < aw; x++) {
        const sx = Math.min(img.width - 1, Math.round((x / aw) * img.width));
        const sy = Math.min(img.height - 1, Math.round((y / ah) * img.height));
        const si = (sy * img.width + sx) * 4;
        const di = (y * aw + x) * 4;
        analysis.data[di] = img.data[si];
        analysis.data[di + 1] = img.data[si + 1];
        analysis.data[di + 2] = img.data[si + 2];
        analysis.data[di + 3] = 255;
      }
    }

    const locked = meta.lockedQuad;
    const livePr = meta.physicalRefine;
    // Prefer original/outer seed for re-refine; locked may already be physical.
    const seed =
      livePr?.outerCandidateQuad ??
      livePr?.originalQuad ??
      locked;
    const t0 = performance.now();
    const refine = refinePhysicalCardBoundary({
      image: analysis,
      corners: seed,
      frame: { width: aw, height: ah },
      candidateRole: livePr?.candidateRoleBefore ?? null,
    });
    const dt = performance.now() - t0;
    timings.push(dt);

    if (refine.status === 'BAD_SEED') badSeed += 1;
    if (refine.selectedForCapture === 'PHYSICAL_CARD') selectPhysical += 1;
    else selectOriginal += 1;

    const selected = refine.selectedQuad;
    const analysisSafe = evaluateCaptureSafe({
      corners: selected,
      frame: { width: aw, height: ah },
    });
    const sourceGate = evaluateSourceCaptureSafe({
      corners: selected,
      detector: { width: aw, height: ah },
      expectedSource: { width: img.width, height: img.height },
    });
    if (sourceGate.sourceSafe) sourceKeep += 1;
    else sourceReject += 1;

    const liveSrcMargin = meta.minCornerMarginPixelsSource;
    const mappedSelected = mapLockedToSource(selected, img);
    const mappedOuter = mapLockedToSource(refine.sleeveQuad ?? locked, img);
    const mappedPhys = refine.physicalCardQuad
      ? mapLockedToSource(refine.physicalCardQuad, img)
      : null;

    const overlay = {
      width: img.width,
      height: img.height,
      data: Uint8ClampedArray.from(img.data),
    };
    drawPoly(overlay, mappedOuter, [255, 159, 67]); // orange sleeve
    if (mappedPhys) drawPoly(overlay, mappedPhys, [124, 255, 178]); // green physical
    else drawPoly(overlay, mappedSelected, [124, 255, 178]);

    const warpCorners = mappedPhys ?? mappedSelected;
    const card = warpQuadToCard(img, cornersToQuad(warpCorners));

    writePng(join(outDir, `item-${String(idx).padStart(2, '0')}-overlay.png`), overlay);
    writePng(join(outDir, `item-${String(idx).padStart(2, '0')}-warp.png`), card);

    console.log(
      `#${idx} live=${livePr?.selectedForCapture ?? '?'}→host=${refine.selectedForCapture}` +
        ` model=${refine.classification} cons=${refine.globalConsensusScore.toFixed(2)}` +
        ` meanInset=${refine.meanInset.toFixed(3)} pad=${refine.outwardPaddingApplied.toFixed(3)}` +
        ` ms=${dt.toFixed(1)}` +
        ` liveSrc=${liveSrcMargin != null ? Math.round(liveSrcMargin) : '?'}px` +
        ` predSrc=${sourceGate.minSourceMarginPx != null ? Math.round(sourceGate.minSourceMarginPx) : '?'}px` +
        ` srcGate=${sourceGate.sourceSafe ? 'OK' : 'REJECT'}` +
        ` analysisSafe=${analysisSafe.captureSafe}` +
        ` corners=${JSON.stringify(refine.cornerEvidence)}`,
    );
  }

  timings.sort((a, b) => a - b);
  const p50 = timings[Math.floor(timings.length * 0.5)] ?? 0;
  const p95 = timings[Math.floor(timings.length * 0.95)] ?? 0;
  console.log('');
  console.log(
    `select PHYSICAL=${selectPhysical} ORIGINAL=${selectOriginal} BAD_SEED=${badSeed}`,
  );
  console.log(`source gate KEEP=${sourceKeep} REJECT=${sourceReject} thr=${MIN_SOURCE_MARGIN_PX}`);
  console.log(`refine timing p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms n=${timings.length}`);
  console.log(`wrote ${outDir}`);
};

main().catch(e => {
  console.error(e);
  process.exit(1);
});
