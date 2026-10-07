/**
 * yarn geometry:frame-regions-test
 * Schema, projection, edit tracking, detector profiles, and report math.
 */

import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import * as esbuild from 'esbuild';

import { acceptArtBox, applyAutoProposals, effectiveFrameFamily, isReviewedArtBox, moveRegionCorner, regionStatus, resetArtBox } from './lib/frame-regions/annotations.mjs';
import { artBoxIssues } from './lib/frame-regions/artbox-quality.mjs';
import { detectFrameRegions, pickPeak } from './lib/frame-regions/detect.mjs';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  applyH,
  canonicalQuadToSource,
  canonicalRect,
  canonicalToSourceH,
  orderRegionQuadInCardSpace,
  regionOrientation,
  RegionQuadError,
  sourceQuadToCanonical,
  sourceToCanonicalH,
} from './lib/frame-regions/project.mjs';
import { collectFrameRecords, median, quadIoU, renderFrameReport, summarizeRecords } from './lib/frame-regions/report.mjs';
import { createCard, createFixture, validateFixture } from './lib/schema.mjs';
import { rootDir } from './lib/paths.mjs';

let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(err);
  }
};

const quad = (x0, y0, x1, y1) => ({
  tl: [x0, y0],
  tr: [x1, y0],
  br: [x1, y1],
  bl: [x0, y1],
});

check('old fixtures stay valid and default frame family to unknown', () => {
  const fixture = createFixture({
    id: 'old',
    image: '.scan-fixtures/replay/x/source.png',
    source: 'replay',
    cards: [
      {
        id: 'card-1',
        groundTruthQuad: quad(1, 2, 30, 40),
        groundTruthSource: 'manually-reviewed',
      },
    ],
  });
  assert.deepEqual(validateFixture(fixture), []);
  assert.equal(effectiveFrameFamily(fixture.cards[0]), 'unknown');
  assert.equal(fixture.cards[0].regions, undefined);
});

check('createCard writes unknown when frame family is omitted', () => {
  const card = createCard({ id: 'card-1', groundTruthSource: 'none' });
  assert.equal(card.frameFamily, 'unknown');
  assert.equal(card.regions, undefined);
});

check('regions are optional and a partial set validates', () => {
  const fixture = createFixture({
    id: 'partial',
    image: 'a.png',
    source: 'replay',
    cards: [
      createCard({
        id: 'card-1',
        groundTruthQuad: quad(0, 0, 10, 20),
        groundTruthSource: 'manually-reviewed',
        frameFamily: 'modern_standard',
        regions: {
          titleBand: { quad: quad(1, 1, 9, 3), source: 'manual' },
        },
      }),
    ],
  });
  assert.deepEqual(validateFixture(fixture), []);
  assert.equal(fixture.cards[0].regions.artBox, undefined);
});

check('invalid region source and frame family are rejected', () => {
  const fixture = createFixture({
    id: 'bad',
    image: 'a.png',
    source: 'replay',
    cards: [
      {
        id: 'card-1',
        groundTruthSource: 'none',
        frameFamily: 'modern',
        regions: { artBox: { quad: quad(0, 0, 1, 1), source: 'guess' } },
      },
    ],
  });
  const errors = validateFixture(fixture);
  assert.ok(errors.some(error => error.includes('frameFamily')));
  assert.ok(errors.some(error => error.includes('source')));
});

