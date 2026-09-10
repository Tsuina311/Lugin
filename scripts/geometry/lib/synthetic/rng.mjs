/**
 * Deterministic PRNG (mulberry32) + helpers for synthetic scenes.
 */

export const mulberry32 = seed => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

export const hashSeed = (base, ...parts) => {
  let h = base >>> 0;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 0x9e3779b1);
    }
  }
  return h >>> 0;
};

export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

export const lerp = (a, b, t) => a + (b - a) * t;
