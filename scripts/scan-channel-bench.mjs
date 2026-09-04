#!/usr/bin/env node
/**
 * Channel race: artwork vs title (CardNameIndex) vs PrintingIndex.
 *
 * Assumes good-quality normalized card imagery (Scryfall PNG ≈ phone warp).
 * Title / footer paths use perfect readings (known name + set/collector) so this
 * measures *index* latency + accuracy, not OCR engine quality.
 *
 *   node scripts/scan-channel-bench.mjs
 *   node scripts/scan-channel-bench.mjs --count 50 --report .scan-fixtures/channel-bench-report.json
 *
 * Indexes (defaults under .scan-fixtures/):
 *   --printing printing-index.json
 *   --art      art-index.production.json  (falls back to art-index.json)
 *   --names    card-names.json
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { PNG } from 'pngjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(root, '.scan-fixtures');
const AGENT = 'Lugin/1.0 (+https://github.com/Tsuina311/Lugin)';

const arg = name => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const count = Math.max(5, Number(arg('count') ?? '50') || 50);
const reportPath =
  arg('report') ?? join(CACHE, 'channel-bench-report.json');
const reportTextPath =
  arg('report-text') ?? join(CACHE, 'channel-bench-report.txt');

const printingPath =
  arg('printing') ?? join(CACHE, 'printing-index.json');
const namesPath = arg('names') ?? join(CACHE, 'card-names.json');
const artPath =
  arg('art') ??
  (existsSync(join(CACHE, 'art-index.production.json'))
    ? join(CACHE, 'art-index.production.json')
    : join(CACHE, 'art-index.json'));

if (!existsSync(printingPath)) {
  console.error(`missing printing index: ${printingPath}\nRun: yarn scan:printing-index`);
  process.exit(1);
}
if (!existsSync(namesPath)) {
  console.error(`missing card-names: ${namesPath}`);
  process.exit(1);
}
if (!existsSync(artPath)) {
  console.error(`missing art index: ${artPath}`);
  process.exit(1);
}

const bundleDir = await mkdtemp(join(tmpdir(), 'lugin-channel-'));
const bundle = join(bundleDir, 'scan.mjs');
await esbuild.build({
  bundle: true,
  format: 'esm',
  outfile: bundle,
  platform: 'neutral',
  stdin: {
    contents: `
      export { CARD_WIDTH, CARD_HEIGHT } from '${join(root, 'src/lib/scan/geometry.ts')}';
      export { ARTWORK_REGION } from '${join(root, 'src/lib/scan/regions.ts')}';
      export { cropImage } from '${join(root, 'src/lib/scan/types.ts')}';
      export { describeArtwork } from '${join(root, 'src/lib/scan/artwork/descriptors.ts')}';
      export { createArtworkMatcher } from '${join(root, 'src/lib/scan/artwork/match.ts')}';
      export { buildNameIndex, matchName } from '${join(root, 'src/lib/scan/matchName.ts')}';
      export {
        buildPrintingIndex,
        lookupPrinting,
        uniqueOracle,
        uniquePrinting,
      } from '${join(root, 'src/lib/scan/printing/index.ts')}';
    `,
    resolveDir: root,
    sourcefile: 'channel-bench-entry.ts',
  },
});
const scan = await import(pathToFileURL(bundle).href);

const now = () =>
  typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();

const percentile = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * (s.length - 1)))];
};
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

const decodePng = buf => {
  const png = PNG.sync.read(buf);
  return {
    data: new Uint8ClampedArray(png.data),
    height: png.height,
    width: png.width,
  };
};

/** Nearest-neighbor resize to phone-normalized card size. */
const resizeCard = (src, tw, th) => {
  if (src.width === tw && src.height === th) return src;
  const out = new Uint8ClampedArray(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / th));
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / tw));
      const si = (sy * src.width + sx) * 4;
      const di = (y * tw + x) * 4;
      out[di] = src.data[si];
      out[di + 1] = src.data[si + 1];
      out[di + 2] = src.data[si + 2];
      out[di + 3] = src.data[si + 3];
    }
  }
  return { data: out, height: th, width: tw };
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