check('canonical corners map to the source quad and round-trip', () => {
  const card = {
    tl: [12, 30],
    tr: [410, 18],
    br: [390, 640],
    bl: [28, 610],
  };
  const toSource = canonicalToSourceH(card);
  const back = sourceToCanonicalH(card);
  const canonical = canonicalRect();
  for (const key of ['tl', 'tr', 'br', 'bl']) {
    const src = applyH(toSource, { x: canonical[key][0], y: canonical[key][1] });
    assert.ok(Math.abs(src.x - card[key][0]) < 1e-4, key);
    assert.ok(Math.abs(src.y - card[key][1]) < 1e-4, key);
    const again = applyH(back, src);
    assert.ok(Math.abs(again.x - canonical[key][0]) < 1e-3);
    assert.ok(Math.abs(again.y - canonical[key][1]) < 1e-3);
  }
  const inside = applyH(toSource, { x: 100, y: 200 });
  const returned = applyH(back, inside);
  assert.ok(Math.abs(returned.x - 100) < 1e-3);
  assert.ok(Math.abs(returned.y - 200) < 1e-3);
});

check('moving one corner keeps the other three and marks auto-edited', () => {
  const region = {
    quad: quad(0, 0, 10, 20),
    source: 'auto',
    confidence: 0.8,
  };
  const next = moveRegionCorner(region, 'tr', [12, 1]);
  assert.equal(next.source, 'auto-edited');
  assert.deepEqual(next.quad.tl, [0, 0]);
  assert.deepEqual(next.quad.tr, [12, 1]);
  assert.deepEqual(next.quad.br, [10, 20]);
  assert.deepEqual(next.quad.bl, [0, 20]);
  assert.deepEqual(next.autoQuad, region.quad);
  assert.equal(regionStatus(next), 'auto-edited');
  assert.deepEqual(region.quad.tr, [10, 0]);
});

check('a second edit keeps the original auto quad', () => {
  const once = moveRegionCorner({ quad: quad(0, 0, 10, 20), source: 'auto', confidence: 0.5 }, 'bl', [1, 21]);
  const twice = moveRegionCorner(once, 'bl', [2, 22]);
  assert.equal(twice.source, 'auto-edited');
  assert.deepEqual(twice.autoQuad, quad(0, 0, 10, 20));
  assert.deepEqual(twice.quad.bl, [2, 22]);
  assert.equal(twice.reviewed, false);
});

check('accept keeps the automatic polygon and marks it reviewed', () => {
  const region = { quad: quad(0, 0, 10, 20), source: 'auto', confidence: 0.4, autoQuad: quad(0, 0, 10, 20) };
  const accepted = acceptArtBox(region);
  assert.equal(accepted.source, 'auto-accepted');
  assert.equal(accepted.reviewed, true);
  assert.equal(isReviewedArtBox(accepted), true);
  assert.equal(isReviewedArtBox(region), false);
  const moved = moveRegionCorner(accepted, 'br', [11, 21]);
  assert.equal(moved.source, 'auto-edited');
  assert.equal(moved.reviewed, false);
  assert.deepEqual(moved.autoQuad, quad(0, 0, 10, 20));
  const reset = resetArtBox(moved);
  assert.equal(reset.source, 'auto');
  assert.equal(isReviewedArtBox(reset), false);
});

check('art box warnings do not move the polygon', () => {
  const card = quad(0, 0, 100, 140);
  const art = quad(10, 20, 90, 80);
  assert.deepEqual(artBoxIssues(art, card), []);
  const bowtie = { tl: [0, 0], tr: [100, 100], br: [100, 0], bl: [0, 100] };
  assert.ok(artBoxIssues(bowtie, card).some(issue => issue.includes('crosses')));
  const tiny = quad(0, 0, 2, 2);
  assert.ok(artBoxIssues(tiny, card).some(issue => issue.includes('too small')));
  assert.deepEqual(tiny.tl, [0, 0]);
});

check('a reviewed art box is not replaced by a new automatic proposal', () => {
  const existing = {
    artBox: { quad: quad(0, 1, 1, 2), source: 'auto-accepted', reviewed: true, autoQuad: quad(0, 1, 1, 2) },
  };
  const merged = applyAutoProposals(existing, { artBox: { quad: quad(5, 6, 6, 7), confidence: 0.9 } }, {});
  assert.equal(merged.regions.artBox.source, 'auto-accepted');
  assert.equal(merged.skipped.includes('artBox'), true);
});

