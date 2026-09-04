// Shared-JS ↔ native detector parity harness.
//
//   yarn scan:detect-native-parity
//   yarn scan:detect-native-parity --synthetic
//   yarn scan:detect-native-parity --real
//   yarn scan:detect-native-parity --no-export   # metrics only (no RGBA dump)
//
// Native Kotlin (`DetectCard.detectFromRgba`) cannot run inside Node. This script:
//   1. Runs shared `detectCardQuad` on the same fixtures as `scan:detect-eval`
//   2. Writes IoU / detection-rate metrics for the shared-js engine
//   3. Optionally encodes each frame as packed RGBA + JSON sidecar for later
//      native calls (gradle unit test or on-device `detectFromRgba`)
//
// Compare native after exporting:
//   DETECT_PARITY_DIR=.scan-fixtures/detect-parity \
//     ./gradlew :lugin-card-detector:testDebugUnitTest \
//     -p mobile/android
//   (requires `yarn mobile:prebuild` so mobile/android exists)
//
// See scripts/fixtures/REAL-DETECTION.md § Native parity.

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
const PARITY_DIR = join(CACHE, 'detect-parity');
const AGENT = 'Lugin/1.0 (+https://github.com/Tsuina311/Lugin)';

const flag = name => process.argv.includes(`--${name}`);
const wantSynthetic = flag('synthetic') || (!flag('real') && !flag('synthetic'));
const wantReal = flag('real') || (!flag('real') && !flag('synthetic'));
const exportRgba = !flag('no-export');

const bundleDir = await mkdtemp(join(tmpdir(), 'lugin-detect-parity-'));
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

const cornersNamed = corners => {
  if (!corners) return null;
  return {
    topLeft: { x: corners.topLeft.x, y: corners.topLeft.y },
    topRight: { x: corners.topRight.x, y: corners.topRight.y },
    bottomRight: { x: corners.bottomRight.x, y: corners.bottomRight.y },
    bottomLeft: { x: corners.bottomLeft.x, y: corners.bottomLeft.y },
  };
};

const evalCase = (frame, gt, tag, id) => {
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
    id,
    iou,
    method: det.debug.candidates[det.debug.selectedIndex]?.method ?? null,
    ms,
    score: det.score,
    tag,
    corners: cornersNamed(det.corners),
  };
};

const summarize = (label, rows) => {
  const n = rows.length || 1;
  const detected = rows.filter(r => r.detected).length / n;
  const fp = rows.filter(r => r.falsePositive).length / n;
  const meanIoU = mean(rows.filter(r => r.detected).map(r => r.iou));
  const meanErr = mean(rows.filter(r => r.detected).map(r => r.err));
  const times = rows.map(r => r.ms);
  const sorted = [...times].sort((a, b) => a - b);
  console.log(`\n=== ${label} · shared-js (${rows.length} frames) ===`);
  console.log(`  detection rate     ${pct(detected)}`);
  console.log(`  false positive     ${pct(fp)}  (detected but IoU < 0.35)`);
  console.log(`  mean IoU (hits)    ${pct(meanIoU)}`);
  console.log(`  mean corner err    ${(meanErr * 100).toFixed(2)}% of frame diagonal`);
  console.log(
    `  detect ms          mean ${mean(times).toFixed(1)} · p50 ${sorted[Math.floor(times.length * 0.5)]?.toFixed(1) ?? 0} · p95 ${sorted[Math.floor(times.length * 0.95)]?.toFixed(1) ?? 0}`,
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
  return {
    detectionRate: detected,
    falsePositive: fp,
    meanCornerErr: meanErr,
    meanIoU,
    n: rows.length,
  };
};

const exportCase = async (caseId, frame, gt, row) => {
  if (!exportRgba) return null;
  const rgbaName = `${caseId}.rgba`;
  const metaName = `${caseId}.json`;
  await writeFile(join(PARITY_DIR, rgbaName), Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength));
  const meta = {
    caseId,
    engineExpected: 'shared-js',
    falsePositive: row.falsePositive,
    groundTruth: gt,
    height: frame.height,
    negative: gt == null && row.tag?.includes('negative'),
    rgbaFile: rgbaName,
    sharedJs: {
      corners: row.corners,
      detected: row.detected,
      err: row.err,
      iou: row.iou,
      method: row.method,
      ms: row.ms,
      score: row.score,
    },
    tag: row.tag,
    width: frame.width,
  };
  await writeFile(join(PARITY_DIR, metaName), `${JSON.stringify(meta, null, 2)}\n`);
  return { metaName, rgbaName };
};

console.log('Native Kotlin cannot run in Node — shared-js metrics + RGBA export for DetectCard.detectFromRgba.');
if (exportRgba) {
  await mkdir(PARITY_DIR, { recursive: true });
  console.log(`RGBA export dir: ${PARITY_DIR}`);
}

const report = {
  engine: 'shared-js',
  generated: new Date().toISOString(),
  note:
    'Native parity: feed each *.rgba + width/height into DetectCard.detectFromRgba (gradle DetectCardParityTest or on-device). Compare detection rate / IoU / corner err to sharedJs in each sidecar and to summary below.',
  real: null,
  synthetic: null,
};

const casesIndex = [];

