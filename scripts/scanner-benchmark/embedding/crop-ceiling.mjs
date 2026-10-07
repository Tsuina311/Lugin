/**
 * Pure helpers for the B1 art-crop ceiling.
 * The phone frames are an evaluation set. Nothing here trains.
 */

export const WRONG_CONFIDENT_MARGIN = 0.05;
export const FAILURE_CLASSES = [
  'BAD_CARD_QUAD',
  'BAD_ART_CROP',
  'MOTION_OR_FOCUS',
  'GLARE_OR_FOIL',
  'GALLERY_OR_PRINTING_MISMATCH',
  'VISUALLY_SIMILAR_ART',
  'CLIP_REPRESENTATION_FAILURE',
  'UNKNOWN',
];

export const namedQuadToPoints = quad => [
  { x: quad.tl[0], y: quad.tl[1] },
  { x: quad.tr[0], y: quad.tr[1] },
  { x: quad.br[0], y: quad.br[1] },
  { x: quad.bl[0], y: quad.bl[1] },
];

/** Human-reviewed final polygon. An untouched auto proposal is not ground truth. */
export const isManualArtBox = region => {
  if (!region?.quad || region.reviewed === false) return false;
  if (region.source === 'manual' || region.source === 'auto-edited') return true;
  if (region.source === 'auto-accepted') return region.reviewed === true;
  return false;
};

/**
 * Rectify an art polygon with the production card warp, into the current crop's
 * exact pixel size, so CLIP's resize sees the same canvas for every source.
 */
export const rectifyArtQuad = (warpQuadToCard, image, quad, outW, outH) => {
  if (!outW || !outH) throw new Error('rectify requires the current crop size');
  const out = warpQuadToCard(image, quad, outW, outH);
  if (out.width !== outW || out.height !== outH) {
    throw new Error(`rectify size ${out.width}x${out.height} != ${outW}x${outH}`);
  }
  return out;
};

/** Same PNG encoder for every crop. Passing the crop width disables the 120px thumbnail path. */
export const encodeArtCrop = (scanImageToPngBytes, image) => {
  if (!image?.width || !image?.height) throw new Error('missing art crop');
  return scanImageToPngBytes(image, image.width);
};

export const assertSameCropCanvas = variants => {
  const current = variants.current;
  if (!current?.width || !current?.height) throw new Error('current crop missing');
  for (const key of ['auto_anchor', 'manual_gt']) {
    const crop = variants[key];
    if (!crop) continue;
    if (crop.width !== current.width || crop.height !== current.height) {
      throw new Error(`${key} canvas ${crop.width}x${crop.height} != current ${current.width}x${current.height}`);
    }
  }
  return true;
};

/**
 * Build the three crops. Auto and manual are omitted, not replaced, when absent.
 * Both rectified crops are sampled from the original phone frame.
 */
export const buildCropVariants = ({ warpQuadToCard, currentCrop, source, autoQuad, manualQuad }) => {
  const variants = { current: currentCrop, auto_anchor: null, manual_gt: null };
  const outW = currentCrop.width;
  const outH = currentCrop.height;
  if (autoQuad) variants.auto_anchor = rectifyArtQuad(warpQuadToCard, source, autoQuad, outW, outH);
  if (manualQuad) variants.manual_gt = rectifyArtQuad(warpQuadToCard, source, manualQuad, outW, outH);
  assertSameCropCanvas(variants);
  return variants;
};

export const rankInGallery = (embeddings, refs, dims, query, matches) => {
  const count = refs.length;
  const best = new Map();
  for (let i = 0; i < count; i++) {
    const offset = i * dims;
    let dot = 0;
    for (let d = 0; d < dims; d++) dot += query[d] * embeddings[offset + d];
    const ref = refs[i];
    const prev = best.get(ref.oracleId);
    if (!prev || dot > prev.score) {
      best.set(ref.oracleId, { name: ref.canonicalName, oracleId: ref.oracleId, score: dot });
    }
  }
  const ranked = [...best.values()].sort((a, b) => b.score - a.score);
  const rankIdx = ranked.findIndex(hit => matches(hit));
  const top1 = ranked[0] ?? null;
  const top2 = ranked[1] ?? null;
  const margin = top1 && top2 ? top1.score - top2.score : null;
  const expected = rankIdx >= 0 ? ranked[rankIdx] : null;
  return {
    top1: rankIdx === 0,
    top3: rankIdx >= 0 && rankIdx < 3,
    top5: rankIdx >= 0 && rankIdx < 5,
    top10: rankIdx >= 0 && rankIdx < 10,
    rank: rankIdx >= 0 ? rankIdx + 1 : null,
    top1Name: top1?.name ?? null,
    top1Score: top1?.score ?? null,
    top2Score: top2?.score ?? null,
    expectedScore: expected?.score ?? null,
    margin,
    wrongConfident: Boolean(top1) && rankIdx !== 0 && margin != null && margin >= WRONG_CONFIDENT_MARGIN,
  };
};

