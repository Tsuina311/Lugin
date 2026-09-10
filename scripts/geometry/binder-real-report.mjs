#!/usr/bin/env node
/**
 * yarn geometry:binder-real-report
 *
 * Replay latest Binder Benchmark capture through host Kotlin detector
 * with Binder research policy (topComponents=7, dedupe=12) + multi-return
 * + temporal + grid + targeted recovery.
 *
 * SYNTHETIC pipeline code reused; imagery is REAL camera JPEGs.
 * Host Y-from-RGBA ≠ live phone Y plane.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

import { inferBinderGrid } from './geometry/lib/binder-mode/grid.mjs';
import { recoverMissingSlot } from './geometry/lib/binder-mode/local-recovery.mjs';
import { multiReturnNms } from './geometry/lib/binder-mode/multi-return.mjs';
import { BINDER_MODE_V0_POLICY } from './geometry/lib/binder-mode/policy.mjs';
import { loadDetectScan } from './geometry/lib/detect-host.mjs';
import { runNativeDetectorBatch } from './geometry/lib/detect-native.mjs';
import { matchQuadsByIoU } from './geometry/lib/metrics.mjs';
import { CORPUS_ROOT, rootDir } from './geometry/lib/paths.mjs';
import { createMultiCardTracker } from './geometry/lib/temporal/tracker.mjs';

const inboxRoot = join(rootDir, '.scan-inbox/sessions');
const outRoot = join(CORPUS_ROOT, 'synthetic/binder-real');
const policy = BINDER_MODE_V0_POLICY;

const findBundles = () => {
  if (!existsSync(inboxRoot)) return [];
  const out = [];
  for (const session of readdirSync(inboxRoot, { withFileTypes: true })) {
    if (!session.isDirectory()) continue;
    const sessionDir = join(inboxRoot, session.name);
    for (const trace of readdirSync(sessionDir, { withFileTypes: true })) {
      if (!trace.isDirectory()) continue;
      const summaryPath = join(sessionDir, trace.name, 'summary.json');
      if (!existsSync(summaryPath)) continue;
      try {
        const bundle = JSON.parse(readFileSync(summaryPath, 'utf8'));
        if (bundle?.kind !== 'binder-benchmark') continue;
        out.push({ bundle, dir: join(sessionDir, trace.name) });
      } catch {
        /* skip */
      }
    }
  }
  return out.sort((a, b) => b.bundle.fixtureId.localeCompare(a.bundle.fixtureId));
};