const fetchBytes = async url => {
  const res = await fetch(url, { headers: { 'User-Agent': AGENT, Accept: '*/*' } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
};

const ensurePng = async (scryfallId, imageUrl) => {
  const dest = join(CACHE, `channel-bench-${scryfallId}.png`);
  if (existsSync(dest)) return dest;
  const url =
    imageUrl ??
    `https://cards.scryfall.io/png/front/${scryfallId[0]}/${scryfallId[1]}/${scryfallId}.png`;
  const buf = await fetchBytes(url);
  await writeFile(dest, buf);
  await sleep(80);
  return dest;
};

console.log('loading indexes…');
const tLoad0 = now();
const printingData = JSON.parse(await readFile(printingPath, 'utf8'));
const namesData = JSON.parse(await readFile(namesPath, 'utf8'));
const artRaw = JSON.parse(await readFile(artPath, 'utf8'));
const artData = artRaw.art ?? artRaw;
const printingIndex = scan.buildPrintingIndex(printingData);
const nameIndex = scan.buildNameIndex(namesData);
const artMatcher = scan.createArtworkMatcher(artData);
const loadMs = now() - tLoad0;

console.log(
  `indexes ready in ${loadMs.toFixed(0)} ms · printing ${printingIndex.recordCount} · names ${nameIndex.names.length} · art ${artData.entries?.length ?? 0}`,
);

/** Prefer scryfall ids that exist in the art index (fair art race). */
const artByScryfall = new Map(
  (artData.entries ?? []).map(e => [e.scryfallId, e]),
);
const artByOracle = new Map();
for (const e of artData.entries ?? []) {
  if (!artByOracle.has(e.oracleId)) artByOracle.set(e.oracleId, e);
}

/**
 * Hand-picked diversity seeds (set + collector). Filled from PrintingIndex.
 * Covers eras, layouts, promos, commander, secret lair, foreign-adjacent sets.
 */
const SEEDS = [
  { set: 'lea', number: '232', tag: 'alpha-basic' }, // Island? may fail — we'll resolve
  { set: 'lea', number: '233', tag: 'alpha' },
  { set: 'arn', number: '16', tag: 'arabian' },
  { set: 'leg', number: '232', tag: 'legends' },
  { set: 'ice', number: '54', tag: 'ice-age' },
  { set: 'mir', number: '189', tag: 'mirage' },
  { set: 'tmp', number: '294', tag: 'tempest' },
  { set: 'usg', number: '213', tag: 'urza' },
  { set: 'mmq', number: '213', tag: 'masques' },
  { set: 'inv', number: '102', tag: 'invasion' },
  { set: 'ody', number: '197', tag: 'odyssey' },
  { set: 'ons', number: '200', tag: 'onslaught' },
  { set: 'mrd', number: '160', tag: 'mirrodin' },
  { set: 'chk', number: '250', tag: 'kamigawa' },
  { set: 'rav', number: '249', tag: 'ravnica' },
  { set: 'tsp', number: '259', tag: 'timespiral' },
  { set: 'lrw', number: '248', tag: 'lorwyn' },
  { set: 'ala', number: '158', tag: 'shards' },
  { set: 'zen', number: '220', tag: 'zendikar' },
  { set: 'roe', number: '190', tag: 'leveler' },
  { set: 'm11', number: '1', tag: 'core-set' },
  { set: 'isd', number: '101', tag: 'innistrad' },
  { set: 'rtr', number: '238', tag: 'return-ravnica' },
  { set: 'ktk', number: '239', tag: 'khans' },
  { set: 'bfz', number: '234', tag: 'bfz' },
  { set: 'soi', number: '5', tag: 'shadows' },
  { set: 'kld', number: '221', tag: 'kaladesh' },
  { set: 'akh', number: '249', tag: 'amonkhet' },
  { set: 'xln', number: '234', tag: 'ixalan' },
  { set: 'dom', number: '245', tag: 'dominaria' },
  { set: 'grn', number: '258', tag: 'guilds' },
  { set: 'war', number: '76', tag: 'war' },
  { set: 'eld', number: '333', tag: 'eld-extended' },
  { set: 'thb', number: '336', tag: 'thb-showcase' },
  { set: 'iko', number: '386', tag: 'iko-borderless' },
  { set: 'znr', number: '280', tag: 'znr' },
  { set: 'khm', number: '371', tag: 'khm-showcase' },
  { set: 'stx', number: '375', tag: 'stx' },
  { set: 'afr', number: '066', tag: 'pixie-guide' },
  { set: 'afc', number: '30', tag: 'chaos-dragon' },
  { set: 'mid', number: '1', tag: 'midnight' },
  { set: 'vow', number: '1', tag: 'vow' },
  { set: 'neo', number: '370', tag: 'neo-showcase' },
  { set: 'snc', number: '1', tag: 'snc' },
  { set: 'dmu', number: '1', tag: 'dmu' },
  { set: 'bro', number: '1', tag: 'brothers' },
  { set: 'one', number: '1', tag: 'phyrexia' },
  { set: 'mom', number: '190', tag: 'battle' },
  { set: 'woe', number: '1', tag: 'woe' },
  { set: 'lci', number: '188', tag: 'dfc' },
  { set: 'mkm', number: '1', tag: 'mkm' },
  { set: 'otj', number: '1', tag: 'otj' },
  { set: 'mh2', number: '259', tag: 'saga' },
  { set: 'mh3', number: '241', tag: 'modal-dfc' },
  { set: 'c21', number: '1', tag: 'commander' },
  { set: 'sld', number: '1', tag: 'secret-lair' },
  { set: 'spg', number: '1', tag: 'special-guests' },
  { set: 'p30m', number: '1P', tag: 'promo-30th' },
  { set: 'fin', number: '286', tag: 'adventure' },
  { set: 'tdm', number: '11', tag: 'planeswalker' },
  { set: 'cc2', number: '7', tag: 'sol-ring' },
];

const resolveSeed = seed => {
  const set = seed.set.toLowerCase();
  const nums = [
    seed.number,
    seed.number.replace(/^0+/, '') || '0',
    seed.number.padStart(3, '0'),
  ];
  for (const n of nums) {
    const hit = lookupKey(printingIndex, set, n);
    if (hit?.length) {
      // Prefer English + art coverage
      const ranked = [...hit].sort((a, b) => {
        const artA = artByScryfall.has(a.scryfallId) || artByOracle.has(a.oracleId) ? 0 : 1;
        const artB = artByScryfall.has(b.scryfallId) || artByOracle.has(b.oracleId) ? 0 : 1;
        if (artA !== artB) return artA - artB;
        if (a.lang === 'en' && b.lang !== 'en') return -1;
        if (b.lang === 'en' && a.lang !== 'en') return 1;
        return 0;
      });
      return { ...ranked[0], tag: seed.tag };
    }
  }
  return null;
};

function lookupKey(index, setCode, collectorNumber) {
  const key = `${setCode.toLowerCase()}|${String(collectorNumber).toLowerCase()}`;
  const ids = index.byKey.get(key);
  if (!ids?.length) return null;
  return ids.map(i => index.entries[i]);
}

/** Fill remaining slots with diverse EN printings that have art coverage. */
const pickCorpus = () => {
  const picked = [];
  const seenOracle = new Set();
  const seenSet = new Set();

  for (const seed of SEEDS) {
    if (picked.length >= count) break;
    const e = resolveSeed(seed);
    if (!e) continue;
    if (seenOracle.has(e.oracleId) && seenSet.has(e.setCode)) continue;
    if (!artByScryfall.has(e.scryfallId) && !artByOracle.has(e.oracleId)) continue;
    picked.push(e);
    seenOracle.add(e.oracleId);
    seenSet.add(e.setCode);
  }

  // Top up from random-ish walk across sets with art coverage.
  if (picked.length < count) {
    const bySet = new Map();
    for (const e of printingIndex.entries) {
      if (e.lang !== 'en') continue;
      if (!artByScryfall.has(e.scryfallId) && !artByOracle.has(e.oracleId)) continue;
      if (!bySet.has(e.setCode)) bySet.set(e.setCode, e);
    }
    const sets = [...bySet.keys()].sort();
    // Stride through set list for variety.
    const stride = Math.max(1, Math.floor(sets.length / (count * 2)));
    for (let i = 0; i < sets.length && picked.length < count; i += stride) {
      const e = bySet.get(sets[i]);
      if (!e || seenSet.has(e.setCode) || seenOracle.has(e.oracleId)) continue;
      picked.push({ ...e, tag: `auto-${e.setCode}` });
      seenOracle.add(e.oracleId);
      seenSet.add(e.setCode);
    }
  }

  return picked.slice(0, count);
};

const corpus = pickCorpus();
if (corpus.length < count) {
  console.warn(`only selected ${corpus.length}/${count} printings with art coverage`);
}
console.log(`corpus: ${corpus.length} printings across ${new Set(corpus.map(c => c.setCode)).size} sets`);

// Warm channels once.
{
  const warm = corpus[0];
  scan.matchName(warm.name, nameIndex, { limit: 5 });
  scan.lookupPrinting(printingIndex, {
    foilMarker: null,
    raw: `${warm.setCode} ${warm.collectorNumber}`,
    setCode: warm.setCode.toUpperCase(),
    collectorNumber: warm.collectorNumber,
  });
}

const rows = [];
let downloadFails = 0;

for (let i = 0; i < corpus.length; i++) {
  const card = corpus[i];
  const label = `${card.setCode.toUpperCase()} #${card.collectorNumber} · ${card.name}`;
  process.stdout.write(`[${i + 1}/${corpus.length}] ${label} … `);

  let imagePath;
  try {
    imagePath = await ensurePng(card.scryfallId);
  } catch (err) {
    downloadFails += 1;
    console.log(`DOWNLOAD FAIL (${err instanceof Error ? err.message : err})`);
    rows.push({
      name: card.name,
      setCode: card.setCode,
      collectorNumber: card.collectorNumber,
      scryfallId: card.scryfallId,
      oracleId: card.oracleId,
      tag: card.tag ?? null,
      error: 'download-failed',
    });
    continue;
  }

  const raw = decodePng(await readFile(imagePath));
  const cardImg = resizeCard(raw, scan.CARD_WIDTH, scan.CARD_HEIGHT);

  // --- TITLE (perfect OCR → CardNameIndex) ---
  const tTitle0 = now();
  const titleHits = scan.matchName(card.name, nameIndex, { limit: 5 });
  const titleMs = now() - tTitle0;
  const titleOk =
    titleHits[0]?.name?.toLowerCase() === card.name.toLowerCase() ||
    titleHits[0]?.name?.toLowerCase() === card.name.split(' // ')[0].toLowerCase();

  // --- PRINTING INDEX (perfect footer → local lookup) ---
  const tPrint0 = now();
  const printHit = scan.lookupPrinting(printingIndex, {
    foilMarker: null,
    raw: `${card.setCode} ${card.collectorNumber}`,
    setCode: card.setCode.toUpperCase(),
    collectorNumber: card.collectorNumber,
  });
  const printMs = now() - tPrint0;
  const uniq = printHit
    ? scan.uniquePrinting(printHit) ?? scan.uniqueOracle(printHit)
    : null;
  const printOk =
    Boolean(uniq) &&
    (uniq.scryfallId === card.scryfallId ||
      uniq.oracleId === card.oracleId ||
      uniq.name.toLowerCase() === card.name.toLowerCase());

  // --- ARTWORK (descriptor + global search) ---
  const artCrop = scan.cropImage(cardImg, scan.ARTWORK_REGION);
  const tDesc0 = now();
  const descriptor = scan.describeArtwork(artCrop);
  const descMs = now() - tDesc0;
  const tMatch0 = now();
  const artHits = artMatcher.findCandidates(descriptor, 8);
  const matchMs = now() - tMatch0;
  const artMs = descMs + matchMs;
  const artOk =
    artHits[0]?.oracleId === card.oracleId ||
    artHits[0]?.scryfallId === card.scryfallId ||
    artHits[0]?.name?.toLowerCase() === card.name.toLowerCase() ||
    artHits[0]?.name?.toLowerCase() === card.name.split(' // ')[0].toLowerCase();

  const times = { title: titleMs, printing: printMs, artwork: artMs };
  const winner = Object.entries(times).sort((a, b) => a[1] - b[1])[0][0];

  const row = {
    name: card.name,
    setCode: card.setCode,
    collectorNumber: card.collectorNumber,
    scryfallId: card.scryfallId,
    oracleId: card.oracleId,
    tag: card.tag ?? null,
    image: { width: cardImg.width, height: cardImg.height, path: imagePath },
    title: {
      ms: titleMs,
      ok: Boolean(titleOk),
      top: titleHits[0]?.name ?? null,
      score: titleHits[0]?.score ?? null,
    },
    printing: {
      ms: printMs,
      ok: Boolean(printOk),
      candidates: printHit?.candidates?.length ?? 0,
      top: uniq ? `${uniq.setCode.toUpperCase()} #${uniq.collectorNumber} ${uniq.name}` : null,
    },
    artwork: {
      ms: artMs,
      descriptorMs: descMs,
      matcherMs: matchMs,
      ok: Boolean(artOk),
      top: artHits[0]?.name ?? null,
      score: artHits[0]?.visualScore ?? null,
      rank:
        artHits.findIndex(
          h =>
            h.oracleId === card.oracleId ||
            h.scryfallId === card.scryfallId ||
            h.name.toLowerCase() === card.name.toLowerCase(),
        ) + 1 || null,
    },
    winner,
  };
  rows.push(row);
  console.log(
    `win=${winner}  title ${titleMs.toFixed(2)}ms${titleOk ? '' : '✗'}  print ${printMs.toFixed(2)}ms${printOk ? '' : '✗'}  art ${artMs.toFixed(2)}ms${artOk ? '' : '✗'}`,
  );
}

const okRows = rows.filter(r => !r.error);
const msOf = (channel, pred = () => true) =>
  okRows.filter(pred).map(r => r[channel].ms);

const summarizeChannel = (channel, okKey = 'ok') => {
  const xs = msOf(channel);
  const correct = okRows.filter(r => r[channel][okKey]).length;
  return {
    n: xs.length,
    correct,
    accuracy: xs.length ? correct / xs.length : null,
    meanMs: mean(xs),
    p50Ms: percentile(xs, 50),
    p95Ms: percentile(xs, 95),
    maxMs: xs.length ? Math.max(...xs) : null,
  };
};

const wins = { title: 0, printing: 0, artwork: 0 };
for (const r of okRows) wins[r.winner] += 1;

const titleSum = summarizeChannel('title');
const printSum = summarizeChannel('printing');
const artSum = summarizeChannel('artwork');

const report = {
  generatedAt: new Date().toISOString(),
  assumption:
    'Good-quality Scryfall PNG resized to 744×1039. Title/footer use perfect readings (no OCR latency). Artwork runs full descriptor + global matcher.',
  indexes: {
    printing: {
      path: printingPath,
      entries: printingIndex.recordCount,
      version: printingIndex.version,
    },
    names: { path: namesPath, names: nameIndex.names.length },
    art: {
      path: artPath,
      entries: artData.entries?.length ?? 0,
      version: artData.version,
    },
    loadMs,
  },
  corpus: {
    requested: count,
    ran: okRows.length,
    downloadFails,
    uniqueSets: new Set(okRows.map(r => r.setCode)).size,
  },
  channels: {
    title: titleSum,
    printing: printSum,
    artwork: {
      ...artSum,
      descriptorP50Ms: percentile(
        okRows.map(r => r.artwork.descriptorMs),
        50,
      ),
      matcherP50Ms: percentile(
        okRows.map(r => r.artwork.matcherMs),
        50,
      ),
    },
  },
  race: {
    wins,
    winRate: {
      title: okRows.length ? wins.title / okRows.length : null,
      printing: okRows.length ? wins.printing / okRows.length : null,
      artwork: okRows.length ? wins.artwork / okRows.length : null,
    },
    /** Among cards where all three channels are correct, who is fastest? */
    winsWhenAllCorrect: (() => {
      const all = okRows.filter(r => r.title.ok && r.printing.ok && r.artwork.ok);
      const w = { title: 0, printing: 0, artwork: 0 };
      for (const r of all) w[r.winner] += 1;
      return { n: all.length, wins: w };
    })(),
  },
  planning: {
    fastestChannel:
      [
        ['printing', printSum.p50Ms],
        ['title', titleSum.p50Ms],
        ['artwork', artSum.p50Ms],
      ]
        .filter(([, ms]) => ms != null)
        .sort((a, b) => a[1] - b[1])[0]?.[0] ?? null,
    note:
      'If PrintingIndex p50 ≪ title ≪ artwork and accuracy is high, footer-first is the right default; keep title as oracle confirm and art as fallback/tie-break. Extra recognition methods are only warranted where PrintingIndex or title miss (unusual layouts, unreadable footers, stylized titles).',
  },
  cards: rows,
};

await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2));