export const emptyMiss = reason => ({
  available: false,
  failed: true,
  reason,
  top1: false,
  top3: false,
  top5: false,
  top10: false,
  rank: null,
  top1Name: null,
  top1Score: null,
  top2Score: null,
  expectedScore: null,
  margin: null,
  wrongConfident: false,
});

export const summarizeCrop = rows => {
  const n = rows.length;
  const count = key => rows.filter(row => row[key]).length;
  return { n, top1: count('top1'), top3: count('top3'), top5: count('top5'), top10: count('top10'), wrongConfident: count('wrongConfident') };
};

/** Auto failures stay in the denominator. They are misses, not dropped frames. */
export const autoRowsForSummary = frames =>
  frames.map(frame => (frame.auto_anchor?.available === false ? { ...emptyMiss(frame.auto_anchor.reason), top1: false } : frame.auto_anchor));

export const pairedNames = (left, right, names) => {
  const out = { wrongToCorrect: [], correctToWrong: [], unchangedCorrect: [], unchangedWrong: [] };
  if (left.length !== right.length || left.length !== names.length) throw new Error('paired names require the same frames');
  for (let i = 0; i < left.length; i++) {
    const a = Boolean(left[i]?.top1);
    const b = Boolean(right[i]?.top1);
    const bucket = !a && b ? 'wrongToCorrect' : a && !b ? 'correctToWrong' : a && b ? 'unchangedCorrect' : 'unchangedWrong';
    out[bucket].push(names[i]);
  }
  return out;
};

const medianOf = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const percentileOf = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
};

/** Detector auto polygon versus the human art box. Coverage uses the live auto crop, not the saved proposal. */
export const summarizeArtGeometry = frames => {
  const reviewed = frames.filter(frame => frame.artReview);
  const ious = reviewed.map(frame => frame.artGeometry?.iou).filter(value => value != null && Number.isFinite(value));
  const corners = reviewed.map(frame => frame.artGeometry?.meanCornerError).filter(value => value != null && Number.isFinite(value));
  const misses = frames.filter(frame => frame.auto_anchor?.available === false);
  const allCorners = reviewed.flatMap(frame => frame.artGeometry?.corners ?? []);
  const close = reviewed.filter(frame => (frame.artGeometry?.iou ?? 0) >= 0.9);
  const material = reviewed.filter(frame => frame.artGeometry?.iou == null || frame.artGeometry.iou < 0.75);
  return {
    n: frames.length,
    reviewed: reviewed.length,
    autoDetected: frames.length - misses.length,
    autoMisses: misses.map(frame => ({ imageId: frame.imageId, cardName: frame.cardName })),
    medianIou: medianOf(ious),
    p10Iou: percentileOf(ious, 10),
    p25Iou: percentileOf(ious, 25),
    medianCornerError: medianOf(corners),
    p90CornerError: percentileOf(allCorners.length ? allCorners : corners, 90),
    unchangedByIou: close.length,
    materialDiff: material.length,
    accepted: reviewed.filter(frame => frame.artReview.source === 'auto-accepted').length,
    edited: reviewed.filter(frame => frame.artReview.source === 'auto-edited').length,
    manual: reviewed.filter(frame => frame.artReview.source === 'manual').length,
  };
};

/** Whether auto-vs-human IoU lines up with whether the two crops pick the same card. */
export const iouRecognitionSplit = frames => {
  const rows = frames.filter(frame => Number.isFinite(frame.artGeometry?.iou) && frame.manual_gt?.available && frame.auto_anchor?.available);
  const high = rows.filter(frame => frame.artGeometry.iou >= 0.85);
  const low = rows.filter(frame => frame.artGeometry.iou < 0.85);
  const agree = group => group.filter(frame => Boolean(frame.auto_anchor.top1) === Boolean(frame.manual_gt.top1) && frame.auto_anchor.top1Name === frame.manual_gt.top1Name).length;
  return {
    n: rows.length,
    highN: high.length,
    lowN: low.length,
    highAgree: agree(high),
    lowAgree: agree(low),
    medianIouWhenAgree: medianOf(rows.filter(frame => frame.auto_anchor.top1Name === frame.manual_gt.top1Name).map(frame => frame.artGeometry.iou)),
    medianIouWhenDisagree: medianOf(rows.filter(frame => frame.auto_anchor.top1Name !== frame.manual_gt.top1Name).map(frame => frame.artGeometry.iou)),
  };
};

