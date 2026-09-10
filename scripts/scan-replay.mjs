#!/usr/bin/env node
// Host-side Samsung fixture replay. Recorded OCR is the default path.
// Node does not reproduce Android ML Kit.

import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as esbuild from 'esbuild';

import {
  NAMES_PATH,
  STAGE,
  listReplayFixtures,
  loadReplayMeta,
  promoteSelected,
  replayDir,
  resolveFixtureId,
  rootDir,
} from './scan-replay/corpus.mjs';

const flag = name => process.argv.includes(`--${name}`);
const positional = process.argv.slice(2).filter(a => !a.startsWith('--'));

const LAST_PATH = join(rootDir, '.scan-fixtures/replay/last-regression.json');

const loadScan = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lugin-replay-'));
  const bundle = join(dir, 'scan.mjs');
  await esbuild.build({
    alias: { '@': join(rootDir, 'src') },
    bundle: true,
    format: 'esm',
    outfile: bundle,
    platform: 'neutral',
    stdin: {
      contents: `
        export * from '${join(rootDir, 'src/lib/scan/matchName.ts')}';
        export * from '${join(rootDir, 'src/lib/scan/titleDecode.ts')}';
        export * from '${join(rootDir, 'src/lib/scan/geometry.ts')}';
        export * from '${join(rootDir, 'src/lib/scan/ocrInput.ts')}';
        export * from '${join(rootDir, 'src/lib/scan/recognizeCaptured.ts')}';
        export { pngBytesToScanImage } from '${join(rootDir, 'mobile/src/scan/debug/scanImagePng.ts')}';
      `,
      resolveDir: rootDir,
      sourcefile: 'replay-entry.ts',
    },
  });
  return import(pathToFileURL(bundle).href);
};

const loadNameIndex = async scan => {
  if (!existsSync(NAMES_PATH)) {
    throw new Error(`Missing ${NAMES_PATH}. Run yarn scan:index`);
  }
  const data = JSON.parse(await readFile(NAMES_PATH, 'utf8'));
  return scan.buildNameIndex(data);
};

const passFail = (meta, decode) => {
  const identified = decode.decision === 'exact-title' || decode.decision === 'strong-fuzzy';
  const predicted = identified ? decode.matchName : null;
  if (meta.expectedStatus === 'identified') {
    const ok = identified && predicted === meta.expectedName;
    return { identified, ok, predicted };
  }
  const ok = !identified;
  return { identified, ok, predicted };
};

const runRecorded = (scan, index, meta) => {
  const decode = scan.decodeRecordedTitleVariants(meta.recordedOcr ?? [], index);
  const verdict = passFail(meta, decode);
  return { decode, ...verdict };
};

const runHostPixels = async (scan, meta) => {
  const dir = replayDir(meta.fixtureId);
  const pngPath = join(dir, 'source-highres.png');
  const fixturePath = join(dir, 'fixture.json');
  if (!existsSync(pngPath) || !existsSync(fixturePath)) {
    return { ok: false, reason: 'missing source or fixture.json', stage: STAGE.HOST_REPLAYABLE };
  }
  const png = new Uint8Array(await readFile(pngPath));
  const source = scan.pngBytesToScanImage(png);
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const quadPath = join(dir, 'recognition-quad.json');
  const quads = existsSync(quadPath)
    ? JSON.parse(await readFile(quadPath, 'utf8'))
    : fixture.quads;
  const recognition = quads.recognition ?? fixture.quads?.recognition;
  if (!recognition) return { ok: false, reason: 'no recognition quad', stage: STAGE.HOST_REPLAYABLE };
  const warp = scan.warpQuadToCard(source, scan.cornersToQuad(recognition));
  const { image: titleRaw } = scan.extractTitleCrop(warp);
  return {
    ok: true,
    stage: STAGE.HOST_REPLAYABLE,
    hashes: {
      recognitionQuadHash: scan.hashRecognitionQuad(recognition),
      sourceImageHash: scan.hashScanImage(source),
      titleCropHash: scan.hashScanImage(titleRaw),
      warpedCardHash: scan.hashScanImage(warp),
    },
    titleCrop: { height: titleRaw.height, width: titleRaw.width },
    warp: { height: warp.height, width: warp.width },
  };
};

