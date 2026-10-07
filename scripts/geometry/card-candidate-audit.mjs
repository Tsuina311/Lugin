#!/usr/bin/env node
/**
 * Candidate-stage audit for the five loose card quads.
 * Human outline is ground truth only. detectCardQuad is not modified.
 *
 *   node scripts/geometry/card-candidate-audit.mjs
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtemp } from 'node:fs/promises';

import { PNG } from 'pngjs';
import * as esbuild from 'esbuild';

import { rootDir, reportsDir, resolveSafeMedia } from '../scanner-benchmark/lib/paths.mjs';
import { FIXTURES_DIR } from './lib/paths.mjs';
import { isCompleteQuad } from './lib/schema.mjs';
import { quadArea, quadCoverage, quadIoU } from './lib/frame-regions/report.mjs';
import { assertImageSpace, quadInImageSpace } from './lib/source-space.mjs';
import { isManualArtBox } from '../scanner-benchmark/embedding/crop-ceiling.mjs';

const GOOD_IOU = 0.8;
const USABLE_IOU = 0.7;
const KEYS = ['tl', 'tr', 'br', 'bl'];

const TARGETS = [
  { slug: 'island-cq', card: 'Island cq-120629', imageId: '.scan-inbox/sessions/phone-20260908/cq-20260908T120629/photo-source.png' },
  { slug: 'wand', card: 'Wand cq-120751', imageId: '.scan-inbox/sessions/phone-20260908/cq-20260908T120751/photo-source.png' },
  { slug: 'livaan', card: 'Livaan cq-120813', imageId: '.scan-inbox/sessions/phone-20260908/cq-20260908T120813/photo-source.png' },
  { slug: 'bulk-up', card: 'Bulk Up', imageId: '.scan-inbox/sessions/geometry-test-20260910-162108/geom-001-source/geom-001-source.png' },
  { slug: 'mudbutton', card: 'Mudbutton Torchrunner', imageId: '.scan-inbox/sessions/geometry-test-20260911-100459/geom-003-source/geom-003-source.png' },
];

const log = msg => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`);
const fmt = (value, digits = 3) => (value == null || Number.isNaN(value) ? '—' : Number(value).toFixed(digits));
const fmtPx = value => (value == null ? '—' : `${value.toFixed(1)} px`);

const band = iou => (iou >= GOOD_IOU ? 'GOOD' : iou >= USABLE_IOU ? 'USABLE' : 'POOR');

/**
 * A usable quad in the accepted list, and a worse final quad, is selection.
 * No usable accepted quad is generation. Tracking is not decided here.
 */
const diagnose = (bestIou, selectedIou) => {
  if (bestIou == null || bestIou < USABLE_IOU) return 'GENERATION_FAILURE';
  if (selectedIou == null || selectedIou < USABLE_IOU || bestIou - selectedIou >= 0.05) return 'SELECTION_FAILURE';
  return 'SELECTION_FAILURE';
};

const verdictOf = rows => {
  const selection = rows.filter(row => row.diagnosis === 'SELECTION_FAILURE').length;
  const generation = rows.filter(row => row.diagnosis === 'GENERATION_FAILURE').length;
  if (selection >= 4) return 'CARD_CANDIDATE_SELECTION_PRIMARY';
  if (generation >= 4) return 'CARD_CANDIDATE_GENERATION_PRIMARY';
  return 'CARD_GEOMETRY_MIXED';
};

const loadScan = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lugin-card-audit-'));
  const bundle = join(dir, 'scan.mjs');
  await esbuild.build({
    alias: { '@': join(rootDir, 'src') },
    bundle: true,
    format: 'esm',
    outfile: bundle,
    platform: 'neutral',
    stdin: {
      contents: `
        export { detectCardQuad } from '${join(rootDir, 'src/lib/scan/detectCard.ts')}';
        export { containsCandidate, detectionsFromDebug } from '${join(rootDir, 'src/lib/scan/detection/multi.ts')}';
      `,
      resolveDir: rootDir,
      sourcefile: 'card-audit-entry.ts',
    },
  });
  return import(pathToFileURL(bundle).href);
};