check('auto proposals fill gaps and skip manual or edited regions', () => {
  const existing = {
    titleBand: { quad: quad(0, 0, 1, 1), source: 'manual' },
    artBox: { quad: quad(0, 1, 1, 2), source: 'auto', confidence: 0.4, autoQuad: quad(0, 1, 1, 2) },
    typeLine: { quad: quad(0, 2, 1, 3), source: 'auto-edited', autoQuad: quad(0, 2, 1, 3) },
  };
  const proposals = {
    titleBand: { quad: quad(5, 5, 6, 6), confidence: 0.9 },
    artBox: { quad: quad(5, 6, 6, 7), confidence: 0.7 },
    textBox: { quad: quad(5, 7, 6, 8), confidence: 0.6 },
  };
  const merged = applyAutoProposals(existing, proposals, {});
  assert.deepEqual(merged.regions.titleBand.quad, existing.titleBand.quad);
  assert.equal(merged.regions.titleBand.source, 'manual');
  assert.ok(merged.skipped.includes('titleBand'));
  assert.deepEqual(merged.regions.artBox.quad, proposals.artBox.quad);
  assert.equal(merged.regions.artBox.source, 'auto');
  assert.deepEqual(merged.regions.typeLine, existing.typeLine);
  assert.equal(merged.regions.textBox.source, 'auto');
  assert.equal(merged.regions.footer, undefined);
});

check('redetect all replaces manual regions and clears misses', () => {
  const existing = {
    titleBand: { quad: quad(0, 0, 1, 1), source: 'manual' },
    footer: { quad: quad(0, 2, 1, 3), source: 'manual' },
  };
  const merged = applyAutoProposals(existing, { titleBand: { quad: quad(2, 2, 3, 3), confidence: 0.5 } }, { force: true });
  assert.equal(merged.regions.titleBand.source, 'auto');
  assert.deepEqual(merged.regions.titleBand.quad, quad(2, 2, 3, 3));
  assert.equal(merged.regions.footer, undefined);
  assert.ok(merged.cleared.includes('footer'));
});

check('polygon IoU is 1, 0, and one third for the axis-aligned cases', () => {
  assert.ok(Math.abs(quadIoU(quad(0, 0, 10, 10), quad(0, 0, 10, 10)) - 1) < 1e-6);
  assert.ok(quadIoU(quad(0, 0, 10, 10), quad(10, 0, 20, 10)) < 1e-6);
  const half = quadIoU(quad(0, 0, 10, 10), quad(5, 0, 15, 10));
  assert.ok(Math.abs(half - 1 / 3) < 1e-6, half);
});

