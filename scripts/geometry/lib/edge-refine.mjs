/**
 * Host-only physical-card edge refiner.
 *
 * Starts from an existing detector candidate and searches locally along edge
 * normals for a tighter coherent boundary. Does NOT rerun global detection.
 * Does NOT change DetectCard production.
 *
 * Modes: 'y' (default) | 'rgb' (offline chroma experiment).
 */

const CARD_ASPECT = 63 / 88;
const SIDE_NAMES = ['top', 'right', 'bottom', 'left'];

const lumaAt = (data, w, h, x, y) => {
  const xi = Math.max(0, Math.min(w - 1, Math.round(x)));
  const yi = Math.max(0, Math.min(h - 1, Math.round(y)));
  const o = (yi * w + xi) * 4;
  return 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
};

const rgbAt = (data, w, h, x, y) => {
  const xi = Math.max(0, Math.min(w - 1, Math.round(x)));
  const yi = Math.max(0, Math.min(h - 1, Math.round(y)));
  const o = (yi * w + xi) * 4;
  return [data[o], data[o + 1], data[o + 2]];
};

const chromaDist = (a, b) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export const cornersToPts = corners => [
  corners.topLeft,
  corners.topRight,
  corners.bottomRight,
  corners.bottomLeft,
];

export const ptsToCorners = pts => ({
  topLeft: { x: pts[0].x, y: pts[0].y },
  topRight: { x: pts[1].x, y: pts[1].y },
  bottomRight: { x: pts[2].x, y: pts[2].y },
  bottomLeft: { x: pts[3].x, y: pts[3].y },
});

const edgeEndpoints = (pts, side) => {
  // TL TR BR BL
  switch (side) {
    case 'top':
      return [pts[0], pts[1]];
    case 'right':
      return [pts[1], pts[2]];
    case 'bottom':
      return [pts[2], pts[3]];
    case 'left':
      return [pts[3], pts[0]];
    default:
      throw new Error(side);
  }
};

/** Inward unit normal (toward quad center). */
const inwardNormal = (a, b, center) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  // perpendiculars
  let nx = -dy / len;
  let ny = dx / len;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  // flip so normal points toward center
  if ((center.x - mx) * nx + (center.y - my) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { nx, ny, len };
};

const centerOfPts = pts => ({
  x: pts.reduce((s, p) => s + p.x, 0) / 4,
  y: pts.reduce((s, p) => s + p.y, 0) / 4,
});

/**
 * Sample 1D profile along the edge normal at several stations.
 * offset > 0 = inward; offset < 0 = outward.
 */
export const sampleEdgeProfile = (
  image,
  corners,
  side,
  {
    mode = 'y',
    stations = 24,
    inwardPx = 28,
    outwardPx = 8,
    step = 1,
  } = {},
) => {
  const { data, width: w, height: h } = image;
  const pts = cornersToPts(corners);
  const center = centerOfPts(pts);
  const [a, b] = edgeEndpoints(pts, side);
  const { nx, ny } = inwardNormal(a, b, center);

  const offsets = [];
  for (let o = -outwardPx; o <= inwardPx; o += step) offsets.push(o);

  const stationProfiles = [];
  for (let s = 0; s < stations; s++) {
    const t = (s + 0.5) / stations;
    const bx = a.x + (b.x - a.x) * t;
    const by = a.y + (b.y - a.y) * t;
    const samples = [];
    for (const o of offsets) {
      const x = bx + nx * o;
      const y = by + ny * o;
      let v;
      if (mode === 'rgb') {
        // distance to exterior sample as chroma contrast proxy
        const exterior = rgbAt(data, w, h, bx - nx * Math.min(6, outwardPx), by - ny * Math.min(6, outwardPx));
        const cur = rgbAt(data, w, h, x, y);
        v = chromaDist(exterior, cur);
      } else {
        v = lumaAt(data, w, h, x, y);
      }
      samples.push({ offset: o, value: v });
    }
    // gradient dV/do (positive = rising as we go inward)
    const grad = samples.map((s, i) => {
      if (i === 0 || i === samples.length - 1) return { offset: s.offset, grad: 0 };
      return {
        offset: s.offset,
        grad: (samples[i + 1].value - samples[i - 1].value) / (samples[i + 1].offset - samples[i - 1].offset),
      };
    });
    stationProfiles.push({ t, base: { x: bx, y: by }, samples, grad });
  }

  // Aggregate mean |grad| and mean value per offset
  const agg = offsets.map(o => {
    let gSum = 0;
    let vSum = 0;
    let n = 0;
    for (const st of stationProfiles) {
      const g = st.grad.find(x => x.offset === o);
      const s = st.samples.find(x => x.offset === o);
      if (g && s) {
        gSum += Math.abs(g.grad);
        vSum += s.value;
        n += 1;
      }
    }
    return { offset: o, meanAbsGrad: n ? gSum / n : 0, meanValue: n ? vSum / n : 0 };
  });

  return { side, nx, ny, a, b, offsets, stationProfiles, aggregate: agg };
};

