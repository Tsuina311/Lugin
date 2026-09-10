/**
 * Deterministic synthetic scene generation from real card warps.
 */

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createFixture, createCard } from '../schema.mjs';
import { CORPUS_ROOT, rootDir } from '../paths.mjs';
import { discoverCardWarps } from './cards.mjs';
import {
  BACKGROUNDS,
  FRAME,
  LEVELS,
  expandSuite,
} from './suites.mjs';
import { mulberry32 } from './rng.mjs';
import {
  applyBlur,
  applyBrightness,
  applyContrast,
  blankRgba,
  clipVisibleFraction,
  compositeCard,
  expandQuad,
  loadRgba,
  paintGlare,
  paintRectOccluder,
  perspectiveWarpQuad,
  quadToGt,
  rotatedRectQuad,
  savePng,
  shoelaceArea,
} from './compose.mjs';

export const SYNTHETIC_ROOT = join(CORPUS_ROOT, 'synthetic');
export const SYNTHETIC_SCENES = join(SYNTHETIC_ROOT, 'scenes');
export const SYNTHETIC_MANIFEST = join(SYNTHETIC_ROOT, 'manifest.json');

const cardCache = new Map();

const loadCard = async warp => {
  if (cardCache.has(warp.abs)) return cardCache.get(warp.abs);
  const img = await loadRgba(warp.abs);
  cardCache.set(warp.abs, img);
  return img;
};

const placeSingle = (recipe, rng, frameW, frameH) => {
  const scale = LEVELS.scale[recipe.scale || 'medium'];
  const rot = LEVELS.rotation[recipe.rotation || 'none'];
  const persp = LEVELS.perspective[recipe.perspective || 'none'];
  const cardH = frameH * scale;
  const cardW = cardH * (63 / 88);
  let cx = frameW / 2;
  let cy = frameH / 2;
  const pos = recipe.position || 'center';
  if (pos === 'edge') {
    cx = rng() < 0.5 ? cardW * 0.55 : frameW - cardW * 0.55;
    cy = frameH * (0.35 + rng() * 0.3);
  } else if (pos === 'partial') {
    cx = rng() < 0.5 ? cardW * 0.25 : frameW - cardW * 0.25;
    cy = frameH * (0.4 + rng() * 0.2);
  }
  let quad = rotatedRectQuad(cx, cy, cardW, cardH, rot + (rng() - 0.5) * 4);
  quad = perspectiveWarpQuad(quad, persp, rng);
  return quad;
};

const applyOcclusion = (frame, quad, occ) => {
  if (!occ) return { visibleFraction: clipVisibleFraction(quad, frame.width, frame.height) };
  const frac = LEVELS.occlusion[occ.level] ?? 0.2;
  const xs = quad.map(p => p[0]);
  const ys = quad.map(p => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = maxX - minX;
  const h = maxY - minY;
  const pattern = occ.pattern || 'corner';
  if (pattern === 'corner') {
    paintRectOccluder(frame, minX, minY, minX + w * Math.sqrt(frac), minY + h * Math.sqrt(frac));
  } else if (pattern === 'edge-v') {
    paintRectOccluder(frame, minX, minY, minX + w * frac, maxY);
  } else if (pattern === 'edge-h') {
    paintRectOccluder(frame, minX, minY, maxX, minY + h * frac);
  } else {
    const mid = minY + h * 0.5;
    paintRectOccluder(frame, minX, mid - (h * frac) / 2, maxX, mid + (h * frac) / 2);
  }
  return { visibleFraction: Math.max(0, 1 - frac), occluded: true };
};

const layoutQuads = (layout, nCards, rng, frameW, frameH) => {
  const quads = [];
  if (layout === 'binder-3x3') {
    const cols = 3;
    const rows = 3;
    const margin = 40;
    const gap = 16;
    const cellW = (frameW - margin * 2 - gap * (cols - 1)) / cols;
    const cellH = (frameH - margin * 2 - gap * (rows - 1)) / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = margin + c * (cellW + gap) + cellW / 2;
        const cy = margin + r * (cellH + gap) + cellH / 2;
        const cw = cellW * 0.88;
        const ch = cw / (63 / 88);
        quads.push(rotatedRectQuad(cx, cy, cw, Math.min(ch, cellH * 0.9), (rng() - 0.5) * 3));
      }
    }
    return quads;
  }
  if (layout === 'two-separated' || layout === 'scattered-4') {
    const n = layout === 'two-separated' ? 2 : 4;
    for (let i = 0; i < n; i++) {
      const scale = 0.28 + rng() * 0.08;
      const ch = frameH * scale;
      const cw = ch * (63 / 88);
      const cx = frameW * (0.25 + (i % 2) * 0.5 + (rng() - 0.5) * 0.08);
      const cy = frameH * (0.3 + Math.floor(i / 2) * 0.35 + (rng() - 0.5) * 0.05);
      quads.push(rotatedRectQuad(cx, cy, cw, ch, (rng() - 0.5) * 20));
    }
    return quads;
  }
  if (layout === 'overlap-2' || layout === 'overlap-3') {
    const n = layout === 'overlap-2' ? 2 : 3;
    const base = placeSingle(
      { scale: 'medium', rotation: 'mild', perspective: 'mild', position: 'center' },
      rng,
      frameW,
      frameH,
    );
    for (let i = 0; i < n; i++) {
      const shift = i * 55;
      quads.push(base.map(p => [p[0] + shift * 0.7, p[1] + shift * 0.35]));
    }
    return quads;
  }
  // default single
  for (let i = 0; i < Math.max(1, nCards); i++) {
    quads.push(placeSingle({ scale: 'medium', rotation: 'mild', position: 'center' }, rng, frameW, frameH));
  }
  return quads;
};

