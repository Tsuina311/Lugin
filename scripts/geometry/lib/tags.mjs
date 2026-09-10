/** Derive tags only from known metadata — never invent. */

import { ALLOWED_TAGS } from './schema.mjs';

const langTag = lang => {
  if (!lang || typeof lang !== 'string') return null;
  const l = lang.toLowerCase().slice(0, 2);
  const map = {
    en: 'language-en',
    fr: 'language-fr',
    it: 'language-it',
    de: 'language-de',
    es: 'language-es',
  };
  return map[l] ?? null;
};

const fromObjectTags = tags => {
  if (!tags || typeof tags !== 'object' || Array.isArray(tags)) return [];
  const out = [];
  if (tags.sleeved === true) out.push('sleeved');
  if (tags.sleeved === false) out.push('unsleeved');
  if (tags.foil === true) out.push('foil');
  if (tags.foil === false) out.push('nonfoil');
  if (tags.glare === true) out.push('glare');
  if (tags.borderStyle === 'classic') out.push('classic-frame');
  if (tags.borderStyle === 'borderless') out.push('borderless');
  const lt = langTag(tags.language);
  if (lt) out.push(lt);
  return out;
};

const fromHardReasons = reasons => {
  if (!Array.isArray(reasons)) return [];
  const out = [];
  for (const r of reasons) {
    const s = String(r).toLowerCase();
    if (s.includes('sleeve')) out.push('sleeved');
    if (s.includes('glare')) out.push('glare');
    if (s.includes('foil')) out.push('foil');
    if (s.includes('dark')) out.push('dark-card');
    if (s.includes('perspective') || s.includes('rotation')) out.push('perspective');
    if (s.includes('showcase') || s.includes('borderless')) out.push('showcase');
    if (s.includes('wood') || s.includes('table')) out.push('dark-background');
    out.push('hard-case');
  }
  return out;
};

const fromLabel = label => {
  if (!label || typeof label !== 'string') return [];
  const s = label.toLowerCase();
  const out = [];
  if (/\bunsleeved\b/.test(s)) out.push('unsleeved');
  else if (/\bsleeve/.test(s)) out.push('sleeved');
  if (/\bfoil\b/.test(s)) out.push('foil');
  if (/\bfrench\b|\bfrançais\b|\bfr\b/.test(s)) out.push('language-fr');
  if (/\bitalian\b|\bitaliano\b/.test(s)) out.push('language-it');
  if (/\bglare\b/.test(s)) out.push('glare');
  if (/\bbad\s*cap/.test(s)) out.push('bad-capture');
  return out;
};

export const deriveTags = ({
  objectTags = null,
  hardReasons = null,
  label = null,
  quadMode = null,
  explicit = [],
} = {}) => {
  const set = new Set();
  for (const t of fromObjectTags(objectTags)) set.add(t);
  for (const t of fromHardReasons(hardReasons)) set.add(t);
  for (const t of fromLabel(label)) set.add(t);
  for (const t of explicit ?? []) {
    if (ALLOWED_TAGS.includes(t)) set.add(t);
  }
  if (quadMode === 'per-snapshot') set.add('per-snapshot-series');
  // Legacy Focus Series without per-snapshot mode reused one latch across T*.
  if (quadMode == null && label != null) {
    // only applied by caller for focus-series with missing quadMode
  }
  return [...set].filter(t => ALLOWED_TAGS.includes(t)).sort();
};

export const markFrozenFocusSeries = (tags, { source, quadMode }) => {
  const out = new Set(tags ?? []);
  if (source === 'focus-series' && quadMode !== 'per-snapshot') {
    out.add('frozen-quad-series');
  }
  return [...out].sort();
};