const loadManuals = async () => {
  const map = new Map();
  for (const name of await readdir(FIXTURES_DIR)) {
    if (!name.endsWith('.json')) continue;
    const fixture = JSON.parse(await readFile(join(FIXTURES_DIR, name), 'utf8'));
    const region = (fixture.cards ?? []).map(card => card.regions?.artBox).find(isManualArtBox);
    if (!region || !fixture.image) continue;
    const card = (fixture.cards ?? []).find(row => row.regions?.artBox === region);
    if (!isCompleteQuad(card?.groundTruthQuad)) continue;
    let metadata = null;
    const metaPath = fixture.provenance?.metadataPaths?.[0];
    if (metaPath) {
      try {
        metadata = JSON.parse(await readFile(join(rootDir, metaPath), 'utf8'));
      } catch {
        metadata = null;
      }
    }
    map.set(fixture.image, {
      cardQuad: card.groundTruthQuad,
      imageWidth: fixture.imageWidth,
      imageHeight: fixture.imageHeight,
      metadata,
      frameFamily: card.frameFamily ?? null,
      tags: [...new Set([...(fixture.tags ?? []), ...(card.tags ?? [])])],
    });
  }
  return map;
};

const fromCorners = corners => ({
  tl: [corners.topLeft.x, corners.topLeft.y],
  tr: [corners.topRight.x, corners.topRight.y],
  br: [corners.bottomRight.x, corners.bottomRight.y],
  bl: [corners.bottomLeft.x, corners.bottomLeft.y],
});

const toCorners = quad => ({
  topLeft: { x: quad.tl[0], y: quad.tl[1] },
  topRight: { x: quad.tr[0], y: quad.tr[1] },
  bottomRight: { x: quad.br[0], y: quad.br[1] },
  bottomLeft: { x: quad.bl[0], y: quad.bl[1] },
});

const pointInQuad = (quad, x, y) => {
  const pts = KEYS.map(key => quad[key]);
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (Math.abs(cross) < 1e-3) continue;
    const next = Math.sign(cross);
    if (sign && next !== sign) return false;
    sign = next;
  }
  return true;
};

const edgeLen = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const aspectOf = quad => {
  const width = (edgeLen(quad.tl, quad.tr) + edgeLen(quad.bl, quad.br)) / 2;
  const height = (edgeLen(quad.tl, quad.bl) + edgeLen(quad.tr, quad.br)) / 2;
  return width / Math.max(height, 1e-6);
};

const cornerErrors = (quad, human) => {
  const width = (edgeLen(human.tl, human.tr) + edgeLen(human.bl, human.br)) / 2;
  return Object.fromEntries(
    KEYS.map(key => {
      const px = Math.hypot(quad[key][0] - human[key][0], quad[key][1] - human[key][1]);
      return [key, { px, cardWidths: width > 1 ? px / width : null }];
    }),
  );
};

const cornerPlace = (quad, human, areaRatio, errors) => {
  const cx = KEYS.reduce((sum, key) => sum + human[key][0], 0) / 4;
  const cy = KEYS.reduce((sum, key) => sum + human[key][1], 0) / 4;
  const humanCenterInQuad = pointInQuad(quad, cx, cy);
  return Object.fromEntries(
    KEYS.map(key => {
      const [x, y] = quad[key];
      if (pointInQuad(human, x, y)) return [key, 'inside card'];
      if ((errors[key].cardWidths ?? 1) <= 0.05) return [key, 'on the card edge'];
      if (humanCenterInQuad && areaRatio > 1.15) return [key, 'outside card, on a larger rectangle'];
      return [key, 'background'];
    }),
  );
};

const scaleImage = (image, maxW) => {
  const scale = Math.min(1, maxW / image.width);
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    const sy = Math.min(image.height - 1, Math.round((y / Math.max(1, h - 1)) * (image.height - 1)));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(image.width - 1, Math.round((x / Math.max(1, w - 1)) * (image.width - 1)));
      const si = (sy * image.width + sx) * 4;
      const di = (y * w + x) * 4;
      png.data[di] = image.data[si];
      png.data[di + 1] = image.data[si + 1];
      png.data[di + 2] = image.data[si + 2];
      png.data[di + 3] = 255;
    }
  }
  return { png, scale: w / image.width };
};

const poly = quad => KEYS.map(key => quad[key].map(value => value.toFixed(1)).join(',')).join(' ');

const esc = value =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

const markdownTable = rows => {
  const head = rows[0];
  return [head, head.map(() => '---'), ...rows.slice(1)].map(row => `| ${row.join(' | ')} |`).join('\n');
};

