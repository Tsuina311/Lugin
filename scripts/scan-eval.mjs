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
const AGENT = 'Lugin/1.0 (+https://github.com/Tsuina311/Lugin)';

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
      export * from '${join(root, 'src/lib/scan/matchName.ts')}';
    `,
    resolveDir: root,
    sourcefile: 'entry.ts',
  },
});
const scan = await import(pathToFileURL(bundle).href);

// ---------------------------------------------------------------------------
// The card-name index
// ---------------------------------------------------------------------------

const INDEX_PATH = opt('index') ?? join(root, '.scan-fixtures/card-names.json');

/**
 * Load the real index if it has been built.
 *
 * Optional on purpose: geometry and preprocessing work can be measured without a
 * 3.5 MB download, and the report says plainly when identification is unavailable
 * rather than quietly reporting 0%.
 */
const loadIndex = async (fold = scan.shapeFold) => {
  try {
    const data = JSON.parse(await readFile(INDEX_PATH, 'utf8'));
    const began = performance.now();
    const built = scan.buildNameIndex(data, fold);
    console.log(
      `index: ${data.names.length.toLocaleString()} names, ` +
        `${built.entries.length.toLocaleString()} titles, ` +
        `built in ${(performance.now() - began).toFixed(0)}ms`,
    );
    return built;
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
    console.log(
      `no card index at ${INDEX_PATH} — run \`yarn scan:index\`.\n` +
        'Identification will be reported as unavailable.',
    );
    return null;
  }
};

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
// Title ROI calibration
// ---------------------------------------------------------------------------

/**
 * Find the rows of dark text in the top of a normalized card.
 *
 * Locally dark rather than globally: the name box is pale on modern frames and
 * near-black on borderless ones, so an absolute threshold picks one and misses
 * the other. Comparing each row against its own median finds ink either way.
 */
const inkRows = (card, { from = 0, to = 0.16, x0 = 0.08, x1 = 0.7 } = {}) => {
  const yFrom = Math.floor(from * card.height);
  const yTo = Math.ceil(to * card.height);
  const xFrom = Math.floor(x0 * card.width);
  const xTo = Math.ceil(x1 * card.width);
  const rows = [];

  for (let y = yFrom; y < yTo; y++) {
    const luma = [];
    for (let x = xFrom; x < xTo; x++) {
      const i = (y * card.width + x) * 4;
      luma.push(0.299 * card.data[i] + 0.587 * card.data[i + 1] + 0.114 * card.data[i + 2]);
    }
    const sorted = [...luma].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    // Ink is a minority of any row containing text, so compare to the row's own
    // median. Both directions, because showcase frames print pale titles on dark.
    const inked = luma.filter(v => Math.abs(v - median) > 45).length;
    rows.push({ share: inked / luma.length, y: y / card.height });
  }
  return rows;
};

/**
 * *First* run of inked rows, not the longest.
 *
 * The longest run in the top of a card is the artwork, every time. The title is
 * the first thing below the border, and it is followed by a gap.
 */
const inkBand = (rows, { minHeight = 0.01, minShare = 0.04 } = {}) => {
  let run = null;
  for (const row of rows) {
    if (row.share >= minShare) {
      run ??= { from: row.y, to: row.y };
      run.to = row.y;
    } else if (run) {
      if (run.to - run.from >= minHeight) return run;
      run = null;
    }
  }
  return run && run.to - run.from >= minHeight ? run : null;
};

