/**
 * Binder page compositor for diagnosis — permutations, gaps, pockets, rotations.
 */

import { join } from 'node:path';

import { CORPUS_ROOT, rootDir } from '../paths.mjs';
import { discoverCardWarps } from '../synthetic/cards.mjs';
import {
  blankRgba,
  compositeCard,
  loadRgba,
  paintRectOccluder,
  quadToGt,
  rotatedRectQuad,
  savePng,
} from '../synthetic/compose.mjs';
import { hashSeed, mulberry32 } from '../synthetic/rng.mjs';
import { BACKGROUNDS, FRAME } from '../synthetic/suites.mjs';

export const DIAG_ROOT = join(CORPUS_ROOT, 'synthetic/binder-diagnose');

const cardCache = new Map();
export const loadWarp = async warp => {
  if (cardCache.has(warp.abs)) return cardCache.get(warp.abs);
  const img = await loadRgba(warp.abs);
  cardCache.set(warp.abs, img);
  return img;
};

/** Infer light tags from warp id/label only — no guessing. */
export const tagsFromWarp = warp => {
  const s = `${warp.id} ${warp.label}`.toLowerCase();
  const tags = [];
  if (/\bfoil\b/.test(s)) tags.push('foil');
  if (/\bunsleeved\b/.test(s)) tags.push('unsleeved');
  if (/\bsleeve/.test(s)) tags.push('sleeved');
  if (/\bfrench\b|lames|l-zard|foyer/.test(s)) tags.push('language-fr');
  if (/\bitalian\b|svignarsela|retro/.test(s)) tags.push('language-it');
  if (/\bhex\b|showcase|alt.?art/.test(s)) tags.push('showcase');
  if (/\bveil\b|old.?edition|teferi|federica/.test(s)) tags.push('classic-frame');
  return tags;
};

export const slotRowCol = slot => ({ row: Math.floor(slot / 3), col: slot % 3 });

/**
 * Layout 9 card quads in a 3×3 grid.
 * @param {number} gapPx inter-card gap
 * @param {number} rotationDeg page rotation about center (0/90/180/270)
 * @param {boolean} mirror horizontal mirror before rotation
 */
export const layoutBinderQuads = (
  frameW,
  frameH,
  { gapPx = 16, marginPx = 40, rotationDeg = 0, mirror = false } = {},
) => {
  const cols = 3;
  const rows = 3;
  const cellW = (frameW - marginPx * 2 - gapPx * (cols - 1)) / cols;
  const cellH = (frameH - marginPx * 2 - gapPx * (rows - 1)) / rows;
  const quads = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = marginPx + c * (cellW + gapPx) + cellW / 2;
      const cy = marginPx + r * (cellH + gapPx) + cellH / 2;
      const cw = cellW * 0.9;
      const ch = Math.min(cw / (63 / 88), cellH * 0.92);
      quads.push(rotatedRectQuad(cx, cy, cw, ch, 0));
    }
  }
  const cx = frameW / 2;
  const cy = frameH / 2;
  const transformPt = p => {
    let [x, y] = p;
    if (mirror) x = frameW - x;
    if (rotationDeg) {
      const rad = (rotationDeg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const dx = x - cx;
      const dy = y - cy;
      x = cx + dx * cos - dy * sin;
      y = cy + dx * sin + dy * cos;
    }
    return [x, y];
  };
  return quads.map(q => q.map(transformPt));
};

const paintPocketLines = (frame, quads, strength = 'faint') => {
  const alpha = strength === 'strong' ? 0.55 : 0.22;
  const rgb = strength === 'strong' ? [200, 200, 210] : [90, 90, 100];
  for (const q of quads) {
    const xs = q.map(p => p[0]);
    const ys = q.map(p => p[1]);
    const pad = 6;
    const x0 = Math.min(...xs) - pad;
    const x1 = Math.max(...xs) + pad;
    const y0 = Math.min(...ys) - pad;
    const y1 = Math.max(...ys) + pad;
    // draw as thin border via 4 rects
    const t = 2;
    paintRectOccluder(frame, x0, y0, x1, y0 + t, rgb);
    paintRectOccluder(frame, x0, y1 - t, x1, y1, rgb);
    paintRectOccluder(frame, x0, y0, x0 + t, y1, rgb);
    paintRectOccluder(frame, x1 - t, y0, x1, y1, rgb);
    void alpha;
  }
};

/**
 * @param {object[]} warps length 9 assignment order = slots 0..8
 */
export const renderBinderPage = async (
  warps9,
  {
    id,
    gapPx = 16,
    rotationDeg = 0,
    mirror = false,
    pockets = 'none', // none|faint|strong
    occupiedSlots = null, // null = all 9; else Set of slots to draw
    writeImage = true,
  } = {},
) => {
  const w = FRAME.width;
  const h = FRAME.height;
  const frame = blankRgba(w, h, BACKGROUNDS.darkgray);
  const quads = layoutBinderQuads(w, h, { gapPx, rotationDeg, mirror });
  if (pockets !== 'none') paintPocketLines(frame, quads, pockets);

  const cards = [];
  for (let slot = 0; slot < 9; slot++) {
    if (occupiedSlots && !occupiedSlots.has(slot)) continue;
    const warp = warps9[slot];
    if (!warp) continue;
    const img = await loadWarp(warp);
    const quad = quads[slot];
    compositeCard(frame, img, quad);
    const { row, col } = slotRowCol(slot);
    cards.push({
      id: `slot-${slot}`,
      slot,
      row,
      col,
      sourceWarp: warp.id,
      tags: tagsFromWarp(warp),
      groundTruthQuad: quadToGt(quad),
      groundTruthSource: 'synthetic',
      visibility: 'full',
      occluded: false,
    });
  }

  const relImage = `.geometry-corpus/synthetic/binder-diagnose/pages/${id}.png`;
  if (writeImage) {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(rootDir, '.geometry-corpus/synthetic/binder-diagnose/pages'), {
      recursive: true,
    });
    await savePng(join(rootDir, relImage), frame);
  }

  const fixture = {
    schemaVersion: 1,
    id,
    image: relImage,
    imageWidth: w,
    imageHeight: h,
    source: 'unknown',
    trusted: true,
    synthetic: true,
    suite: 'binder-diagnose',
    tags: ['synthetic', 'binder', 'multi-card', 'binder-diagnose'],
    cards,
    provenance: {
      groundTruthSource: 'synthetic',
      gapPx,
      rotationDeg,
      mirror,
      pockets,
      note: 'SYNTHETIC binder diagnose — not real-device accuracy.',
    },
  };
  return { fixture, frame, quads };
};

/** Deterministic permutations: identity + rotations of assignment + random shuffles. */
export const generateAssignments = (warps, { count = 30, seed = 42 } = {}) => {
  const nine = warps.slice(0, 9);
  if (nine.length < 9) throw new Error('Need ≥9 warps');
  const out = [];
  // Latin-ish: cyclic shifts
  for (let s = 0; s < 9 && out.length < count; s++) {
    out.push({
      id: `perm-cycle-${s}`,
      warps: Array.from({ length: 9 }, (_, i) => nine[(i + s) % 9]),
      kind: 'cycle',
    });
  }
  // Reverse
  out.push({ id: 'perm-reverse', warps: [...nine].reverse(), kind: 'reverse' });
  // Random shuffles
  const rng = mulberry32(seed);
  while (out.length < count) {
    const arr = [...nine];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    out.push({
      id: `perm-shuffle-${out.length}`,
      warps: arr,
      kind: 'shuffle',
    });
  }
  return out.slice(0, count);
};

export { FRAME, hashSeed, mulberry32 };
