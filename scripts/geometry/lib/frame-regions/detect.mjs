/**
 * Canonical-space MTG frame boundary finder.
 *
 * Input is a perspective-corrected card (typically 744×1039). Detection is
 * luma Sobel energy inside the research priors in priors.mjs. A fixed template
 * rectangle is never returned as a detection.
 */

import { REGION_EDGES, RESEARCH_PRIORS } from './priors.mjs';

const clamp01 = value => Math.max(0, Math.min(1, value));

export const lumaOf = image => {
  const { data, width, height } = image;
  const luma = new Float32Array(width * height);
  for (let i = 0, p = 0; i < luma.length; i++, p += 4) {
    luma[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return luma;
};

const sobel = (luma, width, height) => {
  const gx = new Float32Array(luma.length);
  const gy = new Float32Array(luma.length);
  const at = (x, y) => luma[y * width + x];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      gx[i] =
        -at(x - 1, y - 1) +
        at(x + 1, y - 1) +
        -2 * at(x - 1, y) +
        2 * at(x + 1, y) +
        -at(x - 1, y + 1) +
        at(x + 1, y + 1);
      gy[i] =
        -at(x - 1, y - 1) -
        2 * at(x, y - 1) -
        at(x + 1, y - 1) +
        at(x - 1, y + 1) +
        2 * at(x, y + 1) +
        at(x + 1, y + 1);
    }
  }
  return { gx, gy };
};

const spanStats = (grad, width, fixed, a0, a1, vertical) => {
  const mid = Math.floor((a0 + a1) / 2);
  let sum = 0;
  let left = 0;
  let right = 0;
  let n = 0;
  let nLeft = 0;
  let nRight = 0;
  const mags = [];
  for (let a = a0; a < a1; a++) {
    const i = vertical ? a * width + fixed : fixed * width + a;
    const g = Math.abs(grad[i]);
    mags.push(g);
    sum += g;
    n += 1;
    if (a < mid) {
      left += g;
      nLeft += 1;
    } else {
      right += g;
      nRight += 1;
    }
  }
  // Absolute Sobel floor. A relative-to-peak test treats a real frame line as broken
  // when one band along it is much higher contrast than the rest.
  const thr = 12;
  let on = 0;
  for (const g of mags) if (g >= thr) on += 1;
  const meanLeft = nLeft ? left / nLeft : 0;
  const meanRight = nRight ? right / nRight : 0;
  const sideAgree =
    Math.max(meanLeft, meanRight) > 1e-3 ? Math.min(meanLeft, meanRight) / Math.max(meanLeft, meanRight) : 0;
  return {
    energy: n ? sum / n : 0,
    continuity: n ? on / n : 0,
    sideAgree,
  };
};

export const horizontalProfile = (luma, width, height) => {
  const { gy } = sobel(luma, width, height);
  const x0 = Math.max(1, Math.floor(width * 0.12));
  const x1 = Math.min(width - 1, Math.ceil(width * 0.88));
  const rows = [];
  for (let y = 1; y < height - 1; y++) {
    rows.push({ t: y / (height - 1), ...spanStats(gy, width, y, x0, x1, false) });
  }
  return rows;
};

export const verticalProfile = (luma, width, height, yLo = 0.18, yHi = 0.7) => {
  const { gx } = sobel(luma, width, height);
  const y0 = Math.max(1, Math.floor(height * yLo));
  const y1 = Math.min(height - 1, Math.ceil(height * yHi));
  const cols = [];
  for (let x = 1; x < width - 1; x++) {
    cols.push({ t: x / (width - 1), ...spanStats(gx, width, x, y0, y1, true) });
  }
  return cols;
};

const sampleProfile = (rows, count = 72) => {
  if (!rows.length) return [];
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    let best = rows[0];
    let bestDist = Infinity;
    for (const row of rows) {
      const dist = Math.abs(row.t - t);
      if (dist < bestDist) {
        best = row;
        bestDist = dist;
      }
    }
    out.push({ t: best.t, energy: best.energy });
  }
  return out;
};

/**
 * Pick one boundary inside a normalized window.
 * `rows` are { t, energy, continuity, sideAgree }, t in 0..1.
 * Score is edge energy × continuity, with a broad Gaussian prior.
 * A short spike cannot beat a long line, and a line outside the window is ignored.
 */