const frameToPngFixture = (absFrame, outPng, id) => {
  const buf = readFileSync(absFrame);
  let width;
  let height;
  let data;
  if (/\.png$/i.test(absFrame)) {
    const decoded = PNG.sync.read(buf);
    width = decoded.width;
    height = decoded.height;
    data = Buffer.from(decoded.data);
    if (absFrame !== outPng) writeFileSync(outPng, buf);
  } else {
    const decoded = jpeg.decode(buf, { useTArray: true });
    width = decoded.width;
    height = decoded.height;
    data = Buffer.from(decoded.data);
    const png = new PNG({ width, height });
    png.data = data;
    writeFileSync(outPng, PNG.sync.write(png));
  }
  return {
    id,
    image: outPng.replace(rootDir + '/', '').replace(/^\//, ''),
    imageWidth: width,
    imageHeight: height,
    cards: [],
    synthetic: false,
    source: 'phone-binder-benchmark',
  };
};

const main = async () => {
  console.log('BINDER REAL REPORT (host replay)');
  console.log('─'.repeat(56));
  console.log('Policy: topComponents=7 dedupe=12 (diag only). Production unchanged.');
  console.log('Input: real camera PNG/JPEG → host Y-from-RGBA (not byte-identical to live Y).');
  console.log('');

  const entries = findBundles();
  if (!entries.length) {
    console.log('No binder-benchmark bundles found. Capture on phone → yarn scan:inbox.');
    process.exit(1);
  }
  const { bundle, dir } = entries[0];
  console.log(`Bundle ${bundle.fixtureId} · ${bundle.pages?.length ?? 0} pages`);

  const { scan } = await loadDetectScan();
  const polygonIoU = scan.polygonIoU;
  mkdirSync(outRoot, { recursive: true });
  const work = join(outRoot, bundle.fixtureId);
  mkdirSync(work, { recursive: true });

  const pageReports = [];
  for (const page of bundle.pages || []) {
    const fixtures = [];
    for (const fr of page.frames || []) {
      const abs = join(dir, fr.file);
      if (!existsSync(abs)) continue;
      const pngName = fr.file.replace(/\.(jpg|jpeg)$/i, '.png');
      const outPng = join(work, `p${page.pageIndex}-${pngName}`);
      const fix = frameToPngFixture(abs, outPng, `${bundle.fixtureId}-p${page.pageIndex}-f${fr.frameIndex}`);
      // relative path from repo root
      fix.image = outPng.replace(rootDir + '/', '');
      if (fix.image.startsWith('/')) fix.image = outPng.slice(rootDir.length + 1);
      fixtures.push(fix);
    }
    if (!fixtures.length) {
      pageReports.push({ pageIndex: page.pageIndex, error: 'no-frames' });
      continue;
    }

    const dets = await runNativeDetectorBatch(fixtures, {
      inputMode: 'y-from-rgba',
      batchDir: join(CORPUS_ROOT, `native-batch-binder-real-p${page.pageIndex}`),
      exportPipeline: true,
      diagnosticTopComponents: policy.diagnosticTopComponents,
      diagnosticDedupeCap: policy.diagnosticDedupeCap,
    });

    const tracker = createMultiCardTracker({ polygonIoU });
    const timeline = [];
    let lastGrid = null;
    const recoveries = [];

    for (let i = 0; i < fixtures.length; i++) {
      const f = fixtures[i];
      const det = dets.get(f.id);
      const raw = det?.pipeline?.rawAfterQuad || [];
      const kept = multiReturnNms(raw, polygonIoU, {
        maxCards: policy.maxCards,
        nmsIou: policy.nmsIou,
        minScore: policy.minScore,
      });
      tracker.step(i, kept);
      const tracks = tracker.getTracks().filter(t => t.best?.corners);
      const grid = inferBinderGrid(
        tracks.map(t => t.best.corners),
        { rows: bundle.layout?.rows ?? 3, cols: bundle.layout?.cols ?? 3 },
      );
      lastGrid = grid;
      timeline.push({
        frameIndex: i + 1,
        rawCandidates: raw.length,
        multiReturn: kept.length,
        tracks: tracks.length,
        gridConfidence: grid.confidence,
        missing: grid.missing?.length ?? 0,
      });
    }

    // Targeted recovery on final grid missing cells using last frame image
    const lastFix = fixtures[fixtures.length - 1];
    const lastAbs = join(rootDir, lastFix.image);
    let image = null;
    if (existsSync(lastAbs)) {
      const { decodeImageFile } = await import('./geometry/lib/detect-host.mjs');
      image = await decodeImageFile(lastAbs);
    }
    if (image && lastGrid?.missing?.length) {
      const occupied = (lastGrid.assignments || []).map(a => a.corners);
      for (const miss of lastGrid.missing) {
        const rec = recoverMissingSlot(image, miss.corners, {
          ...policy,
          occupiedCorners: occupied,
          polygonIoU,
        });
        recoveries.push({
          row: miss.row,
          col: miss.col,
          accepted: rec.accepted,
          reason: rec.reason,
          evidenceMean: rec.evidence?.mean ?? null,
        });
      }
    }

    const tracks = tracker.getTracks();
    pageReports.push({
      pageIndex: page.pageIndex,
      frames: fixtures.length,
      timeline,
      eventualTracks: tracks.filter(t => t.best).length,
      gridConfidence: lastGrid?.confidence ?? null,
      missingCells: lastGrid?.missing?.length ?? null,
      recoveries,
      acceptedRecoveries: recoveries.filter(r => r.accepted).length,
      rejectedRecoveries: recoveries.filter(r => !r.accepted).length,
      note: 'No GT yet — run binder GT review HTML to score IoU.',
    });
    console.log(
      `  page ${page.pageIndex}: frames=${fixtures.length} eventualTracks=${pageReports.at(-1).eventualTracks} gridConf=${(lastGrid?.confidence ?? 0).toFixed(2)} recoveries=${recoveries.filter(r => r.accepted).length}/${recoveries.length}`,
    );
  }

  const report = {
    kind: 'binder-real-report',
    fixtureId: bundle.fixtureId,
    generatedAt: new Date().toISOString(),
    policy: {
      topComponents: policy.diagnosticTopComponents,
      dedupeCap: policy.diagnosticDedupeCap,
    },
    captureNote: bundle.captureNote,
    hostNote: 'REAL imagery; host Y-from-RGBA ≠ live phone Y plane. Production unchanged.',
    pages: pageReports,
  };
  const outPath = join(outRoot, `${bundle.fixtureId}-report.json`);
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

  // Minimal GT review stub HTML per page (occupied/empty clicks later)
  for (const page of bundle.pages || []) {
    const first = page.frames?.[0];
    if (!first) continue;
    const html = `<!doctype html><html><body style="font-family:system-ui;background:#111;color:#eee">
<h1>Binder GT review · page ${page.pageIndex}</h1>
<p>Mark occupied/empty for ${bundle.layout?.rows ?? 3}×${bundle.layout?.cols ?? 3}. Save+Next — geometry IoU after annotation.</p>
<p>Representative frame: ${first.file}</p>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-width:480px">
${[0, 1, 2, 3, 4, 5, 6, 7, 8]
  .map(
    i =>
      `<button data-slot="${i}" style="padding:24px">slot ${i}<br/><span>occupied</span></button>`,
  )
  .join('')}
</div>
<script>
document.querySelectorAll('button').forEach(b=>b.onclick=()=>{
  const s=b.querySelector('span');
  s.textContent=s.textContent==='occupied'?'empty':'occupied';
});
</script>
</body></html>`;
    writeFileSync(join(outRoot, `${bundle.fixtureId}-p${page.pageIndex}-review.html`), html);
  }

  console.log(`\nWrote ${outPath}`);
  console.log('GT review HTML stubs written beside report (annotate occupied/empty).');
};

main().catch(err => {
  console.error(err);
  process.exit(1);
});