const main = async () => {
  const manuals = await loadManuals();
  const scan = await loadScan();
  const outDir = join(reportsDir, 'card-candidate-audit-v1');
  mkdirSync(outDir, { recursive: true });
  const rows = [];

  for (const target of TARGETS) {
    const manual = manuals.get(target.imageId);
    if (!manual) throw new Error(`missing recorded card outline for ${target.card}`);
    const decoded = PNG.sync.read(readFileSync(resolveSafeMedia(target.imageId)));
    if (manual.imageWidth != null || manual.imageHeight != null) {
      if (decoded.width !== manual.imageWidth || decoded.height !== manual.imageHeight) {
        throw new Error(
          `${target.card} PNG is ${decoded.width}x${decoded.height} but the fixture records ${manual.imageWidth}x${manual.imageHeight}`,
        );
      }
    } else {
      log(`${target.card} fixture records no image size; the outline must already fit the decoded PNG`);
    }
    const photo = manual.metadata?.photo ?? null;
    const fitted = quadInImageSpace({
      quad: manual.cardQuad,
      imageWidth: decoded.width,
      imageHeight: decoded.height,
      captureWidth: photo?.decodedWidth ?? null,
      captureHeight: photo?.decodedHeight ?? null,
      label: target.card,
    });
    assertImageSpace(fitted.quad, decoded.width, decoded.height, `${target.card} human`);
    const human = fitted.quad;
    const source = { width: decoded.width, height: decoded.height, data: new Uint8ClampedArray(decoded.data) };
    const det = scan.detectCardQuad(source);
    const accepted = det.debug.candidates
      .map((candidate, index) => ({ candidate, index }))
      .filter(row => row.candidate.corners && row.candidate.rejectedBecause.length === 0);
    const ranked = [...accepted].sort((a, b) => b.candidate.score - a.candidate.score || a.index - b.index);
    const rankOf = new Map(ranked.map((row, rank) => [row.index, rank + 1]));
    const measured = accepted.map(row => {
      const quad = fromCorners(row.candidate.corners);
      const iou = quadIoU(quad, human);
      const errors = cornerErrors(quad, human);
      const errVals = KEYS.map(key => errors[key].px);
      const areaRatio = quadArea(quad) / Math.max(quadArea(human), 1e-6);
      return {
        index: row.index,
        method: row.candidate.method,
        score: row.candidate.score,
        rank: rankOf.get(row.index),
        iou,
        band: band(iou),
        meanCorner: errVals.reduce((sum, value) => sum + value, 0) / 4,
        maxCorner: Math.max(...errVals),
        corners: errors,
        places: cornerPlace(quad, human, areaRatio, errors),
        areaRatio,
        aspect: aspectOf(quad),
        quad,
      };
    });
    const best = [...measured].sort((a, b) => b.iou - a.iou || b.score - a.score)[0] ?? null;
    const selected = measured.find(row => row.index === det.debug.selectedIndex) ?? null;
    const maxScore = ranked[0] ? measured.find(row => row.index === ranked[0].index) : null;
    const deduped = scan.detectionsFromDebug(det.debug, decoded.width * decoded.height);
    const bestSurvivesDedupe = best
      ? deduped.some(row => Math.abs(row.score - best.score) < 1e-9 && quadIoU(fromCorners(row.corners), best.quad) > 0.98)
      : false;
    const whereLost = !best || best.iou < USABLE_IOU
      ? 'not in accepted candidates'
      : selected && selected.index === best.index
        ? 'selected'
        : maxScore && maxScore.index !== best.index
          ? 'score-ranking'
          : 'nested-selection';
    const selectedContainsHuman = selected ? quadCoverage(human, selected.quad) : null;
    const humanContainsSelected = selected ? quadCoverage(selected.quad, human) : null;
    const nestedSelected = selected
      ? scan.containsCandidate(toCorners(selected.quad), toCorners(human))
      : null;
    const nestedBest = best && selected
      ? scan.containsCandidate(toCorners(best.quad), toCorners(selected.quad))
      : null;
    const nestedReverse = best && selected
      ? scan.containsCandidate(toCorners(selected.quad), toCorners(best.quad))
      : null;
    const diagnosis = diagnose(best?.iou ?? null, selected?.iou ?? null);
    const preview = scaleImage(source, 520);
    const file = `${target.slug}.png`;
    await writeFile(join(outDir, file), PNG.sync.write(preview.png));
    rows.push({
      ...target,
      tags: manual.tags,
      frameFamily: manual.frameFamily,
      outlineSpace: fitted.space,
      outlineScale: fitted.scale,
      human,
      width: decoded.width,
      height: decoded.height,
      previewScale: preview.scale,
      file,
      generated: det.debug.candidates.length,
      rejectedWithoutQuad: det.debug.candidates.filter(row => !row.corners).length,
      accepted: measured.length,
      deduped: deduped.length,
      bestSurvivesDedupe,
      best,
      selected,
      maxScore,
      whereLost,
      diagnosis,
      tracking: 'TRACKING_NOT_MEASURABLE',
      recognitionCorners: det.recognitionCorners ?? null,
      trackedCorners: det.trackedCorners ?? null,
      rawCorners: det.rawCorners ?? null,
      selectedContainsHuman,
      humanContainsSelected,
      nestedSelected: nestedSelected?.ok ?? false,
      nestedBest: Boolean(nestedBest?.ok || nestedReverse?.ok),
      nestedAreaFraction: nestedBest?.ok ? nestedBest.areaFraction : nestedReverse?.ok ? nestedReverse.areaFraction : null,
      top: measured.sort((a, b) => a.rank - b.rank).slice(0, 5),
      measured,
    });
    log(
      `${target.card} selected ${fmt(selected?.iou)} best ${fmt(best?.iou)} rank ${best?.rank ?? '—'} ${diagnosis} lost ${whereLost}`,
    );
  }

  const verdict = verdictOf(rows);
  await writeFile(join(outDir, 'summary.json'), JSON.stringify({ verdict, rows: rows.map(row => ({ ...row, measured: row.measured.map(({ quad, ...rest }) => rest) })) }, null, 2));
  await writeFile(join(reportsDir, 'card-candidate-audit-v1.md'), renderMarkdown(rows, verdict));
  await writeFile(join(outDir, 'index.html'), renderHtml(rows, verdict));
  log(`${verdict}`);
  log(`wrote ${join(outDir, 'index.html')}`);
};