/** Peak offsets with coherence (how many stations agree within ±2px). */
const findCoherentPeaks = (profile, { minRel = 0.35, maxPeaks = 4 } = {}) => {
  const agg = profile.aggregate;
  const maxG = Math.max(...agg.map(a => a.meanAbsGrad), 1e-6);
  const candidates = [];
  for (let i = 1; i < agg.length - 1; i++) {
    const g = agg[i].meanAbsGrad;
    if (g < minRel * maxG) continue;
    if (g >= agg[i - 1].meanAbsGrad && g >= agg[i + 1].meanAbsGrad) {
      candidates.push({ offset: agg[i].offset, strength: g / maxG });
    }
  }
  candidates.sort((a, b) => b.strength - a.strength);
  return candidates.slice(0, maxPeaks);
};

const shiftEdge = (pts, side, offset, nx, ny) => {
  // Move both endpoints along inward normal by offset
  const out = pts.map(p => ({ ...p }));
  const move = (i) => {
    out[i] = { x: out[i].x + nx * offset, y: out[i].y + ny * offset };
  };
  switch (side) {
    case 'top':
      move(0); move(1); break;
    case 'right':
      move(1); move(2); break;
    case 'bottom':
      move(2); move(3); break;
    case 'left':
      move(3); move(0); break;
  }
  return out;
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const aspectOfPts = pts => {
  const w = (dist(pts[0], pts[1]) + dist(pts[3], pts[2])) / 2;
  const h = (dist(pts[0], pts[3]) + dist(pts[1], pts[2])) / 2;
  return w / Math.max(h, 1e-6);
};

const parallelScore = pts => {
  const top = dist(pts[0], pts[1]);
  const bottom = dist(pts[3], pts[2]);
  const left = dist(pts[0], pts[3]);
  const right = dist(pts[1], pts[2]);
  const w = (top + bottom) / 2;
  const h = (left + right) / 2;
  return 1 - Math.min(1, (Math.abs(top - bottom) / Math.max(w, 1) + Math.abs(left - right) / Math.max(h, 1)) / 2);
};

const isConvex = pts => {
  // Cross products of consecutive edges same sign
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    const c = pts[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-6) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
};

/** Cheap layout prior: prefer slightly darker/more structured title band near top of normalized card. */
const layoutTieBreak = (image, corners) => {
  const { data, width: w, height: h } = image;
  const pts = cornersToPts(corners);
  // Sample a few bands in normalized UV space of the quad (bilinear-ish via bilinear weights)
  const sampleUv = (u, v) => {
    // bilinear from TL-TR-BR-BL
    const top = {
      x: pts[0].x + (pts[1].x - pts[0].x) * u,
      y: pts[0].y + (pts[1].y - pts[0].y) * u,
    };
    const bot = {
      x: pts[3].x + (pts[2].x - pts[3].x) * u,
      y: pts[3].y + (pts[2].y - pts[3].y) * u,
    };
    const x = top.x + (bot.x - top.x) * v;
    const y = top.y + (bot.y - top.y) * v;
    return lumaAt(data, w, h, x, y);
  };
  let title = 0;
  let art = 0;
  let rules = 0;
  let nT = 0;
  let nA = 0;
  let nR = 0;
  for (let u = 0.15; u <= 0.85; u += 0.1) {
    for (let v = 0.04; v <= 0.12; v += 0.02) {
      title += sampleUv(u, v);
      nT += 1;
    }
    for (let v = 0.18; v <= 0.55; v += 0.05) {
      art += sampleUv(u, v);
      nA += 1;
    }
    for (let v = 0.62; v <= 0.88; v += 0.04) {
      rules += sampleUv(u, v);
      nR += 1;
    }
  }
  title /= nT;
  art /= nA;
  rules /= nR;
  // Prefer title band darker than art (text on light) OR art variance — soft prior
  const titleArtSep = Math.abs(art - title) / 255;
  return Math.min(1, titleArtSep * 2);
};

/**
 * Jointly refine four edges from peak hypotheses.
 * Safe default: stay put unless a sleeve-like multi-side secondary inward peak is detected.
 */
export const refineCardEdges = (image, corners, options = {}) => {
  const { mode = 'y', useLayout = true } = options;
  const pts0 = cornersToPts(corners);
  const center0 = centerOfPts(pts0);
  const profiles = {};
  const peaks = {};
  for (const side of SIDE_NAMES) {
    profiles[side] = sampleEdgeProfile(image, corners, side, { mode });
    peaks[side] = findCoherentPeaks(profiles[side]);
  }

  // Sleeve-like signature: ≥3 sides have a coherent inward secondary peak
  // AND (optional) detector already preferred nested inner — reduces false shrinks.
  const requireSleeveTag = options.requireSleeveTag === true;
  const hasSleeveTag = options.hasSleeveTag === true;
  if (requireSleeveTag && !hasSleeveTag) {
    return {
      corners,
      offsets: { top: 0, right: 0, bottom: 0, left: 0 },
      score: 0,
      profiles,
      peaks,
      mode,
      sleeveLike: false,
      applied: false,
    };
  }

  const inwardHints = {};
  let sleeveLikeSides = 0;
  for (const side of SIDE_NAMES) {
    const inward = peaks[side]
      .filter(p => p.offset >= 5 && p.offset <= 28)
      .sort((a, b) => b.strength - a.strength)[0];
    if (inward && inward.strength >= 0.4) {
      inwardHints[side] = inward;
      sleeveLikeSides += 1;
    }
  }
  const sleeveLike = sleeveLikeSides >= 2;

  if (!sleeveLike) {
    return {
      corners,
      offsets: { top: 0, right: 0, bottom: 0, left: 0 },
      score: 0,
      profiles,
      peaks,
      mode,
      sleeveLike: false,
      applied: false,
    };
  }

  // Build hypothesis sets: stay + hinted inward (+ optional weaker peaks)
  for (const side of SIDE_NAMES) {
    const list = [{ offset: 0, strength: 0.55 }];
    if (inwardHints[side]) list.push(inwardHints[side]);
    else {
      const weak = peaks[side].find(p => p.offset > 2);
      if (weak) list.push(weak);
    }
    peaks[side] = list;
  }

  let best = {
    pts: pts0,
    score: -Infinity,
    offsets: { top: 0, right: 0, bottom: 0, left: 0 },
  };

  const scoreQuad = (pts, offsets, peakStrengthSum) => {
    if (!isConvex(pts)) return -Infinity;
    const aspect = aspectOfPts(pts);
    const aspectScore = 1 - Math.min(1, Math.abs(aspect - CARD_ASPECT) / CARD_ASPECT);
    const parallel = parallelScore(pts);
    const c = centerOfPts(pts);
    const centerShift = Math.hypot(c.x - center0.x, c.y - center0.y);
    const diag = dist(pts0[0], pts0[2]);
    const centerScore = 1 - Math.min(1, centerShift / Math.max(diag * 0.15, 1));
    const move = SIDE_NAMES.reduce((s, k) => s + Math.abs(offsets[k]), 0);
    const moveScore = 1 - Math.min(1, move / 100);
    const inward = SIDE_NAMES.reduce((s, k) => s + Math.max(0, offsets[k]), 0);
    const sidesIn = SIDE_NAMES.filter(k => offsets[k] >= 4).length;
    // Prefer coordinated inward shrink (true sleeve)
    const consensus = sidesIn >= 3 ? 0.25 : sidesIn === 2 ? 0.05 : -0.2;
    let layout = 0;
    if (useLayout) layout = layoutTieBreak(image, ptsToCorners(pts)) * 0.1;
    return (
      aspectScore * 0.3 +
      parallel * 0.2 +
      centerScore * 0.15 +
      moveScore * 0.1 +
      peakStrengthSum * 0.1 +
      Math.min(1, inward / 50) * 0.1 +
      consensus +
      layout
    );
  };

  const sides = SIDE_NAMES;
  const rec = (i, curPts, offsets, strengthSum) => {
    if (i === sides.length) {
      const sc = scoreQuad(curPts, offsets, strengthSum / sides.length);
      if (sc > best.score) {
        best = { pts: curPts.map(p => ({ ...p })), score: sc, offsets: { ...offsets } };
      }
      return;
    }
    const side = sides[i];
    const { nx, ny } = profiles[side];
    for (const peak of peaks[side]) {
      const next = shiftEdge(curPts, side, peak.offset, nx, ny);
      offsets[side] = peak.offset;
      rec(i + 1, next, offsets, strengthSum + peak.strength);
    }
  };
  rec(0, pts0, { top: 0, right: 0, bottom: 0, left: 0 }, 0);

  return {
    corners: ptsToCorners(best.pts),
    offsets: best.offsets,
    score: best.score,
    profiles,
    peaks,
    mode,
    sleeveLike: true,
    applied: SIDE_NAMES.some(s => Math.abs(best.offsets[s]) > 1),
  };
};

/**
 * Project GT edge onto candidate normal axis → offset of GT relative to candidate edge.
 * Positive = GT is inward of candidate.
 */
export const gtEdgeOffset = (candCorners, gtCorners, side) => {
  const cPts = cornersToPts(candCorners);
  const gPts = cornersToPts(gtCorners);
  const center = centerOfPts(cPts);
  const [a, b] = edgeEndpoints(cPts, side);
  const { nx, ny } = inwardNormal(a, b, center);
  const [ga, gb] = edgeEndpoints(gPts, side);
  const midC = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const midG = { x: (ga.x + gb.x) / 2, y: (ga.y + gb.y) / 2 };
  return (midG.x - midC.x) * nx + (midG.y - midC.y) * ny;
};

export const buildEdgeDiagnostics = (image, candCorners, cardGt, sleeveGt, { mode = 'y' } = {}) => {
  const out = {};
  for (const side of SIDE_NAMES) {
    const profile = sampleEdgeProfile(image, candCorners, side, { mode });
    const peaks = findCoherentPeaks(profile);
    out[side] = {
      aggregate: profile.aggregate,
      peaks,
      candidateOffset: 0,
      cardGtOffset: cardGt ? gtEdgeOffset(candCorners, cardGt, side) : null,
      sleeveGtOffset: sleeveGt ? gtEdgeOffset(candCorners, sleeveGt, side) : null,
    };
  }
  return out;
};

export { SIDE_NAMES, CARD_ASPECT };