export const autoAnchorVerdict = summary => {
  if (!summary || summary.reviewed < summary.n || !summary.n) {
    return {
      verdict: 'AUTO_ANCHOR_UNMEASURED',
      why: 'Automatic-anchor quality against human art boxes is not measured until every frame is reviewed.',
    };
  }
  const coverage = summary.autoDetected / summary.n;
  const iou = summary.medianIou ?? 0;
  const detail = `Coverage ${summary.autoDetected}/${summary.n}, median IoU ${iou.toFixed(3)}, IoU≥0.9 ${summary.unchangedByIou ?? 0}, IoU<0.75 or missed ${summary.materialDiff ?? 0}.`;
  if (coverage >= 0.9 && iou >= 0.85 && (summary.materialDiff ?? summary.n) <= summary.n * 0.15) {
    return { verdict: 'AUTO_ANCHOR_STRONG', why: detail };
  }
  if (coverage < 0.75 || iou < 0.6) return { verdict: 'AUTO_ANCHOR_WEAK', why: detail };
  return { verdict: 'AUTO_ANCHOR_PROMISING', why: detail };
};

export const pairedTransitions = (left, right) => {
  const out = { n: left.length, wrongToCorrect: 0, correctToWrong: 0, unchangedCorrect: 0, unchangedWrong: 0 };
  if (left.length !== right.length) throw new Error('paired transitions require the same frames');
  for (let i = 0; i < left.length; i++) {
    const a = Boolean(left[i]?.top1);
    const b = Boolean(right[i]?.top1);
    if (!a && b) out.wrongToCorrect += 1;
    else if (a && !b) out.correctToWrong += 1;
    else if (a && b) out.unchangedCorrect += 1;
    else out.unchangedWrong += 1;
  }
  return out;
};

/**
 * Class only from demonstrated evidence.
 * A manual art box that fixes a miss is a bad crop. A missing card quad is a bad card quad.
 * Anything else stays UNKNOWN.
 */
export const classifyFailure = frame => {
  if (frame.current?.top1) return null;
  if (!frame.detected) return 'BAD_CARD_QUAD';
  if (frame.manual_gt?.available && frame.manual_gt.top1) return 'BAD_ART_CROP';
  if (!frame.manual_gt?.available) return 'UNKNOWN';
  const tags = new Set((frame.tags ?? []).map(tag => String(tag).toLowerCase()));
  if (tags.has('glare') || tags.has('foil')) return 'GLARE_OR_FOIL';
  if (tags.has('bad-capture') || tags.has('focus')) return 'MOTION_OR_FOCUS';
  return 'UNKNOWN';
};

export const failureRows = frames =>
  frames
    .filter(frame => !frame.current?.top1)
    .map(frame => ({
      imageId: frame.imageId,
      expected: frame.cardName,
      top1Prediction: frame.current?.top1Name ?? null,
      expectedRank: frame.current?.rank ?? null,
      autoRank: frame.auto_anchor?.available ? frame.auto_anchor.rank : null,
      manualRank: frame.manual_gt?.available ? frame.manual_gt.rank : null,
      manualTop1: frame.manual_gt?.top1Name ?? null,
      fixed: Boolean(frame.manual_gt?.available && frame.manual_gt.top1),
      top1Score: frame.current?.top1Score ?? null,
      expectedScore: frame.current?.expectedScore ?? null,
      margin: frame.current?.margin ?? null,
      cropSource: 'current',
      failureClass: classifyFailure(frame),
      notes: frame.notes ?? '',
    }));

