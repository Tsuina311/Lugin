/**
 * Synthetic binder temporal sequences — camera sweep over a fixed page.
 * SYNTHETIC TEMPORAL STRESS — not real-device accuracy.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { CORPUS_ROOT, rootDir } from '../paths.mjs';
import { discoverCardWarps } from '../synthetic/cards.mjs';
import {
  applyBrightness,
  blankRgba,
  compositeCard,
  loadRgba,
  paintGlare,
  perspectiveWarpQuad,
  quadToGt,
  rotatedRectQuad,
  savePng,
} from '../synthetic/compose.mjs';
import { mulberry32, hashSeed } from '../synthetic/rng.mjs';
import { BACKGROUNDS, FRAME } from '../synthetic/suites.mjs';

export const TEMPORAL_ROOT = join(CORPUS_ROOT, 'synthetic/temporal');

export const MOTION = {
  STATIC: { trans: 0, rot: 0, persp: 0, scale: 0, bright: 0 },
  LOW: { trans: 12, rot: 2.5, persp: 0.04, scale: 0.02, bright: 0.04 },
  MEDIUM: { trans: 28, rot: 6, persp: 0.1, scale: 0.05, bright: 0.08 },
  HIGH: { trans: 55, rot: 12, persp: 0.18, scale: 0.09, bright: 0.14 },
};

const cardCache = new Map();
const loadCard = async warp => {
  if (cardCache.has(warp.abs)) return cardCache.get(warp.abs);
  const img = await loadRgba(warp.abs);
  cardCache.set(warp.abs, img);
  return img;
};

/** Fixed 3×3 binder page in canonical frame coordinates. */
const buildBinderPage = async (warps, seed) => {
  const rng = mulberry32(seed);
  const w = FRAME.width;
  const h = FRAME.height;
  const bg = BACKGROUNDS.darkgray;
  const page = blankRgba(w, h, bg);
  const cols = 3;
  const rows = 3;
  const margin = 40;
  const gap = 16;
  const cellW = (w - margin * 2 - gap * (cols - 1)) / cols;
  const cellH = (h - margin * 2 - gap * (rows - 1)) / rows;
  const cards = [];
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const warp = warps[i % warps.length];
      const img = await loadCard(warp);
      const cx = margin + c * (cellW + gap) + cellW / 2;
      const cy = margin + r * (cellH + gap) + cellH / 2;
      const cw = cellW * 0.88;
      const ch = Math.min(cw / (63 / 88), cellH * 0.9);
      const quad = rotatedRectQuad(cx, cy, cw, ch, (rng() - 0.5) * 2);
      compositeCard(page, img, quad);
      cards.push({
        id: `card-${r}-${c}`,
        slot: r * 3 + c,
        row: r,
        col: c,
        sourceWarp: warp.id,
        worldQuad: quad.map(p => [...p]),
      });
      i += 1;
    }
  }
  return { page, cards, width: w, height: h };
};

/** Camera pose for frame t ∈ [0,1]: translation, rotation, scale, mild perspective. */
const cameraPose = (t, motion, rng) => {
  const m = MOTION[motion] || MOTION.MEDIUM;
  // Sweep path: pan across binder so corner/edge cards move toward frame center over time.
  // This is the product-relevant motion (hand scanning a page), not pure jitter.
  const panX = Math.sin((t - 0.5) * Math.PI) * (m.trans * 2.2 + (motion === 'STATIC' ? 0 : 40));
  const panY = Math.cos((t - 0.5) * Math.PI * 0.85) * (m.trans * 1.4 + (motion === 'STATIC' ? 0 : 25));
  const s = Math.sin(t * Math.PI);
  const c = Math.cos(t * Math.PI * 2);
  return {
    tx: panX + m.trans * 0.25 * c,
    ty: panY + m.trans * 0.2 * s,
    rotDeg: m.rot * Math.sin(t * Math.PI * 1.1),
    scale: 1 + m.scale * Math.sin(t * Math.PI * 0.9),
    persp: m.persp * (0.5 + 0.5 * Math.sin(t * Math.PI)),
    bright: 1 + m.bright * Math.sin(t * Math.PI * 1.7),
  };
};

