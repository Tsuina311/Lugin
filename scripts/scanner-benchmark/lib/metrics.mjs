import { createHash } from 'node:crypto';

/** TL, TR, BR, BL. Same rule as production orderCorners. */
export const orderCorners = pts => {
  if (!pts || pts.length !== 4) throw new Error('orderCorners expects 4 points');
  const sorted = [...pts].sort((a, b) => a.y - b.y || a.x - b.x);
  const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = sorted.slice(2).sort((a, b) => a.x - b.x);
  return {
    topLeft: top[0],
    topRight: top[1],
    bottomRight: bottom[1],
    bottomLeft: bottom[0],
  };
};

export const cornersToList = c => [c.topLeft, c.topRight, c.bottomRight, c.bottomLeft];

/** Bilinear map of the unit square onto a named quad. u right, v down. */
export const projectUnitPoint = (corners, u, v) => {
  const { topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl } = corners;
  const x =
    tl.x * (1 - u) * (1 - v) + tr.x * u * (1 - v) + br.x * u * v + bl.x * (1 - u) * v;
  const y =
    tl.y * (1 - u) * (1 - v) + tr.y * u * (1 - v) + br.y * u * v + bl.y * (1 - u) * v;
  return { x, y };
};

const polygonArea = pts => {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    s += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(s) / 2;
};

const insideEdge = (p, a, b) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= -1e-9;

const lineIntersect = (s, e, a, b) => {
  const dx = e.x - s.x;
  const dy = e.y - s.y;
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const denom = dx * ey - dy * ex;
  if (Math.abs(denom) < 1e-12) return { x: e.x, y: e.y };
  const t = ((a.x - s.x) * ey - (a.y - s.y) * ex) / denom;
  return { x: s.x + t * dx, y: s.y + t * dy };
};

/** Convex subject clipped to a convex clip polygon. */
export const clipPolygon = (subject, clip) => {
  let output = subject.map(p => ({ x: p.x, y: p.y }));
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const input = output;
    output = [];
    if (!input.length) break;
    for (let j = 0; j < input.length; j++) {
      const s = input[j];
      const e = input[(j + 1) % input.length];
      const ein = insideEdge(e, a, b);
      const sin = insideEdge(s, a, b);
      if (ein) {
        if (!sin) output.push(lineIntersect(s, e, a, b));
        output.push(e);
      } else if (sin) {
        output.push(lineIntersect(s, e, a, b));
      }
    }
  }
  return output;
};

export const polygonIoU = (a, b) => {
  if (!a?.length || !b?.length) return 0;
  const inter = polygonArea(clipPolygon(a, b));
  const union = polygonArea(a) + polygonArea(b) - inter;
  if (union <= 1e-9) return 0;
  return Math.max(0, Math.min(1, inter / union));
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const centroid = pts => {
  const n = pts.length || 1;
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / n,
    y: pts.reduce((s, p) => s + p.y, 0) / n,
  };
};

/** Compare a detector quad to manual corners. Errors are fractions of the frame diagonal. */
export const geometryDelta = (predicted, truth, frameW, frameH) => {
  if (!predicted || !truth) return null;
  const pred = cornersToList(predicted);
  const gt = cornersToList(truth);
  const diag = Math.hypot(frameW, frameH) || 1;
  const cornerPx = pred.reduce((s, p, i) => s + dist(p, gt[i]), 0) / 4;
  const pc = centroid(pred);
  const gc = centroid(gt);
  const topPred = Math.atan2(pred[1].y - pred[0].y, pred[1].x - pred[0].x);
  const topGt = Math.atan2(gt[1].y - gt[0].y, gt[1].x - gt[0].x);
  const predW = (dist(pred[0], pred[1]) + dist(pred[3], pred[2])) / 2;
  const gtW = (dist(gt[0], gt[1]) + dist(gt[3], gt[2])) / 2;
  const predArea = Math.abs(shoelace(pred));
  const gtArea = Math.abs(shoelace(gt));
  return {
    cornerPx,
    cornerNorm: cornerPx / diag,
    iou: polygonIoU(pred, gt),
    centerNorm: dist(pc, gc) / diag,
    scaleError: gtW > 0 ? Math.abs(predW - gtW) / gtW : null,
    areaRatio: gtArea > 0 ? predArea / gtArea : null,
    rotationRad: Math.atan2(Math.sin(topPred - topGt), Math.cos(topPred - topGt)),
  };
};