const fmt = (n, d = 2) => (n == null ? '—' : Number(n).toFixed(d));
const pct = x => (x == null ? '—' : `${(100 * x).toFixed(1)}%`);

const text = [
  'Lugin channel race — good-quality scan corpus',
  `generated ${report.generatedAt}`,
  '',
  `Indexes: printing ${report.indexes.printing.entries} · names ${report.indexes.names.names} · art ${report.indexes.art.entries} (load ${fmt(loadMs, 0)} ms)`,
  `Corpus: ${report.corpus.ran}/${report.corpus.requested} cards · ${report.corpus.uniqueSets} sets · download fails ${downloadFails}`,
  '',
  'Channel latency (ms) — perfect title/footer text, real artwork descriptors',
  'channel     accuracy   mean    p50     p95     max',
  `title       ${pct(titleSum.accuracy).padStart(8)}  ${fmt(titleSum.meanMs).padStart(6)}  ${fmt(titleSum.p50Ms).padStart(6)}  ${fmt(titleSum.p95Ms).padStart(6)}  ${fmt(titleSum.maxMs).padStart(6)}`,
  `printing    ${pct(printSum.accuracy).padStart(8)}  ${fmt(printSum.meanMs).padStart(6)}  ${fmt(printSum.p50Ms).padStart(6)}  ${fmt(printSum.p95Ms).padStart(6)}  ${fmt(printSum.maxMs).padStart(6)}`,
  `artwork     ${pct(artSum.accuracy).padStart(8)}  ${fmt(artSum.meanMs).padStart(6)}  ${fmt(artSum.p50Ms).padStart(6)}  ${fmt(artSum.p95Ms).padStart(6)}  ${fmt(artSum.maxMs).padStart(6)}`,
  `  art descriptor p50 ${fmt(report.channels.artwork.descriptorP50Ms)} · matcher p50 ${fmt(report.channels.artwork.matcherP50Ms)}`,
  '',
  `Fastest channel wins: title ${wins.title} · printing ${wins.printing} · artwork ${wins.artwork}`,
  `When all three correct (${report.race.winsWhenAllCorrect.n}): title ${report.race.winsWhenAllCorrect.wins.title} · printing ${report.race.winsWhenAllCorrect.wins.printing} · artwork ${report.race.winsWhenAllCorrect.wins.artwork}`,
  '',
  `Planning: fastest p50 = ${report.planning.fastestChannel}`,
  report.planning.note,
  '',
  'Per-card winners:',
  ...okRows.map(
    r =>
      `  ${r.winner.padEnd(9)}  ${r.setCode.toUpperCase().padEnd(5)} #${String(r.collectorNumber).padEnd(6)}  ${r.name}  (t ${fmt(r.title.ms)} / p ${fmt(r.printing.ms)} / a ${fmt(r.artwork.ms)})`,
  ),
].join('\n');

await writeFile(reportTextPath, text);
console.log('\n' + text);
console.log(`\nwrote ${reportPath}`);
console.log(`wrote ${reportTextPath}`);

await rm(bundleDir, { force: true, recursive: true });