const renderMarkdown = (rows, verdict) => {
  const lines = [];
  lines.push('# CARD CANDIDATE AUDIT V1');
  lines.push('');
  lines.push('`detectCardQuad` is unchanged. The human card outline is only a ruler. Diagnostic bands are IoU ≥ 0.80 GOOD and ≥ 0.70 USABLE.');
  lines.push('');
  lines.push('On a single still, `detectCardQuad` returns the nested-selection winner as `corners`. It does not set `rawCorners`, `trackedCorners`, or `recognitionCorners`, and it does not run cross-frame continuity. Tracking is `TRACKING_NOT_MEASURABLE` for all five frames.');
  lines.push('');
  lines.push('Accepted candidates are the debug entries that kept a quad. Rejected masks do not keep corners, so a hull dropped by the silhouette gates cannot be scored.');
  lines.push('');
  lines.push('## SUMMARY');
  lines.push('');
  lines.push(markdownTable([
    ['Card', 'Final IoU', 'Best generated IoU', 'Best rank', 'Good candidate existed?', 'Where lost?', 'Diagnosis'],
    ...rows.map(row => [
      row.card,
      fmt(row.selected?.iou),
      fmt(row.best?.iou),
      row.best?.rank ?? '—',
      row.best && row.best.iou >= GOOD_IOU ? `yes GOOD ${fmt(row.best.iou)}` : row.best && row.best.iou >= USABLE_IOU ? `usable ${fmt(row.best.iou)}` : 'no',
      row.whereLost,
      row.diagnosis,
    ]),
  ]));
  lines.push('');
  lines.push(`**${verdict}**`);
  lines.push('');
  const good = rows.filter(row => row.best && row.best.iou >= GOOD_IOU).length;
  const usable = rows.filter(row => row.best && row.best.iou >= USABLE_IOU).length;
  lines.push(`GOOD candidates: ${good}/5. USABLE or better: ${usable}/5. No usable candidate: ${5 - usable}/5.`);
  lines.push('');
  for (const row of rows) {
    lines.push(`## ${row.card}`);
    lines.push('');
    lines.push(`Outline space \`${row.outlineSpace}\` scale ${fmt(row.outlineScale, 4)}. Accepted ${row.accepted} of ${row.generated} debug rows. ${row.rejectedWithoutQuad} rows kept no quad. Dedupe shortlist ${row.deduped}. Best survives dedupe: ${row.bestSurvivesDedupe ? 'yes' : 'no'}. Tags ${row.tags.join(', ') || '—'}.`);
    lines.push('');
    lines.push(`Selected area ratio ${fmt(row.selected?.areaRatio, 2)}. Human area inside selected ${fmt(row.selectedContainsHuman)}. Selected area inside human ${fmt(row.humanContainsSelected)}. Detector nested-sleeve test on selected vs human: ${row.nestedSelected ? 'yes' : 'no'}. Best and selected form a nested pair: ${row.nestedBest ? 'yes' : 'no'}.`);
    lines.push('');
    const table = [[
      'Rank', 'Method', 'Score', 'IoU', 'Band', 'Mean corner', 'Max corner', 'Area ratio', 'Aspect', 'Role',
    ]];
    for (const item of row.top) {
      table.push([
        String(item.rank),
        item.method,
        fmt(item.score),
        fmt(item.iou),
        item.band,
        fmtPx(item.meanCorner),
        fmtPx(item.maxCorner),
        fmt(item.areaRatio, 2),
        fmt(item.aspect),
        item.index === row.selected?.index ? 'selected' : item.index === row.best?.index ? 'best IoU' : '',
      ]);
    }
    lines.push(markdownTable(table));
    lines.push('');
    for (const kind of ['selected', 'best']) {
      const item = row[kind];
      if (!item) continue;
      lines.push(`**${kind}** corners vs human:`);
      lines.push('');
      lines.push(markdownTable([
        ['Corner', 'Error', 'Card widths', 'Where'],
        ...KEYS.map(key => [key.toUpperCase(), fmtPx(item.corners[key].px), fmt(item.corners[key].cardWidths, 3), item.places[key]]),
      ]));
      lines.push('');
    }
  }
  return lines.join('\n');
};