const shoelace = pts => {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    area += p.x * q.y - q.x * p.y;
  }
  return area / 2;
};

const orient = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));

const segmentsIntersect = (a, b, c, d) => {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4;
};

/**
 * Quad check before a corner save. Hard errors block the save.
 * Warnings (perspective, possible inner frame) can be overridden.
 */
export const validateCardQuad = (corners, width, height) => {
  const errors = [];
  const warnings = [];
  if (!corners) return { ok: false, errors: ['Corners are missing.'], warnings };
  const pts = cornersToList(corners);
  if (pts.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    return { ok: false, errors: ['Each corner needs a finite x and y.'], warnings, aspect: null };
  }
  if (pts.some(p => p.x < -1 || p.y < -1 || p.x > width + 1 || p.y > height + 1)) {
    errors.push('A corner is outside the source image.');
  }
  const turns = [];
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    const c = pts[(i + 2) % 4];
    turns.push((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x));
  }
  if (turns.some(v => v === 0) || (turns.some(v => v > 0) && turns.some(v => v < 0))) {
    errors.push('The quad is not convex.');
  }
  if (segmentsIntersect(pts[0], pts[1], pts[2], pts[3]) || segmentsIntersect(pts[1], pts[2], pts[3], pts[0])) {
    errors.push('The quad crosses itself.');
  }
  const [tl, tr, br, bl] = pts;
  if (!(tl.y < bl.y && tr.y < br.y && tl.x < tr.x && bl.x < br.x)) {
    errors.push('Corners must be ordered top-left, top-right, bottom-right, bottom-left.');
  }
  const widthPx = (dist(tl, tr) + dist(bl, br)) / 2;
  const heightPx = (dist(tl, bl) + dist(tr, br)) / 2;
  const aspect = heightPx > 0 ? widthPx / heightPx : 0;
  if (aspect < 0.35 || aspect > 1.45) {
    errors.push(`Aspect ${aspect.toFixed(2)} is far from a physical MTG card.`);
  } else if (aspect < 0.55 || aspect > 0.95) {
    warnings.push(
      `Aspect ${aspect.toFixed(2)} is outside the usual card range. Perspective can cause that. Confirm these are the outer card corners, not the artwork.`,
    );
  }
  if (widthPx < 80 || heightPx < 110) {
    warnings.push('The quad is very small for a card in frame. It may be the inner frame or the artwork.');
  }
  return { ok: errors.length === 0, errors, warnings, aspect };
};

/** Counts on the paired frames. Rates are not treated as a hard threshold. */
export const geometryDecision = ({ n, currentTop1, oracleTop1, recovered, broken, stillWrong }) => {
  if (n == null || n < 5 || currentTop1 == null || oracleTop1 == null) {
    return {
      verdict: 'INSUFFICIENT_ANNOTATION',
      preliminary: true,
      why: `Oracle geometry needs at least 5 paired frames. This run has ${n ?? 0}.`,
    };
  }
  const delta = oracleTop1 - currentTop1;
  const preliminary = n < 11;
  let verdict;
  let why;
  if (delta >= 3 && broken === 0 && stillWrong <= 1) {
    verdict = stillWrong === 0 && delta >= 4 ? 'GEOMETRY_DOMINANT' : 'GEOMETRY_MAJOR';
    why = `${recovered} current visual miss${recovered === 1 ? '' : 'es'} reached Top1 from oracle card corners, with no recognizer change.`;
  } else if (delta <= 1) {
    verdict = 'RECOGNITION_DOMINANT';
    why = `Oracle card corners moved Top1 by ${delta} of ${n} (${currentTop1}/${n} → ${oracleTop1}/${n}).`;
  } else {
    verdict = 'MIXED';
    why = `Oracle card corners recovered ${recovered} of ${n} and left ${stillWrong} wrong (${currentTop1}/${n} → ${oracleTop1}/${n}).`;
  }
  if (preliminary) {
    why = `PRELIMINARY on ${n} of 11 confirmed frames. ${why}`;
  }
  return { verdict, preliminary, why };
};