export const generateScene = async (recipe, warps) => {
  const rng = mulberry32(recipe.seed);
  const frameW = FRAME.width;
  const frameH = FRAME.height;
  const bgKey = recipe.background || 'midgray';
  const bg = BACKGROUNDS[bgKey] || BACKGROUNDS.midgray;
  const frame = blankRgba(frameW, frameH, bg);

  const effects = {
    background: bgKey,
    backgroundRgb: bg,
    brightness: recipe.brightness || 'normal',
    contrast: recipe.contrast || 'normal',
    blur: recipe.blur || 'none',
    glare: recipe.glare || null,
    sleeve: recipe.sleeve || null,
    occlusion: recipe.occlusion || null,
  };

  const cardsOut = [];
  const layout = recipe.layout || 'single';
  const quads =
    layout === 'single'
      ? [placeSingle(recipe, rng, frameW, frameH)]
      : layoutQuads(layout, 1, rng, frameW, frameH);

  // Draw back-to-front for overlap (last on top)
  for (let i = 0; i < quads.length; i++) {
    const warp = warps[(recipe.recipeIndex + i) % warps.length];
    const cardImg = await loadCard(warp);
    let cardQuad = quads[i];
    let sleeveQuad = null;

    if (recipe.sleeve && i === 0) {
      const margin = LEVELS.sleeveMargin[recipe.sleeve.margin] ?? 18;
      sleeveQuad = expandQuad(cardQuad, margin);
      // Draw sleeve as flat color quad first
      const sleeveCard = blankRgba(64, 64, recipe.sleeve.rgb);
      compositeCard(frame, sleeveCard, sleeveQuad);
    }

    compositeCard(frame, cardImg, cardQuad);

    let visibleFraction = clipVisibleFraction(cardQuad, frameW, frameH);
    let occluded = visibleFraction < 0.98;
    if (recipe.occlusion && i === 0) {
      const o = applyOcclusion(frame, cardQuad, recipe.occlusion);
      visibleFraction = o.visibleFraction;
      occluded = Boolean(o.occluded);
    }

    cardsOut.push({
      id: `card-${i + 1}`,
      sourceFixture: warp.id,
      sourcePath: warp.path,
      zIndex: i,
      groundTruthQuad: quadToGt(cardQuad),
      sleeveQuad: sleeveQuad ? quadToGt(sleeveQuad) : null,
      visibleFraction,
      occluded,
      areaPx: shoelaceArea(cardQuad),
      tags: recipe.tags || [],
    });
  }

  if (recipe.glare) {
    const g = recipe.glare;
    paintGlare(frame, {
      cx: frameW * (0.35 + rng() * 0.3),
      cy: frameH * (0.35 + rng() * 0.3),
      angleDeg: g.kind === 'streak' ? 35 + rng() * 40 : rng() * 180,
      length: g.kind === 'band' ? frameW * 0.9 : frameW * 0.45,
      width: g.kind === 'streak' ? 18 : g.kind === 'ellipse' ? 70 : 55,
      opacity: g.opacity ?? 0.45,
    });
  }

  applyBrightness(frame, LEVELS.brightness[effects.brightness] ?? 1);
  applyContrast(frame, LEVELS.contrast[effects.contrast] ?? 1);
  applyBlur(frame, LEVELS.blur[effects.blur] ?? 0);

  const sceneId = `syn_${recipe.suite}_${recipe.difficulty}_${recipe.seed}`
    .replace(/[^\w.-]+/g, '_')
    .slice(0, 120);

  return {
    sceneId,
    seed: recipe.seed,
    suite: recipe.suite,
    family: recipe.family,
    difficulty: recipe.difficulty,
    curveKey: recipe.curveKey ?? null,
    curveValue: recipe.curveValue ?? null,
    width: frameW,
    height: frameH,
    sourceCards: cardsOut.map(c => c.sourceFixture),
    cards: cardsOut,
    effects,
    tags: [...new Set([...(recipe.tags || []), 'synthetic'])],
    image: frame,
    layout,
  };
};

