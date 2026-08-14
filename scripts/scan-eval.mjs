// Measure the card scanner against a repeatable corpus.
//
//   node scripts/scan-eval.mjs --build-fixtures   # resolve the manifest from Scryfall
//   node scripts/scan-eval.mjs                    # run the corpus (downloads missing art)
//   node scripts/scan-eval.mjs --variants         # benchmark preprocessing chains
//   node scripts/scan-eval.mjs --no-ocr           # geometry only, no traineddata needed
//   node scripts/scan-eval.mjs --only kozilek --dump out
//
// Why this exists: "the scanner feels bad" is not a diagnosis, and a change that
// fixes one card on one desk routinely breaks five others. This runs the real
// pipeline — the same `src/lib/scan` modules the phone runs — over a fixed set of
// cards under synthetic camera abuse, and prints numbers you can compare between
// runs.
//
// Fixtures are Scryfall card images, downloaded on demand into a gitignored
// directory from a committed manifest of ids. No card art is ever committed here.
//
// Honest limitation: synthetic tilt, blur and glare are not photographs. They
// exercise geometry and preprocessing, and they will not tell the truth about
// foils, sleeves or real autofocus. Those need real phone photos dropped into
// the same fixture directory later.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as esbuild from 'esbuild';
import { PNG } from 'pngjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(root, 'scripts/fixtures/cards.json');
const CACHE = join(root, '.scan-fixtures');
const AGENT = 'Lugin/1.0 (+https://github.com/Tsuina311/lugin)';

const flag = name => process.argv.includes(`--${name}`);
const opt = name => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const withOcr = !flag('no-ocr');
const only = opt('only')?.toLowerCase();
const dumpDir = opt('dump');

// ---------------------------------------------------------------------------
// Load the scanner core the same way the other test scripts do.
// ---------------------------------------------------------------------------

const bundleDir = await mkdtemp(join(tmpdir(), 'lugin-eval-'));
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
    `,
    resolveDir: root,
    sourcefile: 'entry.ts',
  },
});
const scan = await import(pathToFileURL(bundle).href);

// ---------------------------------------------------------------------------
// PNG <-> ScanImage
// ---------------------------------------------------------------------------

const decodePng = buffer => {
  const png = PNG.sync.read(buffer);
  return {
    data: new Uint8ClampedArray(png.data),
    height: png.height,
    width: png.width,
  };
};

const encodePng = image => {
  const png = new PNG({ height: image.height, width: image.width });
  png.data = Buffer.from(image.data.buffer, image.data.byteOffset, image.data.length);
  return PNG.sync.write(png);
};

const dump = async (name, image) => {
  if (!dumpDir) return;
  await mkdir(dumpDir, { recursive: true });
  await writeFile(join(dumpDir, `${name}.png`), encodePng(image));
};

// ---------------------------------------------------------------------------
// Fixture manifest
// ---------------------------------------------------------------------------

/**
 * One query per scan condition we care about, resolved against Scryfall once and
 * then pinned by id.
 *
 * Ordered by EDHREC rank rather than name: alphabetical order fills the corpus
 * with blank-named joke cards and Alchemy rebalances, whereas popularity yields
 * the cards people actually own and therefore actually scan. Deterministic
 * enough, and the resolved ids are pinned in the manifest either way.
 */
const EXCLUDE = '-is:digital -is:funny game:paper';

const CATEGORIES = [
  ['modern-frame', 'frame:2015 rarity:rare -is:showcase -is:borderless lang:en'],
  ['modern-common', 'frame:2015 rarity:common -is:showcase -is:borderless lang:en'],
  ['old-frame-1993', 'frame:1993 lang:en'],
  ['frame-1997', 'frame:1997 lang:en'],
  ['frame-2003', 'frame:2003 lang:en'],
  ['borderless', 'is:borderless lang:en'],
  ['showcase', 'is:showcase lang:en'],
  ['extended-art', 'is:extendedart lang:en'],
  ['planeswalker', 'type:planeswalker frame:2015 lang:en'],
  ['saga', 'type:saga lang:en'],
  ['double-faced', 'layout:transform lang:en'],
  ['modal-dfc', 'layout:modal_dfc lang:en'],
  ['split', 'layout:split lang:en'],
  ['adventure', 'layout:adventure lang:en'],
  ['leveler', 'layout:leveler lang:en'],
  ['battle', 'type:battle lang:en'],
  // Excluding "//" keeps out multi-name cards whose *printed* title is short.
  ['long-name', 'name:/^[^\\/]{26,}$/ layout:normal frame:2015 lang:en'],
  ['short-name', 'name:/^.{3,6}$/ layout:normal frame:2015 lang:en'],
  // Foreign printings need unique=prints, or the English print wins the dedupe
  // and we lose the printed_name we are trying to test against.
  ['french', 'lang:fr frame:2015', 'prints'],
  ['german', 'lang:de frame:2015', 'prints'],
  ['italian', 'lang:it frame:2015', 'prints'],
  ['japanese', 'lang:ja frame:2015', 'prints'],
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

const scryfall = async path => {
  const res = await fetch(`https://api.scryfall.com${path}`, {
    headers: { Accept: 'application/json', 'User-Agent': AGENT },
  });
  if (!res.ok) throw new Error(`scryfall ${path}: ${res.status} ${res.statusText}`);
  return res.json();
};