export const percentile = (xs, p) => {
  const v = xs.filter(x => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const i = Math.min(v.length - 1, Math.max(0, Math.ceil(p * v.length) - 1));
  return v[i];
};

export const hamming64 = (a, b) => {
  if (!a || !b || a.length !== b.length) return 64;
  let n = 0;
  for (let i = 0; i < a.length; i += 2) {
    const x = Number.parseInt(a.slice(i, i + 2), 16) ^ Number.parseInt(b.slice(i, i + 2), 16);
    n += x.toString(2).replace(/0/g, '').length;
  }
  return n;
};

/** Union-find clusters. `close(i, j)` is symmetric. */
export const clusterIndexes = (n, close) => {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = i => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!close(i, j)) continue;
      const a = find(i);
      const b = find(j);
      if (a !== b) parent[b] = a;
    }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  }
  return [...groups.values()].filter(g => g.length > 1);
};

/**
 * Split unit is the capture session, never the frame.
 * First 4 bytes of sha256(sessionId) mod 100. <20 → LOCKED_TEST, else DEV.
 */
export const splitSession = sessionId => {
  const n = createHash('sha256').update(String(sessionId)).digest().readUInt32BE(0) % 100;
  return n < 20 ? 'LOCKED_TEST' : 'DEV';
};

export const stableStringify = value => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
};

export const datasetHash = parts =>
  createHash('sha256').update(stableStringify(parts)).digest('hex');

const ALLOWED_IDENTITY_SOURCES = new Set(['EXISTING_FIXTURE', 'SESSION_METADATA', 'MANUAL']);

/** CONFIRMED labels from an allowed source. Scanner predictions never score. */
export const confirmedIdentities = annotations =>
  (annotations ?? []).filter(
    a =>
      a &&
      a.status === 'CONFIRMED' &&
      ALLOWED_IDENTITY_SOURCES.has(a.source) &&
      a.source !== 'SCANNER_PREDICTION' &&
      (a.cardName || a.oracleId),
  );

export const topKFlags = (ranked, matches, ks = [1, 3, 5, 10]) => {
  const out = {};
  for (const k of ks) out[`top${k}`] = (ranked ?? []).slice(0, k).some(matches);
  const idx = (ranked ?? []).findIndex(matches);
  out.rank = idx >= 0 ? idx + 1 : null;
  return out;
};

export const mean = xs => {
  const v = xs.filter(x => x != null && Number.isFinite(x));
  if (!v.length) return null;
  return v.reduce((s, x) => s + x, 0) / v.length;
};

/** Equal weight per frame, per session, and per card name. */
export const weightedRates = (rows, hitKey) => {
  const frames = rows.filter(r => r[hitKey] != null);
  const frame = frames.length ? frames.filter(r => r[hitKey]).length / frames.length : null;
  const by = (keyFn) => {
    const groups = new Map();
    for (const r of frames) {
      const k = keyFn(r);
      if (!k) continue;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r[hitKey] ? 1 : 0);
    }
    if (!groups.size) return null;
    const rates = [...groups.values()].map(xs => xs.reduce((s, x) => s + x, 0) / xs.length);
    return rates.reduce((s, x) => s + x, 0) / rates.length;
  };
  return {
    frame,
    session: by(r => r.sessionId),
    card: by(r => r.cardName),
    n: frames.length,
  };
};

/**
 * Failure class from evidence already measured. Missing evidence stays unclassified
 * rather than guessed.
 */
