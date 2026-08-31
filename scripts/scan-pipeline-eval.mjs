// Comparative evaluation of recognition pipeline modes.
//
//   yarn scan:pipeline
//   yarn scan:pipeline --mode TITLE_ONLY
//   yarn scan:pipeline --real          # gitignored real-photo corpus if present
//
// Modes: TITLE_ONLY | ART_ONLY | ART_PLUS_TITLE | ART_TITLE_TEXT | FULL_PIPELINE
//
// Reports oracle-card top-1 / top-5, false-confident rate, unresolved rate,
// and stage timings. Uses the same portable recognizeCard() as the phone.

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as esbuild from 'esbuild';
import { PNG } from 'pngjs';
import { createWorker, PSM } from 'tesseract.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(root, '.scan-fixtures');
const MANIFEST = join(root, 'scripts/fixtures/cards.json');
const REAL_DIR = join(CACHE, 'real-photos');
const AGENT = 'Lugin/1.0 (+https://github.com/Tsuina311/Lugin)';

const flag = name => process.argv.includes(`--${name}`);
const opt = name => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const MODES = [
  'TITLE_ONLY',
  'ART_ONLY',
  'ART_PLUS_TITLE',
  'ART_TITLE_TEXT',
  'FULL_PIPELINE',
];

const modeArg = (opt('mode') ?? 'ALL').toUpperCase();
const modes = modeArg === 'ALL' ? MODES : [modeArg];
if (modes.some(m => !MODES.includes(m))) {
  console.error(`unknown mode; choose from ${MODES.join(', ')} or ALL`);
  process.exit(1);
}