const frontImage = card =>
  card.image_uris?.png ?? card.card_faces?.[0]?.image_uris?.png ?? null;

/** The title actually printed on the visible face. */
const printedTitle = card =>
  card.card_faces?.[0]?.printed_name ??
  card.printed_name ??
  card.card_faces?.[0]?.name ??
  card.name;

const buildFixtures = async () => {
  const cards = [];
  const seen = new Set();
  for (const [tag, query, unique = 'cards'] of CATEGORIES) {
    const url =
      `/cards/search?order=edhrec&dir=asc&unique=${unique}&include_multilingual=true&q=` +
      encodeURIComponent(`${query} ${EXCLUDE}`);
    try {
      const { data } = await scryfall(url);
      // Dedupe on name *and* language: without it every frame category collapses
      // onto the most popular card, and the corpus tests one title eight times.
      // Keyed per language on purpose, so the same card in four languages is a
      // clean experiment on printed names alone.
      const key = c => `${c.name}|${c.lang}`;
      const card = data?.find(c => frontImage(c) && !seen.has(key(c)));
      if (!card) {
        console.warn(`  ${tag}: no unused result with a png image`);
        continue;
      }
      seen.add(key(card));
      cards.push({
        collectorNumber: card.collector_number,
        expectedName: card.name,
        id: card.id,
        image: frontImage(card),
        lang: card.lang,
        layout: card.layout,
        printedName: printedTitle(card),
        set: card.set,
        tag,
      });
      console.log(`  ${tag}: ${card.name} (${card.set} ${card.collector_number})`);
    } catch (err) {
      console.warn(`  ${tag}: ${err.message}`);
    }
    // Scryfall asks for ~10 req/s at most; be a good citizen.
    await sleep(120);
  }

  const manifest = {
    generated: new Date().toISOString(),
    note: 'Scryfall ids only. Images are downloaded to .scan-fixtures/ and never committed.',
    version: 1,
    cards,
  };
  await mkdir(dirname(MANIFEST), { recursive: true });
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nwrote ${cards.length} fixtures to ${MANIFEST}`);
};

const loadFixtures = async () => {
  if (!existsSync(MANIFEST)) {
    console.error(
      `No fixture manifest at ${MANIFEST}.\nRun: node scripts/scan-eval.mjs --build-fixtures`,
    );
    process.exit(1);
  }
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  const cards = only
    ? manifest.cards.filter(
        c =>
          c.expectedName.toLowerCase().includes(only) ||
          c.tag.includes(only) ||
          c.id.startsWith(only),
      )
    : manifest.cards;
  if (!cards.length) {
    console.error(only ? `No fixture matched "${only}".` : 'Manifest has no cards.');
    process.exit(1);
  }
  return cards;
};

const fixtureImage = async card => {
  await mkdir(CACHE, { recursive: true });
  const file = join(CACHE, `${card.id}.png`);
  if (!existsSync(file)) {
    if (!card.image) throw new Error('fixture has no image url');
    const res = await fetch(card.image, { headers: { 'User-Agent': AGENT } });
    if (!res.ok) throw new Error(`image ${res.status} ${res.statusText}`);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    await sleep(120);
  }
  return decodePng(await readFile(file));
};

// ---------------------------------------------------------------------------
// Synthetic camera conditions
// ---------------------------------------------------------------------------

const FRAME_W = 1080;
const FRAME_H = 1440;

const filledFrame = (width, height, level) => {
  const image = scan.blankImage(width, height);
  for (let i = 0; i < image.data.length; i += 4) {
    // Slight per-pixel noise: a flat synthetic background makes edge detection
    // look better than any real desk ever will.
    const v = level + ((i * 2654435761) % 11) - 5;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = Math.max(0, Math.min(255, v));
  }
  return image;
};

/**
 * Composite `card` into a frame at a given scale, rotation and perspective tilt.
 * Uses the shipped homography so the harness cannot disagree with the app about
 * what a projected card looks like.
 */
const placeCard = (card, { background = 90, rotate = 0, scale = 0.82, tilt = 0 } = {}) => {
  const frame = filledFrame(FRAME_W, FRAME_H, background);
  const h = FRAME_H * scale;
  const w = h * scan.CARD_ASPECT;
  const cx = FRAME_W / 2;
  const cy = FRAME_H / 2;

  // Corners before rotation, with `tilt` shrinking the top edge for perspective.
  const shrink = 1 - tilt;
  const corners = [
    { x: -(w / 2) * shrink, y: -h / 2 },
    { x: (w / 2) * shrink, y: -h / 2 },
    { x: w / 2, y: h / 2 },
    { x: -w / 2, y: h / 2 },
  ].map(p => {
    const a = (rotate * Math.PI) / 180;
    return {
      x: cx + p.x * Math.cos(a) - p.y * Math.sin(a),
      y: cy + p.x * Math.sin(a) + p.y * Math.cos(a),
    };
  });

  const quad = scan.orderCorners(corners);
  const source = scan.rectQuad(0, 0, card.width - 1, card.height - 1);
  // H maps frame coordinates inside `quad` back to card pixels.
  const H = scan.homographyDestToSrc(source, quad);

  const minX = Math.max(0, Math.floor(Math.min(...quad.map(p => p.x))));
  const maxX = Math.min(FRAME_W - 1, Math.ceil(Math.max(...quad.map(p => p.x))));
  const minY = Math.max(0, Math.floor(Math.min(...quad.map(p => p.y))));
  const maxY = Math.min(FRAME_H - 1, Math.ceil(Math.max(...quad.map(p => p.y))));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const p = scan.applyH(H, { x, y });
      if (p.x < 0 || p.y < 0 || p.x >= card.width - 1 || p.y >= card.height - 1) continue;
      const x0 = Math.floor(p.x);
      const y0 = Math.floor(p.y);
      const fx = p.x - x0;
      const fy = p.y - y0;
      const i00 = (y0 * card.width + x0) * 4;
      const i10 = (y0 * card.width + x0 + 1) * 4;
      const i01 = ((y0 + 1) * card.width + x0) * 4;
      const i11 = ((y0 + 1) * card.width + x0 + 1) * 4;
      const oi = (y * FRAME_W + x) * 4;
      // Scryfall PNGs have transparent rounded corners; skip them so the card
      // silhouette stays rounded instead of gaining black triangles.
      if (card.data[i00 + 3] < 128) continue;
      for (let c = 0; c < 3; c++) {
        frame.data[oi + c] =
          card.data[i00 + c] * (1 - fx) * (1 - fy) +
          card.data[i10 + c] * fx * (1 - fy) +
          card.data[i01 + c] * (1 - fx) * fy +
          card.data[i11 + c] * fx * fy;
      }
    }
  }
  return frame;
};

const boxBlur = (image, radius) => {
  const out = scan.copy(image);
  const { height, width } = image;
  const tmp = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let n = 0;
        for (let k = -radius; k <= radius; k++) {
          const xx = Math.min(width - 1, Math.max(0, x + k));
          sum += image.data[(y * width + xx) * 4 + c];
          n += 1;
        }
        tmp[(y * width + x) * 3 + c] = sum / n;
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let n = 0;
        for (let k = -radius; k <= radius; k++) {
          const yy = Math.min(height - 1, Math.max(0, y + k));
          sum += tmp[(yy * width + x) * 3 + c];
          n += 1;
        }
        out.data[(y * width + x) * 4 + c] = sum / n;
      }
    }
  }
  return out;
};

const scaleLuma = (image, factor) => {
  const out = scan.copy(image);
  for (let i = 0; i < out.data.length; i += 4) {
    for (let c = 0; c < 3; c++) out.data[i + c] = Math.min(255, out.data[i + c] * factor);
  }
  return out;
};

/** A soft bright ellipse, roughly where a ceiling light lands on a glossy card. */
const addGlare = (image, { cx = 0.42, cy = 0.28, radius = 0.3, strength = 150 } = {}) => {
  const out = scan.copy(image);
  const { height, width } = image;
  const px = cx * width;
  const py = cy * height;
  const r = radius * Math.min(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.hypot(x - px, y - py) / r;
      if (d >= 1) continue;
      const add = strength * (1 - d) ** 2;
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) out.data[i + c] = Math.min(255, out.data[i + c] + add);
    }
  }
  return out;
};

/** Filming a phone or monitor: soft, slightly dim, with scanline banding. */
const screenCapture = image => {
  const out = boxBlur(scaleLuma(image, 0.8), 1);
  const { height, width } = out;
  for (let y = 0; y < height; y++) {
    const band = y % 3 === 0 ? 0.9 : 1.04;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) out.data[i + c] = Math.min(255, out.data[i + c] * band);
    }
  }
  return out;
};

const CONDITIONS = [
  { name: 'flat', render: card => placeCard(card) },
  { name: 'rotated', render: card => placeCard(card, { rotate: 12 }) },
  { name: 'tilted', render: card => placeCard(card, { tilt: 0.18 }) },
  { name: 'tilted-rotated', render: card => placeCard(card, { rotate: -8, tilt: 0.12 }) },
  { name: 'far', render: card => placeCard(card, { scale: 0.45 }) },
  { name: 'near', render: card => placeCard(card, { scale: 1.02 }) },
  { name: 'dim', render: card => scaleLuma(placeCard(card), 0.45) },
  { name: 'glare', render: card => addGlare(placeCard(card)) },
  { name: 'blurred', render: card => boxBlur(placeCard(card), 2) },
  { name: 'screen', render: card => screenCapture(placeCard(card, { background: 40 })) },
  { name: 'light-bg', render: card => placeCard(card, { background: 225 }) },
];

const conditionFilter = opt('conditions')?.split(',');
const conditions = conditionFilter
  ? CONDITIONS.filter(c => conditionFilter.includes(c.name))
  : CONDITIONS;

// ---------------------------------------------------------------------------
// Text similarity — the measuring stick, deliberately not the future matcher.
// ---------------------------------------------------------------------------

const fold = s =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const levenshtein = (a, b) => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
};

const similarity = (a, b) => {
  const x = fold(a);
  const y = fold(b);
  if (!x || !y) return 0;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
};

/** Above this, the title read is close enough that fuzzy matching should win. */
const MATCHABLE = 0.75;

// ---------------------------------------------------------------------------
// Node recognizer
// ---------------------------------------------------------------------------

const makeRecognizer = async () => {
  if (!withOcr) {
    return { recognize: async () => ({ confidence: 0, text: '', words: [] }) };
  }
  const { createWorker, PSM } = await import('tesseract.js');
  const modes = { block: PSM.AUTO, line: PSM.SINGLE_LINE, word: PSM.SINGLE_WORD };
  await mkdir(join(CACHE, 'tessdata'), { recursive: true });
  const worker = await createWorker('eng+fra+deu+ita', 1, {
    cachePath: join(CACHE, 'tessdata'),
    logger: () => undefined,
  });

  return {
    dispose: () => worker.terminate(),
    recognize: async (image, options = {}) => {
      await worker.setParameters({
        tessedit_char_whitelist: options.whitelist ?? '',
        tessedit_pageseg_mode: modes[options.mode ?? 'block'],
      });
      const { data } = await worker.recognize(encodePng(image), {}, { blocks: true, text: true });
      const words = (data.blocks ?? []).flatMap(
        b =>
          b.paragraphs?.flatMap(p => p.lines?.flatMap(l => l.words ?? []) ?? []) ?? [],
      );
      const scored = words.filter(w => w.text?.trim());
      return {
        confidence: scored.length
          ? scored.reduce((s, w) => s + (w.confidence ?? 0) / 100, 0) / scored.length
          : (data.confidence ?? 0) / 100,
        text: data.text ?? '',
        words: scored.map(w => ({ confidence: (w.confidence ?? 0) / 100, text: w.text ?? '' })),
      };
    },
  };
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = x => `${(x * 100).toFixed(0)}%`;

const runVariants = async (fixtures, recognizer) => {
  console.log('\nPreprocessing variants on the title crop\n');
  const totals = new Map();

  for (const fixture of fixtures) {
    const card = await fixtureImage(fixture);
    for (const condition of conditions) {
      const frame = condition.render(card);
      const prepared = scan.prepareCard(frame);
      const crop = scan.cropImage(prepared.image, scan.NAME_REGION);

      for (const variant of scan.PREPROCESS_VARIANTS) {
        const began = performance.now();
        const processed = variant.apply(crop);
        const result = await recognizer.recognize(processed, {
          mode: 'line',
          whitelist: scan.TITLE_WHITELIST,
        });
        const ms = performance.now() - began;
        const score = Math.max(
          similarity(result.text, fixture.expectedName),
          similarity(result.text, fixture.printedName ?? fixture.expectedName),
        );
        const acc = totals.get(variant.name) ?? { conf: [], ms: [], score: [], wins: 0 };
        acc.conf.push(result.confidence);
        acc.ms.push(ms);
        acc.score.push(score);
        totals.set(variant.name, acc);
      }
    }
  }

  const rows = [...totals.entries()]
    .map(([name, acc]) => ({
      confidence: mean(acc.conf),
      matchable: acc.score.filter(s => s >= MATCHABLE).length / acc.score.length,
      ms: mean(acc.ms),
      name,
      similarity: mean(acc.score),
    }))
    .sort((a, b) => b.similarity - a.similarity);

  console.log('  variant                  similarity  matchable  ocr-conf   ms');
  for (const r of rows) {
    console.log(
      `  ${r.name.padEnd(24)} ${pct(r.similarity).padStart(9)}  ${pct(r.matchable).padStart(9)}` +
        `  ${pct(r.confidence).padStart(8)}  ${r.ms.toFixed(0).padStart(4)}`,
    );
  }
  console.log(
    `\n  shipping variant: ${scan.PRODUCTION_VARIANT}` +
      (rows[0] && rows[0].name !== scan.PRODUCTION_VARIANT
        ? ` — beaten by ${rows[0].name}`
        : ' — still the best of these'),
  );
  return rows;
};

const runCorpus = async (fixtures, recognizer) => {
  const results = [];

  for (const fixture of fixtures) {
    const card = await fixtureImage(fixture);
    for (const condition of conditions) {
      const t0 = performance.now();
      const frame = condition.render(card);
      const tRender = performance.now();
      const prepared = scan.prepareCard(frame);
      const tPrepare = performance.now();

      const reading = withOcr
        ? await scan.readTitle(prepared.image, recognizer)
        : { name: null, samples: [] };
      const tOcr = performance.now();

      const expected = [fixture.expectedName, fixture.printedName].filter(Boolean);
      const score = reading.name
        ? Math.max(...expected.map(e => similarity(reading.name, e)))
        : 0;
      // Which individual pass came closest, to tell "wrong crop" from "bad OCR".
      const bestPass = reading.samples
        .map(s => ({
          region: s.region,
          score: Math.max(...expected.map(e => similarity(s.rawText, e))),
        }))
        .sort((a, b) => b.score - a.score)[0];

      const record = {
        condition: condition.name,
        confidence: mean(reading.samples.map(s => s.confidence)),
        detected: prepared.source === 'detected',
        detectionScore: prepared.score,
        expected: fixture.expectedName,
        glare: scan.glareRatio(prepared.image),
        id: fixture.id,
        matchable: score >= MATCHABLE,
        ms: { ocr: tOcr - tPrepare, prepare: tPrepare - tRender, total: tOcr - t0 },
        read: reading.name,
        sharpness: scan.sharpnessScore(prepared.image),
        similarity: score,
        tag: fixture.tag,
        ...(bestPass ? { bestPass: bestPass.region, bestPassScore: bestPass.score } : {}),
      };
      results.push(record);

      if (dumpDir) {
        const stem = `${fixture.tag}-${condition.name}`;
        await dump(`${stem}-frame`, frame);
        await dump(`${stem}-card`, prepared.image);
        await dump(
          `${stem}-title`,
          scan.enhanceForOcr(scan.cropImage(prepared.image, scan.NAME_REGION)),
        );
      }

      const mark = record.matchable ? 'ok  ' : record.detected ? 'MISS' : 'GEO ';
      console.log(
        `  ${mark} ${fixture.tag.padEnd(16)} ${condition.name.padEnd(15)} ` +
          `${pct(record.similarity).padStart(4)} ${record.detected ? 'det' : '---'} ` +
          `${record.ms.total.toFixed(0).padStart(5)}ms  ${(record.read ?? '(nothing)').slice(0, 40)}`,
      );
    }
  }
  return results;
};

const summarize = results => {
  const groupBy = (key, rows) => {
    const out = new Map();
    for (const r of rows) {
      const list = out.get(r[key]) ?? [];
      list.push(r);
      out.set(r[key], list);
    }
    return out;
  };

  const rate = rows => rows.filter(r => r.matchable).length / rows.length;
  const detRate = rows => rows.filter(r => r.detected).length / rows.length;

  console.log('\n' + '='.repeat(72));
  console.log(`cases                  ${results.length}`);
  console.log(`card detected          ${pct(detRate(results))}`);
  console.log(`title matchable        ${pct(rate(results))}  (similarity >= ${MATCHABLE})`);
  console.log(`mean title similarity  ${pct(mean(results.map(r => r.similarity)))}`);
  console.log(`mean ocr confidence    ${pct(mean(results.map(r => r.confidence)))}`);
  console.log(
    `mean time              ${mean(results.map(r => r.ms.total)).toFixed(0)}ms` +
      ` (prepare ${mean(results.map(r => r.ms.prepare)).toFixed(0)}ms,` +
      ` ocr ${mean(results.map(r => r.ms.ocr)).toFixed(0)}ms)`,
  );

  console.log('\nby condition');
  for (const [name, rows] of groupBy('condition', results)) {
    console.log(
      `  ${name.padEnd(16)} detected ${pct(detRate(rows)).padStart(4)}` +
        `   matchable ${pct(rate(rows)).padStart(4)}` +
        `   similarity ${pct(mean(rows.map(r => r.similarity))).padStart(4)}`,
    );
  }

  console.log('\nby card category');
  for (const [name, rows] of groupBy('tag', results)) {
    console.log(
      `  ${name.padEnd(16)} detected ${pct(detRate(rows)).padStart(4)}` +
        `   matchable ${pct(rate(rows)).padStart(4)}` +
        `   similarity ${pct(mean(rows.map(r => r.similarity))).padStart(4)}`,
    );
  }

  const bestPasses = groupBy('bestPass', results.filter(r => r.bestPass));
  if (bestPasses.size) {
    console.log('\nwhich title crop read closest');
    for (const [name, rows] of [...bestPasses].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${String(name).padEnd(20)} ${rows.length} case(s)`);
    }
  }

  const failures = results.filter(r => !r.matchable);
  if (failures.length) {
    console.log(`\n${failures.length} failing case(s)`);
    const geometry = failures.filter(r => !r.detected);
    console.log(`  detection failed        ${geometry.length}`);
    console.log(`  detected but unreadable ${failures.length - geometry.length}`);
  }
  console.log('='.repeat(72));
};