if (wantSynthetic) {
  if (!existsSync(MANIFEST)) {
    console.error('No fixture manifest. Run yarn scan:fixtures first.');
  } else {
    const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
    const rows = [];
    for (const card of manifest.cards) {
      const img = await fixtureImage(card);
      const { frame, gt } = placeCard(img);
      const caseId = `synthetic-${card.id}`;
      const row = evalCase(frame, gt, card.tag ?? 'synthetic', caseId);
      rows.push(row);
      const exported = await exportCase(caseId, frame, gt, row);
      casesIndex.push({ caseId, corpus: 'synthetic', ...exported, tag: row.tag });
    }
    report.synthetic = { summary: summarize('SYNTHETIC', rows), cases: rows.map(({ corners: _c, ...rest }) => rest) };
  }
}

if (wantReal) {
  if (!existsSync(REAL)) {
    console.log(`\n=== REAL CAMERA · shared-js ===`);
    console.log(`  skipped — no corpus at ${REAL}`);
    console.log(`  See scripts/fixtures/REAL-DETECTION.md`);
  } else {
    const files = (await readdir(REAL)).filter(f => f.endsWith('.json'));
    const rows = [];
    for (const f of files) {
      const meta = JSON.parse(await readFile(join(REAL, f), 'utf8'));
      const stem = f.replace(/\.json$/, '');
      if (meta.negative) {
        const png = meta.imageFile ?? `${stem}.png`;
        const path = join(REAL, png);
        if (!existsSync(path)) continue;
        const frame = decodePng(await readFile(path));
        const caseId = `real-${stem}`;
        const r = evalCase(frame, null, meta.tag ?? 'negative', caseId);
        r.falsePositive = r.detected;
        const row = {
          ...r,
          detected: !r.falsePositive,
          tag: meta.tag ?? 'negative',
        };
        rows.push(row);
        const exported = await exportCase(caseId, frame, null, { ...row, detected: r.detected });
        casesIndex.push({ caseId, corpus: 'real-negative', ...exported, tag: row.tag });
        continue;
      }
      if (!meta.corners) continue;
      const png = meta.imageFile ?? `${stem}.png`;
      const path = join(REAL, png);
      if (!existsSync(path)) continue;
      const frame = decodePng(await readFile(path));
      const caseId = `real-${stem}`;
      const row = evalCase(frame, meta.corners, meta.tag ?? 'real', caseId);
      rows.push(row);
      const exported = await exportCase(caseId, frame, meta.corners, row);
      casesIndex.push({ caseId, corpus: 'real', ...exported, tag: row.tag });
    }
    if (!rows.length) {
      console.log(`\n=== REAL CAMERA · shared-js ===`);
      console.log(`  skipped — ${REAL} has no annotated frames yet`);
    } else {
      report.real = { summary: summarize('REAL CAMERA', rows), cases: rows.map(({ corners: _c, ...rest }) => rest) };
    }
  }
}

await mkdir(CACHE, { recursive: true });
if (exportRgba) {
  await writeFile(join(PARITY_DIR, 'index.json'), `${JSON.stringify({ cases: casesIndex, generated: report.generated }, null, 2)}\n`);
  await writeFile(
    join(PARITY_DIR, 'NATIVE.md'),
    `# Native comparison (after shared-js export)

RGBA sidecars in this directory are packed \`R,G,B,A\` bytes
(\`length == width * height * 4\`), same layout as JS \`ScanImage\`.

## Gradle unit test (preferred)

Requires local prebuild (\`yarn mobile:prebuild\`) so \`mobile/android\` exists:

\`\`\`bash
yarn scan:detect-native-parity          # refresh this folder
export JAVA_HOME="\$(/usr/libexec/java_home 2>/dev/null || echo /opt/homebrew/opt/openjdk@21)"
DETECT_PARITY_DIR="\$(pwd)/.scan-fixtures/detect-parity" \\
  ./gradlew :lugin-card-detector:testDebugUnitTest \\
  -p mobile/android --info
\`\`\`

\`DetectCardParityTest\` loads each \`*.json\` + \`*.rgba\`, calls
\`DetectCard.detectFromRgba\`, and checks detection / IoU vs ground truth
(and closeness to \`sharedJs.corners\`).

## On-device

After an APK that includes \`lugin-card-detector\` with \`implementationStatus=ready\`:

\`\`\`ts
const r = requireLuginCardDetectorModule().detectFromRgba(b64, w, h);
\`\`\`

Feed the same RGBA (base64) from a sidecar; compare \`detected\` / corners
to \`sharedJs\` in the JSON. Live path uses \`detectFromYPlane\` (no chroma).

## Metrics to match

Same as \`yarn scan:detect-eval\`: detection rate, false-positive rate,
mean IoU (hits), mean corner error (% of frame diagonal).
`,
  );
}

const out = join(CACHE, 'detect-parity-report.json');
await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nreport: ${out}`);
if (exportRgba) console.log(`parity fixtures: ${PARITY_DIR} (${casesIndex.length} cases)`);
console.log(`
Native remains:
  • Kotlin DetectCard cannot execute in Node
  • Run DetectCardParityTest via gradle (see ${exportRgba ? join(PARITY_DIR, 'NATIVE.md') : 'REAL-DETECTION.md'})
  • Or on-device detectFromRgba against exported RGBA / live Y-plane timing
`);
await rm(bundleDir, { force: true, recursive: true });