check('report counts detection, edits, and canonical corner error', () => {
  const cardQuad = canonicalRect();
  const auto = quad(10, 10, 100, 80);
  const final = {
    tl: [14, 10],
    tr: [100, 10],
    br: [100, 80],
    bl: [10, 80],
  };
  const fixtures = [
    createFixture({
      id: 'm',
      image: 'a.png',
      source: 'replay',
      tags: [],
      cards: [
        createCard({
          id: 'card-1',
          groundTruthQuad: cardQuad,
          groundTruthSource: 'manually-reviewed',
          frameFamily: 'modern_standard',
          tags: ['sleeved', 'glare'],
          regions: {
            artBox: { quad: final, source: 'auto-edited', confidence: 0.8, autoQuad: auto },
          },
        }),
        createCard({
          id: 'card-2',
          groundTruthQuad: cardQuad,
          groundTruthSource: 'manually-reviewed',
          frameFamily: 'modern_standard',
          regions: {
            artBox: { quad: auto, source: 'auto', confidence: 0.9, autoQuad: auto },
          },
        }),
        createCard({
          id: 'card-3',
          groundTruthQuad: cardQuad,
          groundTruthSource: 'manually-reviewed',
          frameFamily: 'modern_standard',
          regions: {
            artBox: { quad: quad(1, 1, 4, 4), source: 'manual' },
          },
        }),
      ],
    }),
    createFixture({
      id: 's',
      image: 'b.png',
      source: 'replay',
      tags: ['foil'],
      cards: [
        createCard({
          id: 'card-1',
          groundTruthQuad: cardQuad,
          groundTruthSource: 'manually-reviewed',
          frameFamily: 'showcase',
          regions: {
            titleBand: { quad: quad(1, 1, 2, 2), source: 'manual' },
          },
        }),
      ],
    }),
  ];
  const records = collectFrameRecords(fixtures);
  const summary = summarizeRecords(records);
  const art = summary.families.modern_standard.artBox;
  assert.equal(art.n, 3);
  assert.equal(art.detected, 2);
  assert.equal(art.accepted, 1);
  assert.equal(art.edited, 1);
  assert.equal(art.manualFailed, 1);
  assert.equal(art.medianCornerError, 0.5);
  assert.equal(summary.families.showcase.titleBand.manualFailed, 1);
  assert.equal(summary.tags.sleeved.artBox.n, 1);
  assert.equal(summary.tags.glare.artBox.n, 1);
  assert.equal(summary.tags.foil.titleBand.n, 1);
  const text = renderFrameReport(records, { fixtureCount: 2 });
  assert.match(text, /modern_standard/);
  assert.match(text, /showcase/);
  assert.equal(median([4, 0]), 2);
});

check('the boundary finder prefers a long line inside the window', () => {
  const rows = [];
  for (let i = 0; i <= 100; i++) rows.push({ t: i / 100, energy: 1, continuity: 0.02, sideAgree: 1 });
  rows[20] = { t: 0.2, energy: 80, continuity: 0.04, sideAgree: 0.1 };
  rows[50] = { t: 0.5, energy: 30, continuity: 0.92, sideAgree: 0.9 };
  rows[80] = { t: 0.8, energy: 200, continuity: 0.99, sideAgree: 1 };
  const picked = pickPeak(rows, { prior: 0.48, lo: 0.3, hi: 0.7 });
  assert.equal(picked.detected, true);
  assert.ok(Math.abs(picked.t - 0.5) < 1e-6);
  const flat = pickPeak(
    rows.map(row => ({ ...row, energy: 1, continuity: 0.01 })),
    { prior: 0.5, lo: 0.2, hi: 0.8 },
  );
  assert.equal(flat.detected, false);
});

const paintFrame = (width, height) => {
  const bands = [
    [0, 0.03, 18],
    [0.03, 0.115, 220],
    [0.115, 0.542, 70],
    [0.542, 0.59, 200],
    [0.59, 0.872, 55],
    [0.872, 0.962, 180],
    [0.962, 1.01, 18],
  ];
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const t = y / (height - 1);
    let level = 18;
    for (const [a, b, value] of bands) if (t >= a && t < b) level = value;
    for (let x = 0; x < width; x++) {
      const u = x / (width - 1);
      const luma = u < 0.075 || u > 0.925 ? 18 : level;
      const o = (y * width + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = luma;
      data[o + 3] = 255;
    }
  }
  return { data, width, height };
};

check('a banded card yields the structural regions and a blank card yields none', () => {
  const found = detectFrameRegions(paintFrame(186, 260));
  for (const key of ['titleBand', 'artBox', 'typeLine', 'textBox', 'footer']) {
    assert.ok(found.regions[key], key);
    assert.ok(found.regions[key].confidence > 0.2, key);
    assert.ok(found.regions[key].confidence <= 1, key);
  }
  const art = found.regions.artBox.quad;
  const y0 = art.tl[1] / 259;
  const y1 = art.bl[1] / 259;
  assert.ok(Math.abs(y0 - 0.115) < 0.03, y0);
  assert.ok(Math.abs(y1 - 0.542) < 0.03, y1);
  const blank = new Uint8ClampedArray(80 * 110 * 4);
  for (let i = 0; i < blank.length; i += 4) blank[i] = blank[i + 1] = blank[i + 2] = 40;
  const none = detectFrameRegions({ data: blank, width: 80, height: 110 });
  assert.deepEqual(none.regions, {});
});