export const pickPeak = (rows, { prior, lo, hi, suppress = [] }) => {
  const windowRows = rows.filter(
    row => row.t >= lo && row.t <= hi && !suppress.some(at => Math.abs(at - row.t) < 0.02),
  );
  const empty = {
    detected: false,
    reason: 'empty-window',
    prior,
    lo,
    hi,
    t: null,
    confidence: 0,
    continuity: 0,
    prominence: 0,
    sideAgree: 0,
  };
  if (windowRows.length < 3) return empty;
  const maxE = Math.max(...windowRows.map(row => row.energy));
  if (maxE < 6) return { ...empty, reason: 'no-energy' };
  const energies = windowRows.map(row => row.energy).sort((a, b) => a - b);
  const median = energies[Math.floor(energies.length / 2)];
  const prominence = (maxE - median) / (maxE + 1e-6);
  const sigma = Math.max(1e-4, (hi - lo) / 3);
  let best = null;
  for (const row of windowRows) {
    const edge = row.energy / maxE;
    const priorW = Math.exp(-0.5 * ((row.t - prior) / sigma) ** 2);
    const score = edge * (0.25 + 0.75 * row.continuity) * (0.7 + 0.3 * priorW);
    if (!best || score > best.score) best = { ...row, score, priorW };
  }
  const continuity = best.continuity ?? 0;
  const sideAgree = best.sideAgree ?? 0;
  const priorAgree = clamp01(1 - Math.abs(best.t - prior) / ((hi - lo) / 2));
  const confidence = clamp01(0.45 * continuity + 0.25 * clamp01(prominence) + 0.15 * priorAgree + 0.15 * sideAgree);
  const base = {
    prior,
    lo,
    hi,
    t: best.t,
    confidence,
    continuity,
    prominence,
    sideAgree,
    priorAgree,
  };
  if (continuity < 0.28) return { ...base, detected: false, reason: 'low-continuity' };
  if (prominence < 0.2) return { ...base, detected: false, reason: 'low-prominence' };
  if (confidence < 0.2) return { ...base, detected: false, reason: 'low-confidence' };
  return { ...base, detected: true, reason: null };
};

const boundaryQuad = (top, bottom, left, right, width, height) => {
  if (!top?.detected || !bottom?.detected || !left?.detected || !right?.detected) return null;
  if (bottom.t <= top.t + 0.012 || right.t <= left.t + 0.02) return null;
  const confidence = Math.min(top.confidence, bottom.confidence, left.confidence, right.confidence);
  if (confidence < 0.2) return null;
  const x0 = left.t * (width - 1);
  const x1 = right.t * (width - 1);
  const y0 = top.t * (height - 1);
  const y1 = bottom.t * (height - 1);
  return {
    quad: {
      tl: [x0, y0],
      tr: [x1, y0],
      br: [x1, y1],
      bl: [x0, y1],
    },
    confidence,
  };
};

const downsample = (luma, width, height, maxW = 180) => {
  const scale = Math.min(1, maxW / width);
  const pw = Math.max(1, Math.round(width * scale));
  const ph = Math.max(1, Math.round(height * scale));
  const gray = Buffer.alloc(pw * ph);
  for (let y = 0; y < ph; y++) {
    const sy = Math.min(height - 1, Math.round((y / Math.max(1, ph - 1)) * (height - 1)));
    for (let x = 0; x < pw; x++) {
      const sx = Math.min(width - 1, Math.round((x / Math.max(1, pw - 1)) * (width - 1)));
      gray[y * pw + x] = Math.max(0, Math.min(255, Math.round(luma[sy * width + sx])));
    }
  }
  return { w: pw, h: ph, gray: gray.toString('base64') };
};

/**
 * Detect internal frame regions on an already-rectified card.
 * Returns canonical-pixel quads. Missing evidence omits the region.
 */
export const detectFrameRegions = image => {
  const { width, height } = image;
  const luma = lumaOf(image);
  const horizontal = horizontalProfile(luma, width, height);
  const hSpecs = RESEARCH_PRIORS.horizontal;
  const boundaries = {};
  const suppress = [];
  for (const id of ['titleTop', 'titleArt', 'artType', 'typeText', 'textFooter', 'footerBottom']) {
    const spec = hSpecs[id];
    const picked = pickPeak(horizontal, { ...spec, suppress });
    boundaries[id] = { id, axis: 'h', ...picked };
    if (picked.detected) suppress.push(picked.t);
  }
  const artTop = boundaries.titleArt.detected ? boundaries.titleArt.t : 0.18;
  const artBottom = boundaries.artType.detected ? boundaries.artType.t : 0.7;
  const vertical = verticalProfile(luma, width, height, artTop, artBottom);
  const vSuppress = [];
  for (const id of ['innerLeft', 'innerRight']) {
    const spec = RESEARCH_PRIORS.vertical[id];
    const picked = pickPeak(vertical, { ...spec, suppress: vSuppress });
    boundaries[id] = { id, axis: 'v', ...picked };
    if (picked.detected) vSuppress.push(picked.t);
  }
  const regions = {};
  for (const [key, edges] of Object.entries(REGION_EDGES)) {
    const region = boundaryQuad(
      boundaries[edges.top],
      boundaries[edges.bottom],
      boundaries[edges.left],
      boundaries[edges.right],
      width,
      height,
    );
    if (region) regions[key] = region;
  }
  return {
    width,
    height,
    regions,
    debug: {
      preview: downsample(luma, width, height),
      horizontalProfile: sampleProfile(horizontal),
      verticalProfile: sampleProfile(vertical),
      boundaries: Object.values(boundaries).map(row => ({
        id: row.id,
        axis: row.axis,
        prior: row.prior,
        lo: row.lo,
        hi: row.hi,
        detected: row.detected,
        t: row.t,
        confidence: row.confidence,
        continuity: row.continuity,
        prominence: row.prominence,
        sideAgree: row.sideAgree,
        reason: row.reason,
      })),
    },
  };
};