const transformPoint = (p, pose, w, h) => {
  const cx = w / 2;
  const cy = h / 2;
  let x = p[0] - cx;
  let y = p[1] - cy;
  const rad = (pose.rotDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const xr = (x * cos - y * sin) * pose.scale;
  const yr = (x * sin + y * cos) * pose.scale;
  x = xr + cx + pose.tx;
  y = yr + cy + pose.ty;
  return [x, y];
};

const transformQuad = (quad, pose, w, h, rng) => {
  let q = quad.map(p => transformPoint(p, pose, w, h));
  if (pose.persp > 0.001) {
    q = perspectiveWarpQuad(q, pose.persp, rng);
  }
  return q;
};

/** Moving glare: ellipse that travels across binder slots as t progresses. */
const glareForFrame = (t, mode, cards, w, h) => {
  if (mode === 'none' || !mode) return null;
  const slots = cards.length;
  if (mode === 'static') {
    // Permanently obscure slot 4 (center)
    const card = cards[4] || cards[0];
    const xs = card.worldQuad.map(p => p[0]);
    const ys = card.worldQuad.map(p => p[1]);
    return {
      cx: (Math.min(...xs) + Math.max(...xs)) / 2,
      cy: (Math.min(...ys) + Math.max(...ys)) / 2,
      angleDeg: 35,
      length: 180,
      width: 70,
      opacity: 0.75,
      targetSlot: card.slot,
    };
  }
  // moving: sweep across slots 0→8
  const idx = Math.min(slots - 1, Math.floor(t * (slots - 0.01)));
  const card = cards[idx];
  const xs = card.worldQuad.map(p => p[0]);
  const ys = card.worldQuad.map(p => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  // Extra drift with t for coherence with camera
  return {
    cx: cx + Math.sin(t * Math.PI * 2) * 20,
    cy: cy + Math.cos(t * Math.PI * 2) * 15,
    angleDeg: 25 + t * 40,
    length: 160,
    width: 55,
    opacity: 0.65,
    targetSlot: card.slot,
  };
};

const copyImage = img => ({
  data: new Uint8ClampedArray(img.data),
  width: img.width,
  height: img.height,
});

/**
 * Generate one deterministic binder sweep sequence.
 *
 * @param {object} opts
 * @param {number} opts.seed
 * @param {string} opts.motion STATIC|LOW|MEDIUM|HIGH
 * @param {string} opts.glare none|static|moving
 * @param {number} opts.frames
 * @param {number} opts.fps assumed presentation cadence
 */
export const generateBinderSequence = async ({
  seed = 42,
  motion = 'MEDIUM',
  glare = 'moving',
  frames = 15,
  fps = 15,
  writeImages = true,
  warpOrder = null,
} = {}) => {
  const warpsAll = await discoverCardWarps({ limit: 24 });
  if (warpsAll.length < 9) throw new Error('Need ≥9 card warps for binder sequence');

  // Permute warp assignment by seed (or use explicit order) so temporal pages vary.
  let warps = warpOrder ? [...warpOrder] : [...warpsAll];
  if (!warpOrder) {
    const rngShuffle = mulberry32(hashSeed(seed, 'warp-order'));
    for (let i = warps.length - 1; i > 0; i--) {
      const j = Math.floor(rngShuffle() * (i + 1));
      [warps[i], warps[j]] = [warps[j], warps[i]];
    }
  }
  warps = warps.slice(0, Math.max(9, warps.length));

  const pageSeed = hashSeed(seed, 'page');
  const { page, cards, width, height } = await buildBinderPage(warps, pageSeed);
  const seqId = `bindersweep_${motion}_${glare}_${seed}`;
  const seqDir = join(TEMPORAL_ROOT, seqId);
  await mkdir(seqDir, { recursive: true });

  const frameManifests = [];
  for (let fi = 0; fi < frames; fi++) {
    const t = frames <= 1 ? 0 : fi / (frames - 1);
    const rng = mulberry32(hashSeed(seed, 'frame', fi));
    const pose = cameraPose(t, motion, mulberry32(hashSeed(seed, 'pose', fi)));
    const frame = copyImage(page);

    // Apply camera by resampling via per-pixel inverse would be slow;
    // instead re-composite cards at transformed quads (exact GT).
    const bg = blankRgba(width, height, BACKGROUNDS.darkgray);
    const frameCards = [];
    for (let ci = 0; ci < cards.length; ci++) {
      const card = cards[ci];
      const warp = warps[ci % warps.length];
      const img = await loadCard(warp);
      const quad = transformQuad(card.worldQuad, pose, width, height, rng);
      compositeCard(bg, img, quad);
      frameCards.push({
        id: card.id,
        slot: card.slot,
        row: card.row,
        col: card.col,
        sourceWarp: card.sourceWarp,
        groundTruthQuad: quadToGt(quad),
        visibleFraction: 1,
        occluded: false,
      });
    }

    // Glare in world then transform center approximately, or paint in frame space on transformed slots
    const gWorld = glareForFrame(t, glare, cards, width, height);
    if (gWorld) {
      const gPose = {
        ...gWorld,
        cx: transformPoint([gWorld.cx, gWorld.cy], pose, width, height)[0],
        cy: transformPoint([gWorld.cx, gWorld.cy], pose, width, height)[1],
      };
      paintGlare(bg, gPose);
      // Mark target card as glare-occluded for diagnostics (not GT-hard)
      const tgt = frameCards.find(c => c.slot === gWorld.targetSlot);
      if (tgt) {
        tgt.glareHit = true;
        tgt.tags = ['synthetic-glare-hit'];
      }
    }

    if (Math.abs(pose.bright - 1) > 0.01) applyBrightness(bg, pose.bright);

    const frameId = `${seqId}_f${String(fi).padStart(2, '0')}`;
    const relImage = `.geometry-corpus/synthetic/temporal/${seqId}/frame-${String(fi).padStart(2, '0')}.png`;
    if (writeImages) await savePng(join(rootDir, relImage), bg);

    const fixture = {
      schemaVersion: 1,
      id: frameId,
      image: relImage,
      imageWidth: width,
      imageHeight: height,
      source: 'unknown',
      trusted: true,
      synthetic: true,
      temporal: true,
      suite: 'binder-temporal',
      sequenceId: seqId,
      frameIndex: fi,
      tags: [
        'synthetic',
        'binder',
        'multi-card',
        'synthetic-temporal',
        `motion-${motion}`,
        `glare-${glare}`,
      ],
      cards: frameCards.map(c => ({
        id: c.id,
        groundTruthQuad: c.groundTruthQuad,
        groundTruthSource: 'synthetic',
        visibility: 'full',
        occluded: Boolean(c.glareHit),
        tags: c.tags || [],
        slot: c.slot,
        glareHit: Boolean(c.glareHit),
      })),
      provenance: {
        groundTruthSource: 'synthetic',
        temporal: true,
        motion,
        glare,
        seed,
        pose,
        note: 'SYNTHETIC TEMPORAL STRESS — not real-device accuracy.',
      },
    };
    await writeFile(join(seqDir, `frame-${String(fi).padStart(2, '0')}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
    frameManifests.push({
      frameIndex: fi,
      t,
      timeSec: fi / fps,
      frameId,
      fixturePath: `.geometry-corpus/synthetic/temporal/${seqId}/frame-${String(fi).padStart(2, '0')}.json`,
      image: relImage,
      pose,
      glareSlot: gWorld?.targetSlot ?? null,
    });
  }

  const manifest = {
    kind: 'synthetic-binder-temporal',
    note: 'SYNTHETIC TEMPORAL STRESS. Fixed binder page + camera sweep + optional moving glare.',
    sequenceId: seqId,
    seed,
    motion,
    glare,
    frames,
    fps,
    width,
    height,
    cardCount: 9,
    cards: cards.map(c => ({ id: c.id, slot: c.slot, row: c.row, col: c.col, sourceWarp: c.sourceWarp })),
    frameManifests,
    generatedAt: new Date().toISOString(),
  };
  await writeFile(join(seqDir, 'sequence.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, seqDir, fixtures: frameManifests };
};

export const generateTemporalMatrix = async ({
  seed = 42,
  frames = 15,
  fps = 15,
  writeImages = true,
} = {}) => {
  const combos = [
    { motion: 'STATIC', glare: 'none' },
    { motion: 'LOW', glare: 'moving' },
    { motion: 'MEDIUM', glare: 'none' },
    { motion: 'MEDIUM', glare: 'static' },
    { motion: 'MEDIUM', glare: 'moving' },
    { motion: 'HIGH', glare: 'moving' },
  ];
  const sequences = [];
  for (let i = 0; i < combos.length; i++) {
    const c = combos[i];
    const r = await generateBinderSequence({
      seed: hashSeed(seed, c.motion, c.glare, i),
      motion: c.motion,
      glare: c.glare,
      frames,
      fps,
      writeImages,
    });
    sequences.push(r.manifest);
  }
  const index = {
    kind: 'temporal-matrix',
    seed,
    frames,
    fps,
    sequences: sequences.map(s => ({
      sequenceId: s.sequenceId,
      motion: s.motion,
      glare: s.glare,
      path: `.geometry-corpus/synthetic/temporal/${s.sequenceId}/sequence.json`,
    })),
    generatedAt: new Date().toISOString(),
  };
  await mkdir(TEMPORAL_ROOT, { recursive: true });
  await writeFile(join(TEMPORAL_ROOT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  return index;
};