// ---------------------------------------------------------------------------

if (flag('build-fixtures')) {
  await buildFixtures();
  await rm(bundleDir, { force: true, recursive: true });
  process.exit(0);
}

if (flag('self-test')) {
  // Guards the harness itself: a broken measuring stick is worse than none.
  assert.equal(similarity('Lightning Bolt', 'Lightning Bolt'), 1);
  assert.ok(similarity('Lightninq Bolt', 'Lightning Bolt') > 0.9);
  assert.ok(similarity('Lightning Bolt', 'Grizzly Bears') < 0.5);
  assert.equal(fold('Éther Spellbomb'), 'etherspellbomb');
  const probe = scan.blankImage(20, 20);
  assert.equal(encodePng(probe).length > 0, true);
  assert.deepEqual(decodePng(encodePng(probe)).width, 20);
  console.log('harness self-test ok');
  await rm(bundleDir, { force: true, recursive: true });
  process.exit(0);
}

const fixtures = await loadFixtures();
console.log(
  `${fixtures.length} fixture(s) × ${conditions.length} condition(s)` +
    `${withOcr ? '' : ', OCR disabled'}\n`,
);

const recognizer = await makeRecognizer();
let report;
try {
  report = flag('variants')
    ? { variants: await runVariants(fixtures, recognizer) }
    : { cases: await runCorpus(fixtures, recognizer) };
  if (report.cases) summarize(report.cases);
} finally {
  await recognizer.dispose?.();
  await rm(bundleDir, { force: true, recursive: true });
}

const reportPath = join(CACHE, flag('variants') ? 'variants.json' : 'report.json');
await writeFile(
  reportPath,
  `${JSON.stringify({ generated: new Date().toISOString(), ...report }, null, 2)}\n`,
);
console.log(`\nreport: ${reportPath}`);

// Keep the git status clean of fixture noise.
try {
  execFileSync('git', ['check-ignore', '-q', CACHE], { cwd: root });
} catch {
  console.warn(`\nwarning: ${CACHE} is not gitignored`);
}
