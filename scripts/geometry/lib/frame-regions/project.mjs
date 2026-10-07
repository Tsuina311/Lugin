/**
 * Quad projection between source pixels and the canonical 744×1039 card.
 * Same homography as src/lib/scan/geometry.ts (dest → source, h33 = 1).
 * CARD_HEIGHT must stay Math.round(744 / (63/88)) === 1039.
 */

export const CARD_ASPECT = 63 / 88;
export const CARD_WIDTH = 744;
export const CARD_HEIGHT = Math.round(CARD_WIDTH / CARD_ASPECT);

const KEYS = ['tl', 'tr', 'br', 'bl'];

export const quadPoints = quad => KEYS.map(key => ({ x: quad[key][0], y: quad[key][1] }));

export const pointsQuad = points => ({
  tl: [points[0].x, points[0].y],
  tr: [points[1].x, points[1].y],
  br: [points[2].x, points[2].y],
  bl: [points[3].x, points[3].y],
});

export const canonicalRect = (width = CARD_WIDTH, height = CARD_HEIGHT) => ({
  tl: [0, 0],
  tr: [width - 1, 0],
  br: [width - 1, height - 1],
  bl: [0, height - 1],
});

const solve8 = (A, b) => {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const div = M[col][col];
    if (Math.abs(div) < 1e-12) throw new Error('Singular homography');
    for (let c = col; c <= n; c++) M[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map(row => row[n]);
};

/** H such that src = H * dest. Matches geometry.ts homographyDestToSrc. */
export const homographyDestToSrc = (src, dest) => {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const dx = dest[i].x;
    const dy = dest[i].y;
    const sx = src[i].x;
    const sy = src[i].y;
    A.push([dx, dy, 1, 0, 0, 0, -dx * sx, -dy * sx]);
    b.push(sx);
    A.push([0, 0, 0, dx, dy, 1, -dx * sy, -dy * sy]);
    b.push(sy);
  }
  const h = solve8(A, b);
  return new Float64Array([h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]);
};

export const applyH = (H, point) => {
  const w = H[6] * point.x + H[7] * point.y + H[8];
  return {
    x: (H[0] * point.x + H[1] * point.y + H[2]) / w,
    y: (H[3] * point.x + H[4] * point.y + H[5]) / w,
  };
};

export const mapQuad = (quad, H) => pointsQuad(quadPoints(quad).map(point => applyH(H, point)));

/** Maps canonical pixels onto the source image. */
export const canonicalToSourceH = (cardQuad, width = CARD_WIDTH, height = CARD_HEIGHT) =>
  homographyDestToSrc(quadPoints(cardQuad), quadPoints(canonicalRect(width, height)));

/** Maps source pixels onto the canonical card. */
export const sourceToCanonicalH = (cardQuad, width = CARD_WIDTH, height = CARD_HEIGHT) =>
  homographyDestToSrc(quadPoints(canonicalRect(width, height)), quadPoints(cardQuad));

export const canonicalQuadToSource = (quad, cardQuad, width = CARD_WIDTH, height = CARD_HEIGHT) =>
  mapQuad(quad, canonicalToSourceH(cardQuad, width, height));

export const sourceQuadToCanonical = (quad, cardQuad, width = CARD_WIDTH, height = CARD_HEIGHT) =>
  mapQuad(quad, sourceToCanonicalH(cardQuad, width, height));

export class RegionQuadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RegionQuadError';
  }
}

const finitePair = point => Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]);

const asPoint = point => ({ x: point[0], y: point[1] });

const turn = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/**
 * Four corners are a strictly convex quadrilateral.
 * Click order is irrelevant. A bowtie pairing of a convex point set is not rejected here;
 * ordering assigns the edges. A point inside the other three, a duplicate, or a flat quad is.
 */
const assertConvexQuad = points => {
  if (points.length !== 4) throw new RegionQuadError('region quad needs four corners');
  if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new RegionQuadError('region quad needs four finite corners');
  }
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      if (Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) < 1e-3) {
        throw new RegionQuadError('region quad has duplicate corners');
      }
    }
  }
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const point = sorted[i];
    while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  if (lower.length + upper.length !== 4) {
    throw new RegionQuadError('region quad is self-crossing or not strictly convex');
  }
};

/**
 * TL, TR, BR, BL in an upright coordinate system.
 * This is the same rule as orderCorners in src/lib/scan/geometry.ts.
 * Call it only after points are in canonical card space, never on raw screen Y.
 */
const orderUprightPoints = points => {
  const sorted = [...points].sort((a, b) => a.y - b.y || a.x - b.x);
  const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = sorted.slice(2).sort((a, b) => a.x - b.x);
  return [top[0], top[1], bottom[1], bottom[0]];
};

/**
 * Reassign TL/TR/BR/BL so the region inherits the parent card's upright orientation.
 * The four source points are unchanged; only which corner name they carry changes.
 */