const bundleDir = await mkdtemp(join(tmpdir(), 'lugin-pipe-'));
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
      export * from '${join(root, 'src/lib/scan/preprocess.ts')}';
      export * from '${join(root, 'src/lib/scan/quality.ts')}';
      export * from '${join(root, 'src/lib/scan/readCard.ts')}';
      export * from '${join(root, 'src/lib/scan/regions.ts')}';
      export * from '${join(root, 'src/lib/scan/matchName.ts')}';
      export * from '${join(root, 'src/lib/scan/artwork/descriptors.ts')}';
      export * from '${join(root, 'src/lib/scan/artwork/match.ts')}';
      export * from '${join(root, 'src/lib/scan/text/evidence.ts')}';
      export * from '${join(root, 'src/lib/scan/session/recognize.ts')}';
      export * from '${join(root, 'src/lib/scan/ranking/fuse.ts')}';
      export * from '${join(root, 'src/lib/scan/temporal/consensus.ts')}';
    `,
    resolveDir: root,
    sourcefile: 'entry.ts',
  },
});
const scan = await import(pathToFileURL(bundle).href);

const pct = x => `${(100 * x).toFixed(0)}%`;
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const percentile = (xs, p) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

const decodePng = buf => {
  const png = PNG.sync.read(buf);
  return {
    data: new Uint8ClampedArray(png.data),
    height: png.height,
    width: png.width,
  };
};

const encodePng = image => {
  const png = new PNG({ height: image.height, width: image.width });
  png.data = Buffer.from(image.data);
  return PNG.sync.write(png);
};

const loadNameIndex = async () => {
  const path = opt('index') ?? join(CACHE, 'card-names.json');
  if (!existsSync(path)) {
    console.log('no card-names.json — run yarn scan:index');
    return null;
  }
  const data = JSON.parse(await readFile(path, 'utf8'));
  return scan.buildNameIndex(data, scan.shapeFold);
};

const loadArtBundle = async () => {
  const path = opt('art-index') ?? join(CACHE, 'art-index.json');
  if (!existsSync(path)) {
    console.log('no art-index.json — run yarn scan:art-index (title-only modes still work)');
    return { art: null, text: null, matcher: scan.createArtworkMatcher(null) };
  }
  const body = JSON.parse(await readFile(path, 'utf8'));
  const art = body.art?.entries ? body.art : body.entries ? body : null;
  const text = body.text ?? null;
  return { art, text, matcher: scan.createArtworkMatcher(art) };
};

const makeRecognizer = async () => {
  const worker = await createWorker('eng', 1, {
    cachePath: join(CACHE, 'tessdata'),
    gzip: false,
    logger: () => undefined,
  });
  const modes = { block: PSM.AUTO, line: PSM.SINGLE_LINE, word: PSM.SINGLE_WORD };
  return {
    async recognize(image, options = {}) {
      await worker.setParameters({
        tessedit_char_whitelist: options.whitelist ?? '',
        tessedit_pageseg_mode: modes[options.mode ?? 'block'],
      });
      const { data } = await worker.recognize(encodePng(image), {}, { text: true });
      return { confidence: (data.confidence ?? 0) / 100, text: data.text ?? '' };
    },
    async dispose() {
      await worker.terminate();
    },
  };
};

const placeCard = card => {
  // Flat, centred placement matching the classic eval “clean” condition.
  const frameW = Math.round(card.width * 1.35);
  const frameH = Math.round(card.height * 1.35);
  const frame = scan.blankImage(frameW, frameH);
  // light desk
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
  return frame;
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

const loadSynthetic = async () => {
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  return manifest.cards.map(c => ({
    expectedName: c.expectedName,
    expectedScryfallId: c.id,
    id: c.id,
    source: 'synthetic',
    tag: c.tag,
    image: c.image,
  }));
};

/** Real-photo corpus: JSON sidecars next to PNGs under .scan-fixtures/real-photos/. */
const loadReal = async () => {
  if (!existsSync(REAL_DIR)) {
    console.log(`real-photo corpus missing (${REAL_DIR}) — skipping`);
    return [];
  }
  const files = await readdir(REAL_DIR);
  const out = [];
  for (const f of files.filter(n => n.endsWith('.json'))) {
    const meta = JSON.parse(await readFile(join(REAL_DIR, f), 'utf8'));
    const png = meta.imageFile ?? f.replace(/\.json$/, '.png');
    const path = join(REAL_DIR, png);
    if (!existsSync(path)) continue;
    out.push({
      expectedName: meta.expectedName,
      expectedScryfallId: meta.scryfallId,
      id: meta.scryfallId ?? f,
      source: 'real',
      tag: meta.tag ?? 'real',
      localPath: path,
    });
  }
  return out;
};

const modeOptions = mode => {
  switch (mode) {
    case 'TITLE_ONLY':
      return { skipArtwork: true, skipOcr: false };
    case 'ART_ONLY':
      return { skipArtwork: false, skipOcr: true };
    case 'ART_PLUS_TITLE':
      return { skipArtwork: false, skipOcr: false };
    case 'ART_TITLE_TEXT':
      return { skipArtwork: false, skipOcr: false, wantText: true };
    case 'FULL_PIPELINE':
      return {
        skipArtwork: false,
        skipOcr: false,
        wantText: true,
        wantTypeLine: true,
        wantFooter: true,
      };
    default:
      return {};
  }
};

const runMode = async (mode, cases, deps) => {
  const opts = modeOptions(mode);
  const rows = [];
  for (const c of cases) {
    const card = c.localPath
      ? decodePng(await readFile(c.localPath))
      : await fixtureImage(c);
    const frame = c.localPath ? card : placeCard(card);
    const t0 = performance.now();
    const prepared = scan.prepareCard(frame);
    const tPrep = performance.now();
    if (!prepared.detected) {
      rows.push({
        detected: false,
        expected: c.expectedName,
        falseConfident: false,
        identified: false,
        inTopFive: false,
        ms: tPrep - t0,
        stageMs: {},
        status: 'no-card',
        tag: c.tag,
        top: null,
      });
      continue;
    }
    const { result } = await scan.recognizeCard(prepared.image, deps, opts);
    const total = performance.now() - t0;
    const ranked = result.fused.candidates;
    const rank = ranked.findIndex(r => r.name === c.expectedName);
    const status = result.fused.status;
    const confident =
      status === 'identified' || status === 'printing-ambiguous';
    const correct = rank === 0;
    rows.push({
      detected: true,
      expected: c.expectedName,
      falseConfident: confident && !correct,
      identified: correct && confident,
      inTopFive: rank >= 0 && rank < 5,
      ms: total,
      stageMs: result.timings,
      status,
      tag: c.tag,
      top: ranked[0]?.name ?? null,
      topScore: ranked[0]?.score ?? 0,
      unresolved: !confident,
    });
  }
  return rows;
};

const summarize = (mode, rows) => {
  const n = rows.length || 1;
  const detected = rows.filter(r => r.detected).length / n;
  const top1 = rows.filter(r => r.top === r.expected).length / n;
  const top5 = rows.filter(r => r.inTopFive).length / n;
  const falseConf = rows.filter(r => r.falseConfident).length / n;
  const unresolved = rows.filter(r => r.unresolved).length / n;
  const identified = rows.filter(r => r.identified).length / n;
  const times = rows.map(r => r.ms);
  console.log(`\n=== ${mode} (${rows.length} cases) ===`);
  console.log(`  detected              ${pct(detected)}`);
  console.log(`  oracle top-1 (name)   ${pct(top1)}`);
  console.log(`  oracle top-5          ${pct(top5)}`);
  console.log(`  auto-identified       ${pct(identified)}  (confident + correct)`);
  console.log(`  false confident       ${pct(falseConf)}  (confident but wrong)`);
  console.log(`  unresolved            ${pct(unresolved)}`);
  console.log(
    `  latency median/p95    ${mean(times).toFixed(0)}ms mean · ` +
      `${percentile(times, 50).toFixed(0)}ms p50 · ${percentile(times, 95).toFixed(0)}ms p95`,
  );
  const art = rows.map(r => r.stageMs?.artworkMs).filter(x => x != null);
  const title = rows.map(r => r.stageMs?.titleMs).filter(x => x != null);
  const text = rows.map(r => r.stageMs?.textMs).filter(x => x != null);
  if (art.length) console.log(`  artwork stage mean    ${mean(art).toFixed(0)}ms`);
  if (title.length) console.log(`  title stage mean      ${mean(title).toFixed(0)}ms`);
  if (text.length) console.log(`  text stage mean       ${mean(text).toFixed(0)}ms`);
  return {
    detected,
    falseConfident: falseConf,
    identified,
    mode,
    p50Ms: percentile(times, 50),
    p95Ms: percentile(times, 95),
    top1,
    top5,
    unresolved,
  };
};

const nameIndex = await loadNameIndex();
const artBundle = await loadArtBundle();
const ocr = await makeRecognizer();

const deps = {
  artwork: artBundle.matcher,
  artworkIndex: artBundle.art,
  nameIndex,
  ocr,
  textIndex: artBundle.text,
};

let cases = flag('real') ? await loadReal() : await loadSynthetic();
if (!cases.length) {
  console.error('no cases to evaluate');
  await ocr.dispose();
  await rm(bundleDir, { force: true, recursive: true });
  process.exit(1);
}

console.log(
  `pipeline eval: ${cases.length} case(s), modes=${modes.join(',')}` +
    `${artBundle.art ? `, art=${artBundle.art.entries.length}` : ', art=none'}` +
    `${nameIndex ? `, names=${nameIndex.entries.length}` : ', names=none'}`,
);

const report = { generated: new Date().toISOString(), modes: {} };
try {
  for (const mode of modes) {
    const rows = await runMode(mode, cases, deps);
    report.modes[mode] = { summary: summarize(mode, rows), cases: rows };
  }
} finally {
  await ocr.dispose();
  await rm(bundleDir, { force: true, recursive: true });
}

await mkdir(CACHE, { recursive: true });
const out = join(CACHE, flag('real') ? 'pipeline-real.json' : 'pipeline-report.json');
await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nreport: ${out}`);
