/**
 * Named difficulty levels + suite definitions for synthetic geometry stress.
 */

export const FRAME = { width: 720, height: 1280 };

export const BACKGROUNDS = {
  white: [245, 245, 245],
  midgray: [128, 128, 128],
  darkgray: [64, 64, 64],
  nearblack: [16, 16, 16],
  black: [5, 5, 5],
  // dark sweep for contrast collapse
  bg808080: [0x80, 0x80, 0x80],
  bg404040: [0x40, 0x40, 0x40],
  bg202020: [0x20, 0x20, 0x20],
  bg101010: [0x10, 0x10, 0x10],
  bg050505: [0x05, 0x05, 0x05],
};

export const LEVELS = {
  rotation: {
    none: 0,
    mild: 12,
    medium: 28,
    severe: 42,
  },
  perspective: {
    none: 0,
    mild: 0.2,
    medium: 0.45,
    severe: 0.75,
  },
  scale: {
    small: 0.28,
    medium: 0.42,
    large: 0.58,
  },
  blur: {
    none: 0,
    mild: 1.2,
    moderate: 2.5,
  },
  brightness: {
    underexposed: 0.55,
    normal: 1,
    overexposed: 1.45,
  },
  contrast: {
    reduced: 0.55,
    normal: 1,
  },
  occlusion: {
    p05: 0.05,
    p10: 0.1,
    p20: 0.2,
    p30: 0.3,
    p40: 0.4,
  },
  sleeveMargin: {
    thin: 8,
    medium: 18,
    thick: 32,
  },
};

/** Suite → list of scene recipe factories (pure params). */
export const SUITE_RECIPES = {
  dark: () =>
    ['bg808080', 'bg404040', 'bg202020', 'bg101010', 'bg050505'].map((bg, i) => ({
      suite: 'dark',
      family: 'dark-background',
      difficulty: bg,
      background: bg,
      scale: 'medium',
      rotation: 'none',
      perspective: 'none',
      position: 'center',
      curveKey: 'background',
      curveValue: [0x80, 0x40, 0x20, 0x10, 0x05][i],
      tags: ['synthetic', 'dark-background', 'synthetic-dark'],
    })),

  perspective: () =>
    ['none', 'mild', 'medium', 'severe'].map(p => ({
      suite: 'perspective',
      family: 'perspective',
      difficulty: p,
      background: 'midgray',
      scale: 'medium',
      rotation: 'mild',
      perspective: p,
      position: 'center',
      curveKey: 'perspective',
      curveValue: LEVELS.perspective[p],
      tags: ['synthetic', 'perspective', 'synthetic-perspective'],
    })),

  glare: () =>
    ['band', 'streak', 'ellipse'].flatMap(kind =>
      [0.25, 0.45, 0.7].map(opacity => ({
        suite: 'glare',
        family: 'glare',
        difficulty: `${kind}-${opacity}`,
        background: 'darkgray',
        scale: 'medium',
        rotation: 'mild',
        perspective: 'mild',
        position: 'center',
        glare: { kind, opacity },
        curveKey: 'glareOpacity',
        curveValue: opacity,
        tags: ['synthetic', 'glare', 'synthetic-glare'],
      })),
    ),

  sleeve: () =>
    ['thin', 'medium', 'thick'].flatMap(margin =>
      [
        { contrast: 'light', rgb: [220, 220, 230] },
        { contrast: 'dark', rgb: [30, 30, 35] },
      ].map(sleeve => ({
        suite: 'sleeve',
        family: 'sleeve',
        difficulty: `${margin}-${sleeve.contrast}`,
        background: 'midgray',
        scale: 'medium',
        rotation: 'mild',
        perspective: 'mild',
        position: 'center',
        sleeve: { margin, rgb: sleeve.rgb, contrast: sleeve.contrast },
        curveKey: 'sleeveMargin',
        curveValue: LEVELS.sleeveMargin[margin],
        tags: ['synthetic', 'sleeved', 'synthetic-sleeve'],
      })),
    ),

  occlusion: () =>
    ['p05', 'p10', 'p20', 'p30', 'p40'].flatMap(occ =>
      ['corner', 'edge-v', 'edge-h', 'center-strip'].map(pattern => ({
        suite: 'occlusion',
        family: 'occlusion',
        difficulty: `${occ}-${pattern}`,
        background: 'midgray',
        scale: 'medium',
        rotation: 'none',
        perspective: 'none',
        position: 'center',
        occlusion: { level: occ, pattern },
        curveKey: 'occlusion',
        curveValue: LEVELS.occlusion[occ],
        tags: ['synthetic', 'partial', 'synthetic-occlusion'],
      })),
    ),

  binder: () => [
    {
      suite: 'binder',
      family: 'multi-card',
      difficulty: 'grid-3x3',
      layout: 'binder-3x3',
      background: 'darkgray',
      tags: ['synthetic', 'binder', 'multi-card', 'synthetic-binder'],
    },
  ],

  overlap: () => [
    {
      suite: 'overlap',
      family: 'multi-card',
      difficulty: 'overlap-2',
      layout: 'overlap-2',
      background: 'midgray',
      tags: ['synthetic', 'overlap', 'multi-card', 'synthetic-overlap'],
    },
    {
      suite: 'overlap',
      family: 'multi-card',
      difficulty: 'overlap-3',
      layout: 'overlap-3',
      background: 'midgray',
      tags: ['synthetic', 'overlap', 'multi-card', 'synthetic-overlap'],
    },
  ],

  scattered: () => [
    {
      suite: 'scattered',
      family: 'multi-card',
      difficulty: 'two-separated',
      layout: 'two-separated',
      background: 'midgray',
      tags: ['synthetic', 'multi-card'],
    },
    {
      suite: 'scattered',
      family: 'multi-card',
      difficulty: 'scattered-4',
      layout: 'scattered-4',
      background: 'darkgray',
      tags: ['synthetic', 'multi-card'],
    },
  ],
};

export const expandSuite = (name, { count, seed }) => {
  const key = name === 'all' ? null : name;
  const names = key ? [key] : Object.keys(SUITE_RECIPES);
  const recipes = [];
  for (const n of names) {
    const fn = SUITE_RECIPES[n];
    if (!fn) throw new Error(`unknown suite: ${n}`);
    recipes.push(...fn());
  }
  // Repeat recipes with different card indices until count
  const out = [];
  let i = 0;
  while (out.length < count) {
    const base = recipes[i % recipes.length];
    out.push({
      ...base,
      recipeIndex: i,
      seed: (seed + i * 9973) >>> 0,
    });
    i += 1;
    if (i > count * 4) break;
  }
  return out.slice(0, count);
};