const renderHtml = (rows, verdict) => {
  const colors = ['#ffb020', '#c084fc', '#38bdf8', '#f472b6', '#a3e635'];
  const sections = rows.map(row => {
    const drawn = [];
    row.top.forEach((item, index) => {
      if (item.index === row.best?.index || item.index === row.selected?.index) return;
      drawn.push({ item, color: colors[index % colors.length], name: `#${item.rank}` });
    });
    if (row.best) drawn.push({ item: row.best, color: '#4da3ff', name: `best #${row.best.rank}` });
    if (row.selected && row.selected.index !== row.best?.index) {
      drawn.push({ item: row.selected, color: '#ff4d4d', name: `selected #${row.selected.rank}` });
    }
    const shapes = drawn
      .map(
        ({ item, color, name }) =>
          `<polygon points="${poly(item.quad)}" fill="none" stroke="${color}" stroke-width="4"/><text x="${item.quad.tl[0]}" y="${Math.max(16, item.quad.tl[1] - 8)}" fill="${color}" font-size="28" font-family="sans-serif">${esc(name)} IoU ${fmt(item.iou)} score ${fmt(item.score)} area ${fmt(item.areaRatio, 2)}</text>`,
      )
      .join('');
    return `<section>
      <h2>${esc(row.card)}</h2>
      <p>${esc(row.diagnosis)}. Selected IoU ${fmt(row.selected?.iou)}. Best IoU ${fmt(row.best?.iou)} at score rank ${row.best?.rank ?? '—'}. Lost at ${esc(row.whereLost)}. ${esc(row.tracking)}.</p>
      <div class="frame" style="width:${Math.round(row.width * row.previewScale)}px">
        <img src="${row.file}" alt="">
        <svg viewBox="0 0 ${row.width} ${row.height}">
          <polygon points="${poly(row.best?.quad ?? row.selected.quad)}" fill="none" stroke="none"/>
          ${shapes}
          <polygon points="${poly(row.human)}" fill="none" stroke="#3dd68c" stroke-width="4"/>
          <text x="12" y="36" fill="#3dd68c" font-size="28" font-family="sans-serif">human</text>
        </svg>
      </div>
    </section>`;
  });
  return `<!doctype html><meta charset="utf-8"><title>Card candidate audit</title>
<style>
body{font:14px/1.4 sans-serif;background:#111;color:#eee;margin:24px}
.frame{position:relative;display:inline-block}
.frame img,.frame svg{width:100%;height:auto;display:block}
.frame svg{position:absolute;inset:0}
text{paint-order:stroke;stroke:#000;stroke-width:6px}
</style>
<h1>${esc(verdict)}</h1>
<p>Green = human card. Blue = best IoU accepted candidate. Red = selected quad. Other colors are the next score-ranked candidates. Rank is the detector score order, not IoU order.</p>
${sections.join('')}`;
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