export const orderRegionQuadInCardSpace = ({ regionQuadSource, cardQuadSource, width = CARD_WIDTH, height = CARD_HEIGHT } = {}) => {
  if (!regionQuadSource || !cardQuadSource) throw new RegionQuadError('region and card quads are required');
  if (!KEYS.every(key => finitePair(regionQuadSource[key]))) {
    throw new RegionQuadError('region quad needs four finite corners');
  }
  if (!KEYS.every(key => finitePair(cardQuadSource[key]))) {
    throw new RegionQuadError('card quad needs four finite corners');
  }
  const paired = KEYS.map(key => ({ source: regionQuadSource[key], point: asPoint(regionQuadSource[key]) }));
  assertConvexQuad(paired.map(row => row.point));
  let H;
  try {
    H = sourceToCanonicalH(cardQuadSource, width, height);
  } catch (err) {
    throw new RegionQuadError(err.message || 'card homography failed');
  }
  const canonical = paired.map(row => ({ ...row, canonical: applyH(H, row.point) }));
  if (canonical.some(row => !Number.isFinite(row.canonical.x) || !Number.isFinite(row.canonical.y))) {
    throw new RegionQuadError('region quad does not project into the card');
  }
  assertConvexQuad(canonical.map(row => row.canonical));
  const upright = orderUprightPoints(canonical.map(row => row.canonical));
  const ordered = upright.map(point => canonical.find(row => row.canonical === point).source);
  return pointsQuad(ordered.map(point => ({ x: point[0], y: point[1] })));
};

const sameStoredPoint = (a, b) => a[0] === b[0] && a[1] === b[1];

/**
 * Compare stored corner names with card-upright names.
 * A cyclic shift is 0/90/180/270. A reversed ring is a mirror, which warpQuadToCard would flip.
 */
export const regionOrientation = ({ regionQuadSource, cardQuadSource, width = CARD_WIDTH, height = CARD_HEIGHT } = {}) => {
  const ordered = orderRegionQuadInCardSpace({ regionQuadSource, cardQuadSource, width, height });
  const H = sourceToCanonicalH(cardQuadSource, width, height);
  const start = applyH(H, asPoint(regionQuadSource.tl));
  const end = applyH(H, asPoint(regionQuadSource.tr));
  let angle = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
  if (angle < 0) angle += 360;
  const perm = KEYS.map(key => KEYS.findIndex(stored => sameStoredPoint(ordered[key], regionQuadSource[stored])));
  let kind = 'other';
  for (let shift = 0; shift < 4; shift++) {
    if (perm.every((value, index) => value === (index + shift) % 4)) kind = 'rotation';
  }
  if (kind !== 'rotation') {
    for (let startAt = 0; startAt < 4; startAt++) {
      if (perm.every((value, index) => value === (startAt - index + 4) % 4)) kind = 'mirror';
    }
  }
  const buckets = [0, 90, 180, 270];
  let snapped = null;
  if (kind === 'rotation') {
    snapped = 0;
    let deviation = Infinity;
    for (const bucket of buckets) {
      const delta = Math.min(Math.abs(angle - bucket), 360 - Math.abs(angle - bucket));
      if (delta < deviation) {
        deviation = delta;
        snapped = bucket;
      }
    }
  }
  const changed = KEYS.some(key => !sameStoredPoint(ordered[key], regionQuadSource[key]));
  return { ordered, angle, snapped, kind, changed };
};

/** Order every stored region of one card. Returns the same object when nothing moves. */
export const orientCardRegions = card => {
  if (!card?.regions || !KEYS.every(key => finitePair(card.groundTruthQuad?.[key]))) return card;
  let changed = false;
  const regions = {};
  for (const [key, region] of Object.entries(card.regions)) {
    if (!region?.quad || !KEYS.every(corner => finitePair(region.quad[corner]))) {
      regions[key] = region;
      continue;
    }
    const quad = orderRegionQuadInCardSpace({
      regionQuadSource: region.quad,
      cardQuadSource: card.groundTruthQuad,
    });
    const same = KEYS.every(corner => quad[corner][0] === region.quad[corner][0] && quad[corner][1] === region.quad[corner][1]);
    regions[key] = same ? region : { ...region, quad };
    if (!same) changed = true;
  }
  return changed ? { ...card, regions } : card;
};

export const projectCanonicalRegions = (regions, cardQuad, width = CARD_WIDTH, height = CARD_HEIGHT) => {
  const H = canonicalToSourceH(cardQuad, width, height);
  const out = {};
  for (const [key, region] of Object.entries(regions ?? {})) {
    if (!region?.quad) continue;
    out[key] = {
      quad: mapQuad(region.quad, H),
      confidence: region.confidence,
    };
  }
  return out;
};