const KEYS = ['tl', 'tr', 'br', 'bl'];
const uprightCard = canonicalRect();
const uprightArt = { tl: [120, 220], tr: [620, 220], br: [620, 820], bl: [120, 820] };

const cycle = (quad, steps) => {
  const values = KEYS.map(key => quad[key]);
  const out = {};
  KEYS.forEach((key, index) => {
    out[key] = values[(index + steps) % 4];
  });
  return out;
};

const reverseRing = quad => ({
  tl: quad.tl,
  tr: quad.bl,
  br: quad.br,
  bl: quad.tr,
});

const rot90 = ([x, y]) => [-y, x];
const rot180 = ([x, y]) => [-x, -y];
const mapQuadPts = (quad, fn) => Object.fromEntries(KEYS.map(key => [key, fn(quad[key])]));

const sameQuad = (a, b, eps = 1e-6) => KEYS.every(key => Math.abs(a[key][0] - b[key][0]) <= eps && Math.abs(a[key][1] - b[key][1]) <= eps);

const pointSet = quad => KEYS.map(key => `${quad[key][0]},${quad[key][1]}`).sort();

check('upright region stays TL TR BR BL', () => {
  const ordered = orderRegionQuadInCardSpace({ regionQuadSource: uprightArt, cardQuadSource: uprightCard });
  assert.ok(sameQuad(ordered, uprightArt));
  const pose = regionOrientation({ regionQuadSource: uprightArt, cardQuadSource: uprightCard });
  assert.equal(pose.snapped, 0);
  assert.equal(pose.changed, false);
});

check('starting corner does not change the ordered region', () => {
  for (let step = 1; step < 4; step++) {
    const shifted = cycle(uprightArt, step);
    const ordered = orderRegionQuadInCardSpace({ regionQuadSource: shifted, cardQuadSource: uprightCard });
    assert.ok(sameQuad(ordered, uprightArt));
    assert.deepEqual(pointSet(ordered), pointSet(shifted));
  }
});