const formatReplay = (meta, recorded, pixels) => {
  const lines = [
    `fixture: ${meta.fixtureId}`,
    `aliases: ${(meta.aliases ?? []).join(', ') || '—'}`,
    `expected: ${meta.expectedName} (${meta.expectedStatus})`,
    `predicted: ${recorded.predicted ?? 'none'}`,
    `status: ${recorded.decode.decision} (${recorded.decode.reason})`,
    `runner-up: ${recorded.decode.variants.find(v => v.topName === recorded.predicted)?.secondName ?? recorded.decode.variants[0]?.secondName ?? 'none'}`,
    `margin: ${recorded.decode.titleMargin ?? 'n/a'}`,
    `consensus: ${recorded.decode.consensusCount}`,
    `pass/fail: ${recorded.ok ? 'PASS' : 'FAIL'}`,
    `recorded OCR decode: ${STAGE.HOST_REPLAYABLE}`,
    `ML Kit: ${STAGE.DEVICE_REQUIRED} (not run)`,
  ];
  recorded.decode.variants.forEach((v, i) => {
    lines.push(`variant ${i + 1} (${v.source}):`);
    lines.push(`  OCR: ${v.ocrText || '(empty)'}`);
    lines.push(`  top: ${v.topName ?? 'none'}  score=${v.topScore ?? 'n/a'}`);
    lines.push(`  #2: ${v.secondName ?? 'none'}  score=${v.secondScore ?? 'n/a'}`);
    lines.push(`  margin: ${v.margin ?? 'n/a'}`);
  });
  if (pixels?.ok) {
    lines.push(`host pixels: ${pixels.warp.width}×${pixels.warp.height} warp, title ${pixels.titleCrop.width}×${pixels.titleCrop.height}`);
    lines.push(`  sourceHash ${pixels.hashes.sourceImageHash}`);
    lines.push(`  titleCropHash ${pixels.hashes.titleCropHash}`);
  } else if (pixels) {
    lines.push(`host pixels: skipped (${pixels.reason})`);
  }
  return lines.join('\n');
};

const runOne = async (scan, index, fixtureId) => {
  const meta = await loadReplayMeta(fixtureId);
  if (!meta) throw new Error(`fixture not in corpus: ${fixtureId}`);
  const recorded = runRecorded(scan, index, meta);
  const pixels = await runHostPixels(scan, meta);
  return { fixtureId, meta, pixels, recorded };
};

if (flag('promote')) {
  const rows = await promoteSelected({ force: flag('force') });
  for (const row of rows) {
    console.log(row.ok ? `promoted ${row.fixtureId}` : `skip ${row.fixtureId}: ${row.reason}`);
  }
  if (!positional.length && !flag('regression')) process.exit(rows.some(r => !r.ok) ? 1 : 0);
}

const scan = await loadScan();
const index = await loadNameIndex(scan);

if (flag('regression') || positional[0] === 'regression') {
  let list = await listReplayFixtures();
  if (!list.length) {
    console.log('No replay corpus. Promoting from inbox…');
    await promoteSelected();
    list = await listReplayFixtures();
  }
  if (!list.length) {
    console.error('No fixtures to regress. Upload a Samsung fixture, then yarn scan:replay --promote');
    process.exit(1);
  }
  const prev = existsSync(LAST_PATH) ? JSON.parse(await readFile(LAST_PATH, 'utf8')) : {};
  const results = [];
  let failed = 0;
  let changed = 0;
  let falsePositive = 0;
  let unexpectedAmbiguous = 0;
  for (const meta of list) {
    const one = await runOne(scan, index, meta.fixtureId);
    results.push(one);
    if (!one.recorded.ok) failed += 1;
    if (meta.expectedStatus === 'ambiguous' && one.recorded.identified) falsePositive += 1;
    if (meta.expectedStatus === 'identified' && !one.recorded.identified) unexpectedAmbiguous += 1;
    const before = prev[meta.fixtureId];
    if (before && before.predicted !== one.recorded.predicted) changed += 1;
    console.log('');
    console.log(formatReplay(one.meta, one.recorded, one.pixels));
  }
  const summary = {
    accuracy: `${list.length - failed}/${list.length}`,
    changed,
    failures: failed,
    falsePositive,
    unexpectedAmbiguous,
    fixtures: Object.fromEntries(
      results.map(r => [
        r.fixtureId,
        {
          decision: r.recorded.decode.decision,
          expected: r.meta.expectedName,
          ok: r.recorded.ok,
          predicted: r.recorded.predicted,
        },
      ]),
    ),
  };
  await mkdirSafe(dirname(LAST_PATH));
  await writeFile(LAST_PATH, `${JSON.stringify(summary.fixtures, null, 2)}\n`);
  console.log('');
  console.log(
    `regression: ${summary.accuracy} pass, ${failed} fail, ${changed} changed vs last run` +
      `, ${falsePositive} false-positive, ${unexpectedAmbiguous} unexpected-ambiguous`,
  );
  process.exit(failed ? 1 : 0);
}

const query = positional[0];
if (!query) {
  console.log(`Usage:
  yarn scan:replay --promote
  yarn scan:replay <fixture-id>
  yarn scan:regression

HOST REPLAYABLE: recorded OCR + warp/title hashes
DEVICE REQUIRED: fresh ML Kit / camera / detector
`);
  process.exit(1);
}

let list = await listReplayFixtures();
if (!list.length) {
  await promoteSelected();
  list = await listReplayFixtures();
}
const id = await resolveFixtureId(query);
if (!id) {
  console.error(`Unknown fixture "${query}". Known:`);
  for (const f of list) console.error(`  ${f.fixtureId}  aliases=${(f.aliases ?? []).join(',')}`);
  process.exit(1);
}
const one = await runOne(scan, index, id);
console.log(formatReplay(one.meta, one.recorded, one.pixels));
process.exit(one.recorded.ok ? 0 : 1);

async function mkdirSafe(dir) {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dir, { recursive: true });
}