export const writeSceneArtifacts = async (scene, { writeImage = true } = {}) => {
  await mkdir(SYNTHETIC_SCENES, { recursive: true });
  const dir = join(SYNTHETIC_SCENES, scene.sceneId);
  await mkdir(dir, { recursive: true });
  const relImage = `.geometry-corpus/synthetic/scenes/${scene.sceneId}/scene.png`;
  if (writeImage) {
    await savePng(join(rootDir, relImage), scene.image);
  }
  const manifest = {
    schemaVersion: 1,
    kind: 'synthetic-geometry-scene',
    sceneId: scene.sceneId,
    seed: scene.seed,
    suite: scene.suite,
    family: scene.family,
    difficulty: scene.difficulty,
    curveKey: scene.curveKey,
    curveValue: scene.curveValue,
    width: scene.width,
    height: scene.height,
    sourceCards: scene.sourceCards,
    layout: scene.layout,
    effects: scene.effects,
    tags: scene.tags,
    cards: scene.cards.map(c => ({
      id: c.id,
      sourceFixture: c.sourceFixture,
      sourcePath: c.sourcePath,
      zIndex: c.zIndex,
      quad: c.groundTruthQuad,
      sleeveQuad: c.sleeveQuad,
      visibleFraction: c.visibleFraction,
      occluded: c.occluded,
      areaPx: c.areaPx,
      tags: c.tags,
    })),
    image: relImage,
    note: 'Synthetic stress scene. Exact GT from known transforms. NOT real-device accuracy.',
  };
  await writeFile(join(dir, 'scene.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const fixture = createFixture({
    id: scene.sceneId,
    image: relImage,
    imageWidth: scene.width,
    imageHeight: scene.height,
    source: 'unknown',
    seriesId: scene.suite,
    captureGroup: `synthetic:${scene.suite}:${scene.seed}`,
    trusted: true,
    hardRegression: false,
    negative: false,
    split: 'train',
    tags: scene.tags,
    label: `${scene.suite}/${scene.difficulty}`,
    notes: 'SYNTHETIC — exact GT from transforms; never mix with trusted-real accuracy.',
    provenance: {
      groundTruthSource: 'synthetic',
      suite: scene.suite,
      seed: scene.seed,
      curveKey: scene.curveKey,
      curveValue: scene.curveValue,
      mlCompatible: true,
    },
    cards: scene.cards.map(c =>
      createCard({
        id: c.id,
        groundTruthQuad: c.groundTruthQuad,
        sleeveQuad: c.sleeveQuad,
        visibleFraction: c.visibleFraction,
        zIndex: c.zIndex,
        visibility: c.visibleFraction >= 0.95 ? 'full' : 'partial',
        occluded: c.occluded,
        tags: c.tags,
        groundTruthSource: 'synthetic',
        label: c.sourceFixture,
      }),
    ),
  });
  // Override source field — schema may not list synthetic; store as unknown + tags
  fixture.synthetic = true;
  fixture.suite = scene.suite;
  await writeFile(join(dir, 'fixture.json'), `${JSON.stringify(fixture, null, 2)}\n`);
  return { manifest, fixture, dir };
};