check('reverse winding orders to TL TR BR BL without mirroring', () => {
  const reversed = reverseRing(uprightArt);
  const ordered = orderRegionQuadInCardSpace({ regionQuadSource: reversed, cardQuadSource: uprightCard });
  assert.ok(sameQuad(ordered, uprightArt));
  const canonical = sourceQuadToCanonical(ordered, uprightCard);
  const area = KEYS.reduce((sum, key, index) => {
    const a = canonical[key];
    const b = canonical[KEYS[(index + 1) % 4]];
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0);
  assert.ok(area > 0);
  assert.ok(canonical.tl[0] < canonical.tr[0]);
  assert.ok(canonical.tl[1] < canonical.bl[1]);
  const pose = regionOrientation({ regionQuadSource: reversed, cardQuadSource: uprightCard });
  assert.equal(pose.kind, 'mirror');
});

check('90° and 180° source rotation keeps the physical art upright', () => {
  for (const turn of [rot90, rot180]) {
    const card = mapQuadPts(uprightCard, turn);
    const art = mapQuadPts(uprightArt, turn);
    assert.ok(sameQuad(orderRegionQuadInCardSpace({ regionQuadSource: art, cardQuadSource: card }), art));
    for (let step = 1; step < 4; step++) {
      const ordered = orderRegionQuadInCardSpace({ regionQuadSource: cycle(art, step), cardQuadSource: card });
      assert.ok(sameQuad(ordered, art));
    }
    const pose = regionOrientation({ regionQuadSource: cycle(art, 1), cardQuadSource: card });
    assert.equal(pose.kind, 'rotation');
    assert.equal(pose.snapped, 90);
  }
});

check('perspective card still orders the art to the physical top', () => {
  const card = { tl: [30, 40], tr: [520, 10], br: [560, 780], bl: [10, 700] };
  const inner = { tl: [80, 180], tr: [640, 180], br: [640, 760], bl: [80, 760] };
  const source = canonicalQuadToSource(inner, card);
  for (let step = 0; step < 4; step++) {
    const ordered = orderRegionQuadInCardSpace({ regionQuadSource: cycle(source, step), cardQuadSource: card });
    const back = sourceQuadToCanonical(ordered, card);
    assert.ok(sameQuad(back, inner, 0.5), `step ${step}`);
  }
  const round = canonicalQuadToSource(sourceQuadToCanonical(source, card), card);
  assert.ok(sameQuad(round, source, 0.5));
});

check('self-crossed and mirrored invalid quads are rejected', () => {
  const inside = { tl: [0, 0], tr: [10, 0], br: [10, 10], bl: [9, 1] };
  assert.throws(
    () => orderRegionQuadInCardSpace({ regionQuadSource: inside, cardQuadSource: uprightCard }),
    RegionQuadError,
  );
  const duplicate = { tl: [0, 0], tr: [0, 0], br: [10, 0], bl: [0, 10] };
  assert.throws(
    () => orderRegionQuadInCardSpace({ regionQuadSource: duplicate, cardQuadSource: uprightCard }),
    /duplicate/,
  );
  assert.throws(
    () => orderRegionQuadInCardSpace({ regionQuadSource: { tl: [NaN, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] }, cardQuadSource: uprightCard }),
    /finite/,
  );
});

const geometryConstants = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lugin-frame-'));
  const outfile = join(dir, 'geom.mjs');
  await esbuild.build({
    bundle: true,
    format: 'esm',
    outfile,
    platform: 'node',
    stdin: {
      contents: `export { CARD_WIDTH, CARD_HEIGHT, warpQuadToCard } from '${join(rootDir, 'src/lib/scan/geometry.ts')}';`,
      resolveDir: rootDir,
      sourcefile: 'geom-entry.ts',
      loader: 'ts',
    },
  });
  const mod = await import(pathToFileURL(outfile).href);
  await rm(dir, { recursive: true, force: true });
  return mod;
};

const scan = await geometryConstants();
check('canonical size matches warpQuadToCard', () => {
  assert.equal(CARD_WIDTH, scan.CARD_WIDTH);
  assert.equal(CARD_HEIGHT, scan.CARD_HEIGHT);
  assert.equal(CARD_HEIGHT, 1039);
});

const GLYPHS = {
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  G: ['01111', '10000', '10000', '10011', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
};

const paintGlyphs = (image, word, x, y, color) => {
  let cursor = x;
  for (const char of word) {
    const rows = GLYPHS[char];
    rows.forEach((row, dy) => {
      [...row].forEach((bit, dx) => {
        if (bit !== '1') return;
        const px = cursor + dx;
        const py = y + dy;
        if (px < 0 || py < 0 || px >= image.width || py >= image.height) return;
        const i = (py * image.width + px) * 4;
        image.data[i] = color[0];
        image.data[i + 1] = color[1];
        image.data[i + 2] = color[2];
        image.data[i + 3] = 255;
      });
    });
    cursor += 7;
  }
};

const fillRect = (image, x0, y0, x1, y1, color) => {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * image.width + x) * 4;
      image.data[i] = color[0];
      image.data[i + 1] = color[1];
      image.data[i + 2] = color[2];
      image.data[i + 3] = 255;
    }
  }
};

const rotate90 = image => {
  const width = image.height;
  const height = image.width;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const nx = image.height - 1 - y;
      const ny = x;
      const src = (y * image.width + x) * 4;
      const dst = (ny * width + nx) * 4;
      data[dst] = image.data[src];
      data[dst + 1] = image.data[src + 1];
      data[dst + 2] = image.data[src + 2];
      data[dst + 3] = image.data[src + 3];
    }
  }
  return { width, height, data };
};

