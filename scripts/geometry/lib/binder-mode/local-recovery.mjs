/**
 * Targeted local recovery around a grid-predicted missing slot.
 * Requires image edge evidence — does NOT inject the predicted quad blindly.
 * Rejects candidates that overlap already-observed cards (empty-pocket / neighbor steal).
 */

const SIDE_NAMES = ['top', 'right', 'bottom', 'left'];

const lumaAt = (data, w, h, x, y) => {
  const xi = Math.max(0, Math.min(w - 1, Math.round(x)));
  const yi = Math.max(0, Math.min(h - 1, Math.round(y)));
  const o = (yi * w + xi) * 4;
  return 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
};

const ptsOf = corners => [
  corners.topLeft,
  corners.topRight,
  corners.bottomRight,
  corners.bottomLeft,
];

const centerOf = corners => {
  const pts = ptsOf(corners);
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / 4,
    y: pts.reduce((s, p) => s + p.y, 0) / 4,
  };
};

const edgeEndpoints = (pts, side) => {
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

/** Mean |Δluma| along one side (inward vs outward), normalized 0–1. */
export const edgeEvidenceSide = (image, corners, side, { stations = 20, offset = 3 } = {}) => {
  const { data, width: w, height: h } = image;
  const pts = ptsOf(corners);
  const [a, b] = edgeEndpoints(pts, side);
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4;
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  if ((cx - mx) * nx + (cy - my) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  let sum = 0;
  for (let s = 0; s < stations; s++) {
    const t = (s + 0.5) / stations;
    const bx = a.x + (b.x - a.x) * t;
    const by = a.y + (b.y - a.y) * t;
    const out = lumaAt(data, w, h, bx - nx * offset, by - ny * offset);
    const inn = lumaAt(data, w, h, bx + nx * offset, by + ny * offset);
    sum += Math.abs(inn - out);
  }
  return sum / stations / 255;
};

export const edgeEvidenceAll = (image, corners) => {
  const sides = {};
  for (const s of SIDE_NAMES) sides[s] = edgeEvidenceSide(image, corners, s);
  const mean = SIDE_NAMES.reduce((a, s) => a + sides[s], 0) / 4;
  const sidesAbove = SIDE_NAMES.filter(s => sides[s] >= 0.07).length;
  const vals = SIDE_NAMES.map(s => sides[s]);
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  return { sides, mean, sidesAbove, balance: min / Math.max(max, 1e-6) };
};

/** Interior luma stddev — blank pockets are flatter than printed cards. */
export const interiorTexture = (image, corners, { samples = 48 } = {}) => {
  const { data, width: w, height: h } = image;
  const pts = ptsOf(corners);
  const lumas = [];
  for (let i = 0; i < samples; i++) {
    const u = 0.2 + (0.6 * ((i % 8) + 0.5)) / 8;
    const v = 0.2 + (0.6 * (Math.floor(i / 8) + 0.5)) / 6;
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
    lumas.push(lumaAt(data, w, h, x, y));
  }
  const m = lumas.reduce((a, b) => a + b, 0) / lumas.length;
  const varr = lumas.reduce((a, b) => a + (b - m) ** 2, 0) / lumas.length;
  return { mean: m / 255, std: Math.sqrt(varr) / 255 };
};

const transformCorners = (corners, { dx = 0, dy = 0, scale = 1 } = {}) => {
  const pts = ptsOf(corners);
  const c = centerOf(corners);
  const out = pts.map(p => ({
    x: c.x + (p.x - c.x) * scale + dx,
    y: c.y + (p.y - c.y) * scale + dy,
  }));
  return {
    topLeft: out[0],
    topRight: out[1],
    bottomRight: out[2],
    bottomLeft: out[3],
  };
};

/**
 * Local search around predicted quad; accept only with sufficient edge evidence.
 */
export const recoverMissingSlot = (
  image,
  predictedCorners,
  {
    localEdgeMinMean = 0.095,
    localEdgeMinSides = 3,
    localEdgeMinSide = 0.06,
    localSearchTranslatePx = 18,
    localSearchScale = 0.08,
    localMinInteriorStd = 0.04,
    localMinBalance = 0.35,
    occupiedCorners = [],
    polygonIoU = null,
    overlapRejectIou = 0.25,
  } = {},
) => {
  const t0 = performance.now();
  const steps = [-1, -0.5, 0, 0.5, 1];
  const scaleSteps = [1 - localSearchScale, 1, 1 + localSearchScale];
  let best = null;

  for (const sx of scaleSteps) {
    for (const ix of steps) {
      for (const iy of steps) {
        const cand = transformCorners(predictedCorners, {
          dx: ix * localSearchTranslatePx,
          dy: iy * localSearchTranslatePx,
          scale: sx,
        });
        if (polygonIoU && occupiedCorners?.length) {
          const overlap = occupiedCorners.some(o => polygonIoU(cand, o) >= overlapRejectIou);
          if (overlap) continue;
        }
        const ev = edgeEvidenceAll(image, cand);
        const tex = interiorTexture(image, cand);
        const sidesOk = SIDE_NAMES.filter(s => ev.sides[s] >= localEdgeMinSide).length;
        const score = ev.mean + 0.02 * sidesOk + 0.15 * tex.std + 0.05 * ev.balance;
        if (!best || score > best.score) {
          best = { corners: cand, evidence: ev, texture: tex, sidesOk, score };
        }
      }
    }
  }

  let reason = 'no-candidate';
  let accepted = false;
  if (best) {
    const overlapFinal =
      polygonIoU &&
      occupiedCorners?.length &&
      occupiedCorners.some(o => polygonIoU(best.corners, o) >= overlapRejectIou);
    if (overlapFinal) {
      reason = 'overlaps-occupied';
    } else if (best.evidence.mean < localEdgeMinMean) {
      reason = `insufficient-edge mean=${best.evidence.mean.toFixed(3)}`;
    } else if (best.sidesOk < localEdgeMinSides) {
      reason = `insufficient-sides ${best.sidesOk}`;
    } else if (best.evidence.balance < localMinBalance) {
      reason = `unbalanced-edges bal=${best.evidence.balance.toFixed(3)}`;
    } else if (best.texture.std < localMinInteriorStd) {
      reason = `flat-interior std=${best.texture.std.toFixed(3)}`;
    } else {
      accepted = true;
      reason = 'edge-evidence-ok';
    }
  }

  return {
    accepted,
    corners: accepted ? best.corners : null,
    predictedCorners,
    evidence: best?.evidence ?? null,
    texture: best?.texture ?? null,
    sidesOk: best?.sidesOk ?? 0,
    score: best?.score ?? 0,
    runtimeMs: performance.now() - t0,
    reason,
  };
};