export const generateSuite = async ({
  suite = 'dark',
  count = 40,
  seed = 42,
  writeImages = true,
  cardLimit = 24,
} = {}) => {
  const warps = await discoverCardWarps({ limit: cardLimit });
  if (!warps.length) {
    throw new Error('No card warps found under .scan-fixtures/replay or .scan-inbox');
  }
  const recipes = expandSuite(suite, { count, seed });
  await mkdir(SYNTHETIC_ROOT, { recursive: true });
  const entries = [];
  for (const recipe of recipes) {
    const scene = await generateScene(recipe, warps);
    const { manifest, fixture } = await writeSceneArtifacts(scene, { writeImage: writeImages });
    entries.push({
      sceneId: scene.sceneId,
      suite: scene.suite,
      family: scene.family,
      difficulty: scene.difficulty,
      curveKey: scene.curveKey,
      curveValue: scene.curveValue,
      seed: scene.seed,
      fixturePath: `.geometry-corpus/synthetic/scenes/${scene.sceneId}/fixture.json`,
      image: manifest.image,
      cardCount: scene.cards.length,
      tags: scene.tags,
    });
  }
  const index = {
    generatedAt: new Date().toISOString(),
    suite,
    seed,
    count: entries.length,
    warpsUsed: warps.map(w => w.id),
    note: 'Deterministic synthetic stress corpus. Replay via yarn geometry:synthetic:replay <sceneId>.',
    scenes: entries,
  };
  await writeFile(SYNTHETIC_MANIFEST, `${JSON.stringify(index, null, 2)}\n`);
  // Also write suite-specific pointer
  await writeFile(
    join(SYNTHETIC_ROOT, `suite-${suite}.json`),
    `${JSON.stringify(index, null, 2)}\n`,
  );
  return index;
};

export const loadSyntheticFixtures = async ({ suite = null } = {}) => {
  const { readFile } = await import('node:fs/promises');
  const path = suite
    ? join(SYNTHETIC_ROOT, `suite-${suite}.json`)
    : SYNTHETIC_MANIFEST;
  if (!existsSync(path)) return [];
  const index = JSON.parse(await readFile(path, 'utf8'));
  const fixtures = [];
  for (const s of index.scenes ?? []) {
    const fp = join(rootDir, s.fixturePath);
    if (!existsSync(fp)) continue;
    const fixture = JSON.parse(await readFile(fp, 'utf8'));
    // Merge sleeveQuad / visibility from scene.json when older fixtures omitted them.
    const scenePath = join(rootDir, s.scenePath || s.fixturePath.replace(/fixture\.json$/, 'scene.json'));
    if (existsSync(scenePath)) {
      try {
        const scene = JSON.parse(await readFile(scenePath, 'utf8'));
        for (let i = 0; i < (fixture.cards ?? []).length; i++) {
          const sc = scene.cards?.[i];
          if (!sc) continue;
          if (sc.sleeveQuad && !fixture.cards[i].sleeveQuad) {
            fixture.cards[i].sleeveQuad = sc.sleeveQuad;
          }
          if (sc.visibleFraction != null && fixture.cards[i].visibleFraction == null) {
            fixture.cards[i].visibleFraction = sc.visibleFraction;
          }
          if (sc.zIndex != null && fixture.cards[i].zIndex == null) {
            fixture.cards[i].zIndex = sc.zIndex;
          }
          if (sc.occluded != null) fixture.cards[i].occluded = sc.occluded;
        }
        fixture.suite = fixture.suite || scene.suite;
      } catch {
        /* ignore */
      }
    }
    fixtures.push(fixture);
  }
  return fixtures;
};

export const replayScene = async sceneId => {
  const dir = join(SYNTHETIC_SCENES, sceneId);
  const scenePath = join(dir, 'scene.json');
  if (!existsSync(scenePath)) throw new Error(`unknown scene ${sceneId}`);
  const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(scenePath, 'utf8'));
  // Regenerate from seed+suite recipe approximation by re-running generate with same seed
  const warps = await discoverCardWarps({ limit: 40 });
  const recipe = {
    suite: manifest.suite,
    family: manifest.family,
    difficulty: manifest.difficulty,
    background: manifest.effects?.background,
    glare: manifest.effects?.glare,
    sleeve: manifest.effects?.sleeve,
    occlusion: manifest.effects?.occlusion,
    layout: manifest.layout === 'single' ? undefined : manifest.layout,
    seed: manifest.seed,
    recipeIndex: 0,
    tags: manifest.tags,
    scale: 'medium',
    rotation: 'mild',
    perspective: 'mild',
    position: 'center',
    curveKey: manifest.curveKey,
    curveValue: manifest.curveValue,
  };
  // For dark suite restore difficulty-linked background
  if (manifest.suite === 'dark' && manifest.effects?.background) {
    recipe.background = manifest.effects.background;
    recipe.rotation = 'none';
    recipe.perspective = 'none';
  }
  const scene = await generateScene(recipe, warps);
  scene.sceneId = sceneId;
  await writeSceneArtifacts(scene, { writeImage: true });
  return { manifest, regenerated: true, image: join(dir, 'scene.png') };
};