const meanChannel = (image, x0, y0, x1, y1) => {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * image.width + x) * 4;
      r += image.data[i];
      g += image.data[i + 1];
      b += image.data[i + 2];
      n += 1;
    }
  }
  return [r / n, g / n, b / n];
};

const labeledCard = () => {
  const width = CARD_WIDTH;
  const height = CARD_HEIGHT;
  const image = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  fillRect(image, 0, 0, width, height, [20, 20, 24]);
  const art = uprightArt;
  fillRect(image, art.tl[0], art.tl[1], art.br[0], art.tl[1] + 48, [210, 40, 40]);
  fillRect(image, art.tl[0], art.br[1] - 48, art.br[0], art.br[1], [40, 40, 210]);
  fillRect(image, art.tl[0], art.tl[1] + 48, art.tl[0] + 48, art.br[1] - 48, [40, 170, 40]);
  fillRect(image, art.br[0] - 48, art.tl[1] + 48, art.br[0], art.br[1] - 48, [210, 190, 40]);
  paintGlyphs(image, 'TOP', art.tl[0] + 180, art.tl[1] + 16, [255, 255, 255]);
  paintGlyphs(image, 'BOTTOM', art.tl[0] + 160, art.br[1] - 32, [255, 255, 255]);
  paintGlyphs(image, 'LEFT', art.tl[0] + 8, art.tl[1] + 250, [255, 255, 255]);
  paintGlyphs(image, 'RIGHT', art.br[0] - 44, art.tl[1] + 250, [255, 255, 255]);
  return image;
};

const uprightSide = (image, side) => {
  if (side === 'top') return meanChannel(image, 90, 1, 140, 6);
  if (side === 'bottom') return meanChannel(image, 90, image.height - 7, 140, image.height - 1);
  if (side === 'left') return meanChannel(image, 1, 70, 6, 100);
  return meanChannel(image, image.width - 7, 70, image.width - 1, 100);
};

const assertUpright = (image, label) => {
  const top = uprightSide(image, 'top');
  const bottom = uprightSide(image, 'bottom');
  const left = uprightSide(image, 'left');
  const right = uprightSide(image, 'right');
  assert.ok(top[0] > top[1] + 40 && top[0] > top[2] + 40, `${label} top ${top}`);
  assert.ok(bottom[2] > bottom[0] + 40 && bottom[2] > bottom[1] + 40, `${label} bottom ${bottom}`);
  assert.ok(left[1] > left[0] + 40 && left[1] > left[2] + 40, `${label} left ${left}`);
  assert.ok(right[0] > 140 && right[1] > 120 && right[2] < 80, `${label} right ${right}`);
};

let picture = labeledCard();
let card = uprightCard;
let art = uprightArt;
for (let turn = 0; turn < 4; turn++) {
  for (let step = 0; step < 4; step++) {
    for (const winding of ['forward', 'reverse']) {
      const raw = winding === 'reverse' ? reverseRing(cycle(art, step)) : cycle(art, step);
      const ordered = orderRegionQuadInCardSpace({ regionQuadSource: raw, cardQuadSource: card });
      const quad = KEYS.map(key => ({ x: ordered[key][0], y: ordered[key][1] }));
      const warped = scan.warpQuadToCard(picture, quad, 160, 112);
      assertUpright(warped, `turn ${turn * 90} step ${step} ${winding}`);
    }
  }
  const spin = ([x, y]) => [picture.height - 1 - y, x];
  card = mapQuadPts(card, spin);
  art = mapQuadPts(art, spin);
  picture = rotate90(picture);
}
console.log('ok  labeled art warp stays upright for every point order and source rotation');

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log('frame region tests passed');