export const ceilingVerdict = ({ currentTop1, manualTop1, manualN, n }) => {
  if (manualN < n) {
    return {
      verdict: 'MANUAL_GT_INCOMPLETE',
      why: `Human art boxes cover ${manualN}/${n} frames. The geometry ceiling is not measured, so none of the three bottleneck labels applies.`,
    };
  }
  const gain = manualTop1 - currentTop1;
  if (gain >= 4) {
    return {
      verdict: 'GEOMETRY_BOTTLENECK_CONFIRMED',
      why: `Manual art geometry moved Top1 from ${currentTop1}/${n} to ${manualTop1}/${n}.`,
    };
  }
  if (gain <= 1) {
    return {
      verdict: 'REPRESENTATION_BOTTLENECK_DOMINANT',
      why: `Manual art geometry moved Top1 from ${currentTop1}/${n} to ${manualTop1}/${n}.`,
    };
  }
  return {
    verdict: 'MIXED',
    why: `Manual art geometry moved Top1 from ${currentTop1}/${n} to ${manualTop1}/${n}.`,
  };
};

export const assertNoEvalLeak = (evalPaths, trainingPaths) => {
  const banned = new Set(evalPaths);
  const leaked = [];
  for (const path of trainingPaths) {
    if (banned.has(path)) leaked.push(path);
    for (const evalPath of banned) {
      if (path.includes(evalPath)) leaked.push(path);
    }
  }
  if (leaked.length) throw new Error(`eval frame leaked into training inputs: ${leaked[0]}`);
  return true;
};

export const loadAdaptedGallery = (readFileSync, dir) => {
  const metadata = JSON.parse(readFileSync(`${dir}/metadata.json`, 'utf8'));
  const refs = JSON.parse(readFileSync(`${dir}/refs.json`, 'utf8'));
  const buf = readFileSync(`${dir}/embeddings.bin`);
  const copy = new ArrayBuffer(buf.byteLength);
  new Uint8Array(copy).set(buf);
  const embeddings = new Float32Array(copy);
  if (embeddings.length !== metadata.count * metadata.dims) {
    throw new Error(`adapted gallery length ${embeddings.length} != ${metadata.count} x ${metadata.dims}`);
  }
  if (refs.length !== metadata.count) throw new Error('adapted gallery refs do not match count');
  return { metadata, refs, embeddings, dims: metadata.dims, count: metadata.count };
};

const esc = value =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');

export const ceilingHtml = report => {
  const cards = (report.frames ?? [])
    .map(frame => {
      const img = (src, label) =>
        src
          ? `<figure><img src="${esc(src)}" alt="${esc(label)}"/><figcaption>${esc(label)}</figcaption></figure>`
          : `<figure><div class="missing">${esc(label)} missing</div></figure>`;
      return `<section>
        <h2>${esc(frame.cardName)}</h2>
        <p>current rank ${esc(frame.current?.rank ?? '—')} · top1 ${esc(frame.current?.top1Name ?? 'none')} · auto ${esc(frame.auto_anchor?.available === false ? frame.auto_anchor.reason : frame.auto_anchor?.rank ?? '—')} · manual ${esc(frame.manual_gt?.available === false ? 'not annotated' : frame.manual_gt?.rank ?? '—')}</p>
        <div class="row">
          ${img(frame.images?.source, 'source')}
          ${img(frame.images?.current, 'current')}
          ${img(frame.images?.auto_anchor, 'auto anchor')}
          ${img(frame.images?.manual_gt, 'manual art')}
          ${img(frame.images?.canonical, 'canonical art')}
        </div>
      </section>`;
    })
    .join('\n');
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Art crop ceiling</title>
<style>
body { font: 14px sans-serif; margin: 24px; background: #111; color: #eee; }
.row { display: flex; gap: 8px; flex-wrap: wrap; }
figure { margin: 0; width: 180px; }
img, .missing { width: 180px; min-height: 80px; background: #222; object-fit: contain; }
figcaption, .missing { font-size: 12px; color: #bbb; }
</style></head><body>
<h1>Art crop ceiling ${esc(report.verdict)}</h1>
<p>${esc(report.verdictWhy)}</p>
<p>${esc(report.anchorVerdict || '')} ${esc(report.anchorWhy || '')}</p>
<table>
<tr><th>Crop</th><th>Top1</th><th>Top3</th><th>Top5</th><th>Top10</th><th>Wrong-confident</th></tr>
${(report.table ?? []).map(row => `<tr><td>${esc(row.id)}</td><td>${esc(row.top1)}</td><td>${esc(row.top3)}</td><td>${esc(row.top5)}</td><td>${esc(row.top10)}</td><td>${esc(row.wrongConfident)}</td></tr>`).join('')}
</table>
${cards}
</body></html>
`;
};
