/**
 * Host parity for the development Scanner vNext path.
 * Decision, GBM walk, feature rows, and dual-gallery retrieval.
 * Does not retrain and does not edit frozen expected results.
 *
 *   node scripts/scanner-benchmark/identity/vnext-parity-test.mjs
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

import { PUBLISH_MARGIN } from './agreement.mjs';
import { forward, loadModel } from '../embedding/math.mjs';
import { hydrateModel } from '../ranker/models.mjs';
import { buildFeatureRows, parseMethod } from '../ranker/features.mjs';
import { quadCoverage } from '../../geometry/lib/frame-regions/report.mjs';
import { rootDir } from '../lib/paths.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'lugin-vnext-'));
const bundle = join(dir, 'vnext.mjs');

await esbuild.build({
  bundle: true,
  format: 'esm',
  outfile: bundle,
  platform: 'node',
  stdin: {
    contents: `
      export { decideVNext, VNEXT_PUBLISH_MARGIN } from '${join(rootDir, 'src/lib/scan/vnext/decide.ts')}';
      export { frozenGbm, gbmTreeValues, gbmUtility, selectByUtility, vectorOf, FROZEN_GBM_ID } from '${join(rootDir, 'src/lib/scan/vnext/gbm.ts')}';
      export { buildRankerFeatureRows, parseMethod as parseMethodTs, quadCoverage as quadCoverageTs, termsOfQuad, rankLiveCandidates } from '${join(rootDir, 'src/lib/scan/vnext/features.ts')}';
      export { detectCardQuad } from '${join(rootDir, 'src/lib/scan/detectCard.ts')}';
    `,
    resolveDir: rootDir,
  },
});

const vnext = await import(pathToFileURL(bundle).href);

assert.equal(vnext.VNEXT_PUBLISH_MARGIN, 0.05);
assert.equal(vnext.VNEXT_PUBLISH_MARGIN, PUBLISH_MARGIN);
assert.equal(vnext.FROZEN_GBM_ID, 'gbm-iou-all-2dd2ec36b833');

const top = ids => ids;
const visual = (margin, agreeIds, top5, exact = null) => vnext.decideVNext({
  cleanTop1OracleId: agreeIds[0],
  prototypeTop1OracleId: agreeIds[1],
  prototypeMargin: margin,
  prototypeTop5OracleIds: top5,
  exactUniqueOracleId: exact,
});

const agreed = visual(0.05, ['oracle-a', 'oracle-a'], ['oracle-a', 'oracle-b', 'oracle-c', 'oracle-d', 'oracle-e']);
assert.equal(agreed.source, 'VISUAL_AGREEMENT');
assert.equal(agreed.publish, true);
assert.equal(agreed.oracleId, 'oracle-a');

const rounded = visual(1 - (1 - 0.05), ['oracle-a', 'oracle-a'], ['oracle-a']);
assert.equal(rounded.publish, true);

const recovered = visual(0.04, ['oracle-a', 'oracle-a'], ['oracle-a', 'oracle-b', 'oracle-c', 'oracle-d', 'oracle-e'], 'oracle-c');
assert.equal(recovered.source, 'OCR_EXACT_TOP5_RECOVERY');
assert.equal(recovered.oracleId, 'oracle-c');

const disagreed = visual(0.2, ['oracle-a', 'oracle-b'], ['oracle-b', 'oracle-a', 'oracle-c', 'oracle-d', 'oracle-e'], 'oracle-a');
assert.equal(disagreed.source, 'OCR_EXACT_TOP5_RECOVERY');
assert.equal(disagreed.publish, true);

const rank6 = visual(0.01, ['oracle-a', 'oracle-b'], ['oracle-b', 'oracle-c', 'oracle-d', 'oracle-e', 'oracle-f'], 'oracle-z');
assert.equal(rank6.source, 'WITHHELD');

const fuzzy = visual(0.01, ['oracle-a', 'oracle-b'], ['oracle-b', 'oracle-a', 'oracle-c', 'oracle-d', 'oracle-e'], null);
assert.equal(fuzzy.source, 'WITHHELD');

const multi = visual(0.01, ['oracle-a', 'oracle-b'], top(['oracle-b', 'oracle-a', 'oracle-c', 'oracle-d', 'oracle-e']), null);
assert.equal(multi.source, 'WITHHELD');

const garbage = visual(0.01, ['oracle-a', 'oracle-a'], ['oracle-a', 'oracle-b', 'oracle-c', 'oracle-d', 'oracle-e'], null);
assert.equal(garbage.source, 'WITHHELD');
assert.equal(garbage.publish, false);

const noOcr = visual(0.049, ['oracle-a', 'oracle-a'], ['oracle-a', 'oracle-b', 'oracle-c', 'oracle-d', 'oracle-e'], null);
assert.equal(noOcr.source, 'WITHHELD');

const wrongAgreement = visual(0.2, ['wrong-card', 'wrong-card'], ['wrong-card', 'right-card', 'c', 'd', 'e']);
assert.equal(wrongAgreement.source, 'VISUAL_AGREEMENT');
assert.equal(wrongAgreement.publish, true);
assert.equal(wrongAgreement.oracleId, 'wrong-card');

const visualWins = visual(0.08, ['oracle-a', 'oracle-a'], ['oracle-a', 'oracle-b', 'oracle-c', 'oracle-d', 'oracle-e'], 'oracle-b');
assert.equal(visualWins.source, 'VISUAL_AGREEMENT');
assert.equal(visualWins.oracleId, 'oracle-a');

const quad = (tl, tr, br, bl) => ({ tl, tr, br, bl });
const subject = quad([0, 0], [10, 0], [10, 10], [0, 10]);
const clip = quad([0, 0], [20, 0], [20, 20], [0, 20]);
assert.ok(Math.abs(vnext.quadCoverageTs(subject, clip) - quadCoverage(subject, clip)) < 1e-9);
const partial = quad([5, 5], [15, 5], [15, 15], [5, 15]);
assert.ok(Math.abs(vnext.quadCoverageTs(subject, partial) - quadCoverage(subject, partial)) < 1e-9);

const method = 'luma×3.5';
assert.deepEqual(vnext.parseMethodTs(method), parseMethod(method));
assert.deepEqual(vnext.parseMethodTs('chroma@28'), parseMethod('chroma@28'));

const rows = [
  {
    index: 0,
    method: 'luma×2.5',
    quad: quad([10, 10], [110, 12], [108, 150], [12, 148]),
    detectorScore: 0.8,
    aspectScore: 0.9,
    parallelScore: 0.95,
    areaScore: 0.4,
    centerScore: 0.7,
    aspectRatio: 63 / 88,
    frameFraction: 0.2,
    centerX: 0.4,
    centerY: 0.5,
    parallelRaw: 0.05,
    iou: 0,
    band: 'GOOD',
    structure: {
      frameRegionSuccess: 1,
      artBoxConfidence: 0.8,
      titleArtConfidence: 0.7,
      artTypeConfidence: 0.6,
      innerLeftConfidence: 0.5,
      innerRightConfidence: 0.4,
    },
  },
  {
    index: 4,
    method: 'edge',
    quad: quad([20, 20], [90, 22], [88, 120], [22, 118]),
    detectorScore: 0.6,
    aspectScore: 0.7,
    parallelScore: 0.8,
    areaScore: 0.3,
    centerScore: 0.5,
    aspectRatio: 0.7,
    frameFraction: 0.1,
    centerX: 0.45,
    centerY: 0.48,
    parallelRaw: 0.1,
    iou: 0,
    band: 'POOR',
    structure: null,
  },
];
const nested = { relations: [{ outer: 0, inner: 4 }], inner: 4, outer: 0, selected: 4 };
const hostRows = buildFeatureRows({ rows, width: 400, height: 600, nested });
const portRows = vnext.buildRankerFeatureRows({ rows, width: 400, height: 600, nested });
assert.equal(portRows.length, hostRows.length);
for (let i = 0; i < hostRows.length; i++) {
  for (const name of vnext.frozenGbm.featureNames) {
    const host = hostRows[i].features[name];
    const port = portRows[i].features[name];
    assert.ok(Math.abs(host - port) < 1e-9, `${name} ${host} != ${port}`);
  }
}

const cardQuad = quad([40, 30], [200, 36], [190, 260], [36, 250]);
const terms = vnext.termsOfQuad(cardQuad, 640, 480);
assert.ok(terms);
assert.ok(Math.abs(terms.detectorScore - (terms.aspectScore * 0.4 + terms.parallelScore * 0.25 + terms.areaScore * 0.25 + terms.centerScore * 0.1)) < 1e-12);

const packed = JSON.parse(readFileSync(join(rootDir, 'scanner-benchmark/ranker-registry/challengers/gbm-iou-all-2dd2ec36b833.json'), 'utf8'));
const hostModel = hydrateModel({ ...packed.model, featureNames: packed.featureNames, family: packed.model.family });
const frames = readFileSync(join(rootDir, 'scanner-benchmark/ranker-data/v1/frames.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
const geometry = readFileSync(join(rootDir, 'scanner-benchmark/reports/frozen-recognition-v1/geometry.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
const geometryById = new Map(geometry.map(row => [row.frameId, row]));
let treeChecked = false;
let gbmFrames = 0;
let gbmMismatches = [];
for (const frame of frames) {
  const expected = geometryById.get(frame.id);
  if (!expected || (expected.split !== 'dev' && expected.split !== 'holdout')) continue;
  gbmFrames += 1;
  let best = null;
  for (const candidate of frame.candidates) {
    const vector = vnext.vectorOf(candidate.features, vnext.frozenGbm.featureNames);
    const utility = vnext.gbmUtility(vnext.frozenGbm, vector);
    const hostUtility = hostModel.utility(vector);
    assert.ok(Math.abs(utility - hostUtility) < 1e-9, `${frame.id} utility ${utility} != ${hostUtility}`);
    if (!treeChecked) {
      const leaves = vnext.gbmTreeValues(vnext.frozenGbm, vector);
      assert.equal(leaves.length, packed.model.trees.length);
      const predictNode = (node, row) => {
        if (!node?.left) return node?.value ?? 0;
        return predictNode(row[node.feature] <= node.threshold ? node.left : node.right, row);
      };
      packed.model.trees.forEach((tree, index) => {
        assert.ok(Math.abs(leaves[index] - predictNode(tree, vector)) < 1e-12);
      });
      treeChecked = true;
    }
    const row = { index: candidate.index, utility, detectorScore: candidate.detectorScore };
    if (!best || row.utility > best.utility + 1e-12 || (Math.abs(row.utility - best.utility) <= 1e-12 && row.detectorScore > best.detectorScore)) {
      best = row;
    }
  }
  if (best?.index !== expected.learned.index) {
    gbmMismatches.push({ id: frame.id, got: best?.index, expected: expected.learned.index });
  }
}
assert.equal(gbmMismatches.length, 0, JSON.stringify(gbmMismatches.slice(0, 8)));
assert.ok(gbmFrames > 0);
assert.equal(treeChecked, true);

const replayPolicy = (path) => {
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  const mismatches = [];
  for (const frame of saved.frames) {
    const base = frame.baseline;
    const chal = frame.challenger;
    const id = value => (value == null || value < 0 ? null : String(value));
    const input = {
      cleanTop1OracleId: id(base.cleanTop1),
      prototypeTop1OracleId: id(base.top1),
      prototypeMargin: base.margin,
      prototypeTop5OracleIds: base.top5.map(value => String(value)),
      exactUniqueOracleId: null,
    };
    const visualDecision = vnext.decideVNext(input);
    if (visualDecision.publish !== base.publish || visualDecision.agreement !== base.agreement) {
      mismatches.push({ frameId: frame.frameId, kind: 'visual', visualDecision, base });
    }
    if (base.publish) {
      if (visualDecision.source !== 'VISUAL_AGREEMENT' || !chal.publish) {
        mismatches.push({ frameId: frame.frameId, kind: 'visual-source' });
      }
    } else if (chal.publish) {
      if (!base.top5.includes(chal.top1)) mismatches.push({ frameId: frame.frameId, kind: 'recovery-not-in-top5' });
      const recoveredDecision = vnext.decideVNext({ ...input, exactUniqueOracleId: String(chal.top1) });
      if (recoveredDecision.source !== 'OCR_EXACT_TOP5_RECOVERY' || recoveredDecision.oracleId !== String(chal.top1)) {
        mismatches.push({ frameId: frame.frameId, kind: 'recovery', recoveredDecision });
      }
    } else if (visualDecision.source !== 'WITHHELD') {
      mismatches.push({ frameId: frame.frameId, kind: 'withheld' });
    }
  }
  return { n: saved.frames.length, mismatches };
};

const devReplay = replayPolicy(join(rootDir, 'scanner-benchmark/recognition-registry/autolab/dev-rec-71078c38c736.json'));
const holdoutReplay = replayPolicy(join(rootDir, 'scanner-benchmark/recognition-registry/autolab/holdout-rec-71078c38c736.json'));
assert.equal(devReplay.mismatches.length, 0, JSON.stringify(devReplay.mismatches.slice(0, 4)));
assert.equal(holdoutReplay.mismatches.length, 0, JSON.stringify(holdoutReplay.mismatches.slice(0, 4)));

const floatsFrom = path => {
  const buf = readFileSync(path);
  const copy = new ArrayBuffer(buf.byteLength);
  new Uint8Array(copy).set(buf);
  return new Float32Array(copy);
};

const refs = JSON.parse(readFileSync(join(rootDir, 'scanner-benchmark/identity-registry/candidates/mean-prototype-v1/refs.json'), 'utf8'));
const oracleIndex = new Map();
const oracleOf = new Int32Array(refs.length);
const names = new Array(refs.length);
refs.forEach((ref, art) => {
  let index = oracleIndex.get(ref.oracleId);
  if (index == null) {
    index = oracleIndex.size;
    oracleIndex.set(ref.oracleId, index);
  }
  oracleOf[art] = index;
  names[art] = ref.canonicalName;
});
const clean = floatsFrom(join(rootDir, 'scanner-benchmark/recognition-registry/autolab/adapted/clean.f32'));
const prototype = floatsFrom(join(rootDir, 'scanner-benchmark/identity-registry/candidates/mean-prototype-v1/embeddings.bin'));
assert.equal(clean.length, refs.length * 512);
assert.equal(prototype.length, refs.length * 512);
const adapter = loadModel(JSON.parse(readFileSync(join(rootDir, 'scanner-benchmark/identity-registry/challengers/linear-identity-v1.json'), 'utf8')));

const searchOne = (embeddings, query) => {
  const bestScore = new Float32Array(oracleIndex.size).fill(-2);
  const bestName = new Array(oracleIndex.size);
  const seen = new Uint8Array(oracleIndex.size);
  for (let art = 0; art < refs.length; art++) {
    let score = 0;
    const off = art * 512;
    for (let d = 0; d < 512; d++) score += query[d] * embeddings[off + d];
    const oracle = oracleOf[art];
    if (!seen[oracle] || score > bestScore[oracle]) {
      seen[oracle] = 1;
      bestScore[oracle] = score;
      bestName[oracle] = names[art];
    }
  }
  const ranked = [];
  for (let oracle = 0; oracle < oracleIndex.size; oracle++) {
    if (!seen[oracle]) continue;
    ranked.push({ oracle, score: bestScore[oracle], name: bestName[oracle] });
  }
  ranked.sort((a, b) => b.score - a.score || a.oracle - b.oracle);
  return ranked;
};

const galleryMismatches = [];
let galleryFrames = 0;
for (const row of geometry) {
  if (row.split !== 'dev' && row.split !== 'holdout') continue;
  if (!row.paths?.learned) continue;
  const vectorPath = row.paths.learned.replace(/\.png$/, '.f32');
  let raw;
  try {
    raw = floatsFrom(vectorPath);
  } catch {
    galleryMismatches.push({ frameId: row.frameId, kind: 'missing-vector' });
    continue;
  }
  const query = forward(adapter, raw).y;
  const cleanRanked = searchOne(clean, query);
  const protoRanked = searchOne(prototype, query);
  galleryFrames += 1;
  const savedPath = row.split === 'dev'
    ? join(rootDir, 'scanner-benchmark/recognition-registry/autolab/dev-rec-71078c38c736.json')
    : join(rootDir, 'scanner-benchmark/recognition-registry/autolab/holdout-rec-71078c38c736.json');
  if (!globalThis.__vnextSaved) globalThis.__vnextSaved = new Map();
  if (!globalThis.__vnextSaved.has(savedPath)) {
    const saved = JSON.parse(readFileSync(savedPath, 'utf8'));
    globalThis.__vnextSaved.set(savedPath, new Map(saved.frames.map(frame => [frame.frameId, frame])));
  }
  const frame = globalThis.__vnextSaved.get(savedPath).get(row.frameId);
  if (!frame) {
    galleryMismatches.push({ frameId: row.frameId, kind: 'missing-frozen-frame' });
    continue;
  }
  const base = frame.baseline;
  const protoTop5 = protoRanked.slice(0, 5).map(item => item.oracle);
  const margin = protoRanked[0] && protoRanked[1] ? protoRanked[0].score - protoRanked[1].score : null;
  const agreement = cleanRanked[0]?.oracle === protoRanked[0]?.oracle;
  const sameTop5 = protoTop5.length === base.top5.length && protoTop5.every((oracle, index) => oracle === base.top5[index]);
  if (
    cleanRanked[0]?.oracle !== base.cleanTop1 ||
    protoRanked[0]?.oracle !== base.top1 ||
    !sameTop5 ||
    agreement !== base.agreement ||
    margin == null ||
    Math.abs(margin - base.margin) > 1e-4
  ) {
    galleryMismatches.push({
      frameId: row.frameId,
      clean: cleanRanked[0]?.oracle,
      expectedClean: base.cleanTop1,
      proto: protoRanked[0]?.oracle,
      expectedProto: base.top1,
      top5: protoTop5,
      expectedTop5: base.top5,
      margin,
      expectedMargin: base.margin,
      agreement,
      expectedAgreement: base.agreement,
    });
  }
}

assert.equal(galleryMismatches.length, 0, JSON.stringify(galleryMismatches.slice(0, 3), null, 2));
assert.ok(galleryFrames >= devReplay.n + holdoutReplay.n - 2);

const tiny = {
  feature: 0,
  threshold: 0.5,
  left: { value: -1 },
  right: { value: 2 },
};
const tinyModel = { featureNames: ['x'], family: 'tree', base: 0.5, learningRate: 0.1, trees: [tiny] };
assert.ok(Math.abs(vnext.gbmUtility(tinyModel, [0.5]) - 0.4) < 1e-9);
assert.ok(Math.abs(vnext.gbmUtility(tinyModel, [0.5000001]) - 0.7) < 1e-6);
const tied = vnext.selectByUtility([
  { index: 1, utility: 0.4, detectorScore: 0.2 },
  { index: 2, utility: 0.4, detectorScore: 0.9 },
]);
assert.equal(tied.index, 2);

const liveFrame = frames.find(frame => geometryById.get(frame.id)?.split === 'holdout' && existsSync(join(rootDir, frame.image)));
assert.ok(liveFrame, 'no holdout image for live feature rebuild');
const png = PNG.sync.read(readFileSync(join(rootDir, liveFrame.image)));
const image = { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
const detected = vnext.detectCardQuad(image);
const live = vnext.rankLiveCandidates(image, detected.debug.candidates);
const liveExpected = geometryById.get(liveFrame.id);
assert.equal(
  live.selected?.index,
  liveExpected.learned.index,
  `live GBM ${liveFrame.id} selected ${live.selected?.index} expected ${liveExpected.learned.index}`,
);

await rm(dir, { recursive: true, force: true });
console.log(`vnext parity ok · gbm frames ${gbmFrames} · policy dev ${devReplay.n} holdout ${holdoutReplay.n} · gallery ${galleryFrames} · live ${liveFrame.id}`);