const runCalibration = async fixtures => {
  console.log('\nWhere the title actually sits on a normalized card\n');
  console.log('  category           top     bottom  height');
  const bands = [];

  for (const fixture of fixtures) {
    const card = await fixtureImage(fixture);
    // Flat placement, then the real detect → warp, so the measurement includes
    // any systematic bias the warp itself introduces.
    const prepared = scan.prepareCard(placeCard(card));
    const band = inkBand(inkRows(prepared.image));
    if (!band) {
      console.log(`  ${fixture.tag.padEnd(18)} no ink found`);
      continue;
    }
    bands.push({ ...band, tag: fixture.tag });
    console.log(
      `  ${fixture.tag.padEnd(18)} ${band.from.toFixed(3)}   ${band.to.toFixed(3)}` +
        `   ${(band.to - band.from).toFixed(3)}`,
    );
    if (dumpDir) await dump(`calib-${fixture.tag}-card`, prepared.image);
  }

  if (!bands.length) return bands;
  const tops = bands.map(b => b.from).sort((a, b) => a - b);
  const bottoms = bands.map(b => b.to).sort((a, b) => a - b);
  const at = (xs, q) => xs[Math.min(xs.length - 1, Math.floor(q * xs.length))];

  console.log(`\n  ${bands.length} card(s) measured`);
  console.log(`  top     min ${tops[0].toFixed(3)}  median ${at(tops, 0.5).toFixed(3)}  max ${tops.at(-1).toFixed(3)}`);
  console.log(
    `  bottom  min ${bottoms[0].toFixed(3)}  median ${at(bottoms, 0.5).toFixed(3)}  max ${bottoms.at(-1).toFixed(3)}`,
  );

  // Cards whose band ran to the end of the search window never found a gap after
  // the title, so their measurement is not a title at all. Battle cards are
  // landscape and split cards print sideways; both need their own profile rather
  // than a wider standard region, so letting them stretch the suggestion would
  // be fitting the region to layouts it cannot read anyway.
  const unresolved = bands.filter(b => b.to >= 0.155);
  const clean = bands.filter(b => b.to < 0.155);
  if (unresolved.length) {
    console.log(`\n  ignoring ${unresolved.map(b => b.tag).join(', ')} — no title band found`);
  }
  if (!clean.length) return bands;

  const pad = 0.008;
  const y = Math.max(0, Math.min(...clean.map(b => b.from)) - pad);
  const h = Math.min(1 - y, Math.max(...clean.map(b => b.to)) + pad - y);
  console.log(`\n  covers all ${clean.length} readable layouts: { h: ${h.toFixed(3)}, y: ${y.toFixed(3)} }`);
  console.log(`  shipping NAME_REGION:  { h: ${scan.NAME_REGION.h}, y: ${scan.NAME_REGION.y} }`);
  return bands;
};

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

/**
 * Compare normalization strategies for the matcher.
 *
 * `shapeFold` collapses characters OCR confuses (`l`/`1`/`I`, `rn`/`m`) on both
 * sides. That should help, but it also destroys real distinctions and so could
 * make two different cards collide — which is worse than a near miss, because it
 * is confidently wrong. Cheap to settle by measurement: OCR each title once, then
 * match the same readings through each strategy.
 */
const runFolds = async (fixtures, recognizer) => {
  const strategies = [
    { fold: scan.foldName, name: 'foldName (accents + punctuation only)' },
    { fold: scan.shapeFold, name: 'shapeFold (also OCR-confusable characters)' },
  ];

  const indexes = [];
  for (const strategy of strategies) {
    const built = await loadIndex(strategy.fold);
    if (!built) {
      console.log('Cannot compare folds without an index. Run `yarn scan:index` first.');
      return [];
    }
    indexes.push({ ...strategy, index: built });
  }

  // OCR is the expensive part and does not depend on the fold, so read once.
  const readings = [];
  for (const fixture of fixtures) {
    const card = await fixtureImage(fixture);
    for (const condition of conditions) {
      const prepared = scan.prepareCard(condition.render(card));
      const read = await scan.readTitle(prepared.image, recognizer);
      readings.push({ expected: fixture.expectedName, readings: read.readings ?? [] });
    }
  }

  console.log('\nMatcher normalization\n');
  console.log('  strategy                                     top1   top5   titles');
  const rows = [];
  for (const { fold, index, name } of indexes) {
    void fold;
    let top1 = 0;
    let top5 = 0;
    for (const item of readings) {
      const ranked = scan.matchReadings(item.readings, index, { limit: 5 });
      const rank = ranked.findIndex(c => c.name === item.expected);
      if (rank === 0) top1 += 1;
      if (rank >= 0) top5 += 1;
    }
    const row = {
      name,
      titles: index.entries.length,
      top1: top1 / readings.length,
      top5: top5 / readings.length,
    };
    rows.push(row);
    console.log(
      `  ${name.padEnd(44)} ${pct(row.top1).padStart(4)}   ${pct(row.top5).padStart(4)}` +
        `   ${index.entries.length.toLocaleString().padStart(7)}`,
    );
  }
  await recognizer.dispose?.();
  return rows;
};

