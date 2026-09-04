// Card-detection benchmark (synthetic vs real-camera, reported separately).
//
//   yarn scan:detect-eval
//   yarn scan:detect-eval --real
//   yarn scan:detect-eval --synthetic
//
// Synthetic: Scryfall fixtures under .scan-fixtures/ (ids in scripts/fixtures).
// Real: gitignored .scan-real/ frames + corner annotations — see
// scripts/fixtures/REAL-DETECTION.md.
//
// Native Kotlin parity (shared-js metrics + RGBA export for DetectCard):
//   yarn scan:detect-native-parity

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as esbuild from 'esbuild';
import { PNG } from 'pngjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(root, '.scan-fixtures');
const REAL = join(root, '.scan-real');
const MANIFEST = join(root, 'scripts/fixtures/cards.json');
const AGENT = 'Lugin/1.0 (+https://github.com/Tsuina311/Lugin)';

const flag = name => process.argv.includes(`--${name}`);
const wantSynthetic = flag('synthetic') || (!flag('real') && !flag('synthetic'));
const wantReal = flag('real') || (!flag('real') && !flag('synthetic'));

const bundleDir = await mkdtemp(join(tmpdir(), 'lugin-detect-'));
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
      export * from '${join(root, 'src/lib/scan/detectCard.ts')}';
      export * from '${join(root, 'src/lib/scan/prepareCard.ts')}';
      export * from '${join(root, 'src/lib/scan/videoMap.ts')}';
    `,
    resolveDir: root,
    sourcefile: 'entry.ts',
  },
});
const scan = await import(pathToFileURL(bundle).href);

const pct = x => `${(100 * x).toFixed(1)}%`;
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const decodePng = buf => {
  const png = PNG.sync.read(buf);
  return {
    data: new Uint8ClampedArray(png.data),
    height: png.height,
    width: png.width,
  };
};

const placeCard = card => {
  const frameW = Math.round(card.width * 1.35);
  const frameH = Math.round(card.height * 1.35);
  const frame = scan.blankImage(frameW, frameH);
  for (let i = 0; i < frame.data.length; i += 4) {
    frame.data[i] = 220;
    frame.data[i + 1] = 218;
    frame.data[i + 2] = 210;
    frame.data[i + 3] = 255;
  }
  const ox = Math.floor((frameW - card.width) / 2);
  const oy = Math.floor((frameH - card.height) / 2);
  for (let y = 0; y < card.height; y++) {
    for (let x = 0; x < card.width; x++) {
      const si = (y * card.width + x) * 4;
      const di = ((oy + y) * frameW + (ox + x)) * 4;
      frame.data[di] = card.data[si];
      frame.data[di + 1] = card.data[si + 1];
      frame.data[di + 2] = card.data[si + 2];
      frame.data[di + 3] = 255;
    }
  }
  const gt = {
    topLeft: { x: ox, y: oy },
    topRight: { x: ox + card.width - 1, y: oy },
    bottomRight: { x: ox + card.width - 1, y: oy + card.height - 1 },
    bottomLeft: { x: ox, y: oy + card.height - 1 },
  };
  return { frame, gt };
};

const fixtureImage = async fixture => {
  const dest = join(CACHE, `${fixture.id}.png`);
  if (!existsSync(dest)) {
    const res = await fetch(fixture.image, { headers: { 'User-Agent': AGENT } });
    if (!res.ok) throw new Error(`download ${fixture.id}: ${res.status}`);
    await mkdir(CACHE, { recursive: true });
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  }
  return decodePng(await readFile(dest));
};

const cornerError = (a, b, diag) => {
  const keys = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];
  let sum = 0;
  for (const k of keys) {
    sum += Math.hypot(a[k].x - b[k].x, a[k].y - b[k].y);
  }
  return sum / 4 / Math.max(diag, 1);
};

const evalCase = (frame, gt, tag) => {
  const t0 = performance.now();
  const det = scan.detectCardQuad(frame);
  const ms = performance.now() - t0;
  const detected = Boolean(det.corners && det.score >= 0.28);
  let iou = 0;
  let err = 1;
  if (detected && gt) {
    iou = scan.polygonIoU(det.corners, gt);
    const diag = Math.hypot(frame.width, frame.height);
    err = cornerError(det.corners, gt, diag);
  }
  return {
    detected,
    err,
    falsePositive: detected && gt && iou < 0.35,
    iou,
    method: det.debug.candidates[det.debug.selectedIndex]?.method ?? null,
    ms,
    score: det.score,
    tag,
  };
};

const summarize = (label, rows) => {
  const n = rows.length || 1;
  const detected = rows.filter(r => r.detected).length / n;
  const fp = rows.filter(r => r.falsePositive).length / n;
  const withGt = rows.filter(r => r.iou > 0 || r.detected);
  const meanIoU = mean(rows.filter(r => r.detected).map(r => r.iou));
  const meanErr = mean(rows.filter(r => r.detected).map(r => r.err));
  const times = rows.map(r => r.ms);
  console.log(`\n=== ${label} (${rows.length} frames) ===`);
  console.log(`  detection rate     ${pct(detected)}`);
  console.log(`  false positive     ${pct(fp)}  (detected but IoU < 0.35)`);
  console.log(`  mean IoU (hits)    ${pct(meanIoU)}`);
  console.log(`  mean corner err    ${(meanErr * 100).toFixed(2)}% of frame diagonal`);
  console.log(
    `  detect ms          mean ${mean(times).toFixed(1)} · p50 ${[...times].sort((a, b) => a - b)[Math.floor(times.length * 0.5)]?.toFixed(1) ?? 0} · p95 ${[...times].sort((a, b) => a - b)[Math.floor(times.length * 0.95)]?.toFixed(1) ?? 0}`,
  );

  const byTag = new Map();
  for (const r of rows) {
    const list = byTag.get(r.tag) ?? [];
    list.push(r);
    byTag.set(r.tag, list);
  }
  if (byTag.size > 1) {
    console.log('  by category');
    for (const [tag, list] of [...byTag].sort((a, b) => a[0].localeCompare(b[0]))) {
      const rate = list.filter(r => r.detected).length / list.length;
      const iou = mean(list.filter(r => r.detected).map(r => r.iou));
      console.log(`    ${tag.padEnd(22)} det ${pct(rate).padStart(6)}  IoU ${pct(iou).padStart(6)}`);
    }
  }
  return { detected, falsePositive: fp, meanErr, meanIoU, n: rows.length };
};

const report = { generated: new Date().toISOString(), real: null, synthetic: null };

if (wantSynthetic) {
  if (!existsSync(MANIFEST)) {
    console.error('No fixture manifest. Run yarn scan:fixtures first.');
  } else {
    const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
    const rows = [];
    for (const card of manifest.cards) {
      const img = await fixtureImage(card);
      const { frame, gt } = placeCard(img);
      rows.push(evalCase(frame, gt, card.tag ?? 'synthetic'));
    }
    report.synthetic = { summary: summarize('SYNTHETIC', rows), cases: rows };
  }
}

if (wantReal) {
  if (!existsSync(REAL)) {
    console.log(`\n=== REAL CAMERA ===`);
    console.log(`  skipped — no corpus at ${REAL}`);
    console.log(`  See scripts/fixtures/REAL-DETECTION.md`);
  } else {
    const files = (await readdir(REAL)).filter(f => f.endsWith('.json'));
    const rows = [];
    for (const f of files) {
      const meta = JSON.parse(await readFile(join(REAL, f), 'utf8'));
      if (meta.negative) {
        const png = meta.imageFile ?? f.replace(/\.json$/, '.png');
        const path = join(REAL, png);
        if (!existsSync(path)) continue;
        const frame = decodePng(await readFile(path));
        const r = evalCase(frame, null, meta.tag ?? 'negative');
        r.falsePositive = r.detected;
        r.detected = false; // negatives should not detect
        // Reinterpret: success = not detecting
        rows.push({
          ...r,
          detected: !r.falsePositive,
          tag: meta.tag ?? 'negative',
        });
        continue;
      }
      if (!meta.corners) continue;
      const png = meta.imageFile ?? f.replace(/\.json$/, '.png');
      const path = join(REAL, png);
      if (!existsSync(path)) continue;
      const frame = decodePng(await readFile(path));
      rows.push(evalCase(frame, meta.corners, meta.tag ?? 'real'));
    }
    if (!rows.length) {
      console.log(`\n=== REAL CAMERA ===`);
      console.log(`  skipped — ${REAL} has no annotated frames yet`);
    } else {
      report.real = { summary: summarize('REAL CAMERA', rows), cases: rows };
    }
  }
}

await mkdir(CACHE, { recursive: true });
const out = join(CACHE, 'detect-report.json');
await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nreport: ${out}`);
await rm(bundleDir, { force: true, recursive: true });
