/**
 * Synthetic scene generator interface — design only.
 *
 * Exact ground-truth quads come free from known transforms.
 * Synthetic must NEVER replace the real-device test set.
 */

export const SYNTHETIC_INTERFACE = {
  version: 1,
  status: 'scaffold',
  principle: 'synthetic images must never replace the real-device test set',
  input: {
    cardImage: 'RGBA ScanImage or path to flat card art',
    rngSeed: 'number — deterministic scenes',
  },
  transforms: [
    'rotation',
    'perspective',
    'scale',
    'background-dark',
    'background-light',
    'blur',
    'brightness',
    'shadows',
    'simulated-glare',
    'partial-occlusion',
    'multi-card',
    'overlapping-cards',
  ],
  output: {
    image: 'RGBA frame',
    fixture: 'geometry fixture schema v1 with groundTruthSource=synthetic, trusted=true for synthetic-only split',
  },
};

/**
 * @param {object} _opts
 * @returns {{ ok: false, reason: string }}
 */
export const generateSyntheticScene = (_opts = {}) => ({
  ok: false,
  reason:
    'Synthetic generator not implemented yet — interface only. Use real-device fixtures for trusted test.',
});

export const documentSyntheticWorkflow = () => `
SYNTHETIC DATA (future)
───────────────────────
1. Take a flat card image (Scryfall / warp).
2. Apply seeded transforms (perspective, glare, multi-card, …).
3. Emit fixture JSON with exact groundTruthQuad(s) and groundTruthSource=synthetic.
4. Place under .geometry-corpus split=train|validation only by default.
5. Keep real-device images as the only trusted test / hard-regression gate.
`;