export const classifyFailure = row => {
  if (row.identityCorrect) return null;
  const reasons = [];
  if (row.detected === false) reasons.push('DETECTOR_MISS');
  else if (row.geometry && row.geometry.iou != null && row.geometry.iou < 0.5) {
    reasons.push('DETECTOR_BAD_QUAD');
  }
  if (row.warpOk === false) reasons.push('WARP_FAILURE');
  if (row.cropOk === false) reasons.push('CROP_FAILURE');
  if (row.visualTop1 === false) reasons.push('VISUAL_WRONG');
  else if (row.visualTop1 == null && row.visualAttempted) reasons.push('VISUAL_AMBIGUOUS');
  if (row.ocrStatus === 'ocr-empty') reasons.push('OCR_EMPTY');
  else if (row.ocrWrongAccepted) reasons.push('OCR_WRONG');
  if (row.fusionBreaksCorrect) reasons.push('FUSION_WRONG');
  if (!reasons.length) return 'UNCLASSIFIED';
  if (reasons.length > 1) return 'MULTI_FACTOR';
  return reasons[0];
};

/**
 * Gains are Top1 rates on the same frames. Null means that arm did not run.
 * structuralSameCrop: B and C call the same art-crop function, so B→C is not evidence.
 */
export const verdictFromGains = ({ a, b, c, structuralSameCrop, fusionGain }) => {
  if (a == null) {
    return {
      verdict: 'INSUFFICIENT_GROUND_TRUTH',
      why: 'No confirmed identities were scored.',
    };
  }
  if (b == null) {
    return {
      verdict: 'INSUFFICIENT_GROUND_TRUTH',
      why: `Current visual Top1 is ${(100 * a).toFixed(1)}% on confirmed labels. Oracle corners are not annotated, so A→B was not measured.`,
    };
  }
  const ab = b - a;
  const bc = c == null || structuralSameCrop ? null : c - b;
  if (fusionGain != null && fusionGain >= 0.1 && fusionGain > ab) {
    return {
      verdict: 'FUSION_DOMINANT',
      why: `Fusion gained ${(100 * fusionGain).toFixed(1)} points over the better single channel, more than the geometry gap.`,
    };
  }
  if (ab >= 0.15 && (bc == null || ab >= bc + 0.05)) {
    return {
      verdict: 'GEOMETRY_DOMINANT',
      why: `Oracle card corners lifted Top1 by ${(100 * ab).toFixed(1)} points (${(100 * a).toFixed(1)}% → ${(100 * b).toFixed(1)}%).`,
    };
  }
  if (bc != null && bc >= 0.1 && ab < 0.05) {
    return {
      verdict: 'CROP_DOMAIN_DOMINANT',
      why: `Oracle card corners moved Top1 by ${(100 * ab).toFixed(1)} points. The art-crop arm moved it by ${(100 * bc).toFixed(1)} points.`,
    };
  }
  if (ab < 0.05 && (bc == null || bc < 0.05)) {
    return {
      verdict: 'RECOGNITION_DOMINANT',
      why: structuralSameCrop
        ? `Oracle corners moved Top1 by ${(100 * ab).toFixed(1)} points. The current art crop is already the canonical crop, so B and C are the same function.`
        : `Oracle corners moved Top1 by ${(100 * ab).toFixed(1)} points and the art-crop arm did not open a larger gap.`,
    };
  }
  return {
    verdict: 'MIXED',
    why: `A→B is ${(100 * ab).toFixed(1)} points${bc == null ? '' : ` and B→C is ${(100 * bc).toFixed(1)} points`}.`,
  };
};

export const fusionClass = ({ visualOk, ocrOk, fusedOk }) => {
  if (visualOk && ocrOk && fusedOk) return 'BOTH_AGREE';
  if (!visualOk && ocrOk && fusedOk) return 'OCR_FIXES_VISUAL';
  if (visualOk && !ocrOk && fusedOk) return 'VISUAL_FIXES_OCR';
  if (!visualOk && !ocrOk && fusedOk) return 'FUSION_FIXES_BOTH';
  if (visualOk && !fusedOk) return 'FUSION_BREAKS_VISUAL';
  if (ocrOk && !fusedOk) return 'FUSION_BREAKS_OCR';
  if (!visualOk && !ocrOk && !fusedOk) return 'BOTH_FAIL';
  return 'UNCLASSIFIED';
};