const runCorpus = async (fixtures, recognizer, index) => {
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
        : { name: null, readings: [], samples: [] };
      const tOcr = performance.now();

      const expected = [fixture.expectedName, fixture.printedName].filter(Boolean);
      const score = reading.name
        ? Math.max(...expected.map(e => similarity(reading.name, e)))
        : 0;

      // What actually matters: did the matcher name the right card? Similarity is
      // only a proxy, and a pessimistic one — it has no idea that "Sol Rinq" is
      // one edit from a real card and zero cards from anything else.
      const candidates = index
        ? scan.matchReadings(reading.readings ?? [], index, { limit: 5 })
        : [];
      const rank = candidates.findIndex(c => c.name === fixture.expectedName);
      // Which individual pass came closest, to tell "wrong crop" from "bad OCR".
      const bestPass = reading.samples
        .map(s => ({
          region: s.region,
          score: Math.max(...expected.map(e => similarity(s.rawText, e))),
        }))
        .sort((a, b) => b.score - a.score)[0];

      const record = {
        candidates: candidates.map(c => ({ name: c.name, score: c.score })),
        condition: condition.name,
        confidence: mean(reading.samples.map(s => s.confidence)),
        detected: prepared.source === 'detected',
        detectionScore: prepared.score,
        expected: fixture.expectedName,
        glare: scan.glareRatio(prepared.image),
        id: fixture.id,
        identified: rank === 0,
        inTopFive: rank >= 0,
        margin: scan.candidateMargin(candidates),
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

const summarize = (results, hasIndex) => {
  const groupBy = (key, rows) => {
    const out = new Map();
    for (const r of rows) {
      const list = out.get(r[key]) ?? [];
      list.push(r);
      out.set(r[key], list);
    }
    return out;
  };

  const share = (rows, key) => rows.filter(r => r[key]).length / rows.length;
  const detRate = rows => share(rows, 'detected');
  // Identification is the real outcome; similarity is only a proxy for it. Where
  // no index is loaded, fall back to the proxy rather than reporting a flat 0%.
  const rate = rows => (hasIndex ? share(rows, 'identified') : share(rows, 'matchable'));

  console.log('\n' + '='.repeat(72));
  console.log(`cases                  ${results.length}`);
  console.log(`card detected          ${pct(detRate(results))}`);
  if (hasIndex) {
    console.log(`CARD IDENTIFIED        ${pct(share(results, 'identified'))}  (top match is correct)`);
    console.log(`correct in top 5       ${pct(share(results, 'inTopFive'))}  (a pick list would work)`);
    console.log(`mean margin            ${pct(mean(results.map(r => r.margin)))}  (lead over runner-up)`);
  } else {
    console.log('card identified        no index loaded');
  }
  console.log(`title matchable        ${pct(share(results, 'matchable'))}  (raw similarity >= ${MATCHABLE})`);
  console.log(`mean title similarity  ${pct(mean(results.map(r => r.similarity)))}`);
  console.log(`mean ocr confidence    ${pct(mean(results.map(r => r.confidence)))}`);
  console.log(
    `mean time              ${mean(results.map(r => r.ms.total)).toFixed(0)}ms` +
      ` (prepare ${mean(results.map(r => r.ms.prepare)).toFixed(0)}ms,` +
      ` ocr ${mean(results.map(r => r.ms.ocr)).toFixed(0)}ms)`,
  );

  const heading = hasIndex ? 'identified' : 'matchable';
  const row = (name, rows) =>
    `  ${name.padEnd(16)} detected ${pct(detRate(rows)).padStart(4)}` +
    `   ${heading} ${pct(rate(rows)).padStart(4)}` +
    (hasIndex ? `   top5 ${pct(share(rows, 'inTopFive')).padStart(4)}` : '') +
    `   similarity ${pct(mean(rows.map(r => r.similarity))).padStart(4)}`;

  console.log('\nby condition');
  for (const [name, rows] of groupBy('condition', results)) console.log(row(name, rows));

  console.log('\nby card category');
  for (const [name, rows] of groupBy('tag', results)) console.log(row(name, rows));

  const bestPasses = groupBy('bestPass', results.filter(r => r.bestPass));
  if (bestPasses.size) {
    console.log('\nwhich title crop read closest');
    for (const [name, rows] of [...bestPasses].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${String(name).padEnd(20)} ${rows.length} case(s)`);
    }
  }

  const failures = hasIndex
    ? results.filter(r => !r.identified)
    : results.filter(r => !r.matchable);
  if (failures.length) {
    console.log(`\n${failures.length} failing case(s)`);
    const geometry = failures.filter(r => !r.detected);
    console.log(`  detection failed        ${geometry.length}`);
    if (hasIndex) {
      const rescuable = failures.filter(r => r.inTopFive).length;
      console.log(`  right card in top 5     ${rescuable}  (manual pick recovers these)`);
      console.log(`  card not in the list    ${failures.length - geometry.length - rescuable}`);
    } else {
      console.log(`  detected but unreadable ${failures.length - geometry.length}`);
    }
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

if (flag('calibrate')) {
  await runCalibration(fixtures);
  await rm(bundleDir, { force: true, recursive: true });
  process.exit(0);
}

console.log(
  `${fixtures.length} fixture(s) × ${conditions.length} condition(s)` +
    `${withOcr ? '' : ', OCR disabled'}\n`,
);

if (flag('folds')) {
  await runFolds(fixtures, await makeRecognizer());
  await rm(bundleDir, { force: true, recursive: true });
  process.exit(0);
}

const index = withOcr ? await loadIndex() : null;
const recognizer = await makeRecognizer();
let report;
try {
  report = flag('variants')
    ? { variants: await runVariants(fixtures, recognizer) }
    : { cases: await runCorpus(fixtures, recognizer, index) };
  if (report.cases) summarize(report.cases, Boolean(index));
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
