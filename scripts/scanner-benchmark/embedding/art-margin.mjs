/**
 * Fixed art-crop margins around a human art box.
 * The margins are chosen before looking at scores. Nothing here trains.
 */

import { CARD_HEIGHT, CARD_WIDTH, canonicalQuadToSource, sourceQuadToCanonical } from '../../geometry/lib/frame-regions/project.mjs';

export const ART_MARGINS = [-0.1, -0.05, 0, 0.03, 0.05, 0.08, 0.12];

const KEYS = ['tl', 'tr', 'br', 'bl'];

export const marginId = margin => {
  if (margin === 0) return 'manual_0';
  const pct = Math.round(margin * 100);
  return `manual_${pct > 0 ? '+' : ''}${pct}`;
};

/** Scale width and height about the quad center, then clamp to the canonical card. */
export const scaleCanonicalArt = (quad, margin, width = CARD_WIDTH, height = CARD_HEIGHT) => {
  const pts = KEYS.map(key => ({ x: quad[key][0], y: quad[key][1] }));
  const cx = pts.reduce((sum, point) => sum + point.x, 0) / pts.length;
  const cy = pts.reduce((sum, point) => sum + point.y, 0) / pts.length;
  const factor = 1 + margin;
  const scaled = pts.map(point => ({
    x: Math.min(width - 1, Math.max(0, cx + (point.x - cx) * factor)),
    y: Math.min(height - 1, Math.max(0, cy + (point.y - cy) * factor)),
  }));
  const out = {};
  KEYS.forEach((key, index) => {
    out[key] = [scaled[index].x, scaled[index].y];
  });
  return out;
};

/** Exact human polygon at 0. Other margins move in canonical card space, then return to source pixels. */
export const artQuadAtMargin = (sourceQuad, cardQuad, margin) => {
  if (!margin) return sourceQuad;
  const canonical = sourceQuadToCanonical(sourceQuad, cardQuad);
  return canonicalQuadToSource(scaleCanonicalArt(canonical, margin), cardQuad);
};

/**
 * Best predefined margin for one frame.
 * A Top1 hit beats any miss. Otherwise the lower expected rank wins.
 * Expected similarity breaks remaining ties.
 */
export const bestMargin = rows => {
  const sorted = [...rows].sort((a, b) => {
    if (Boolean(a.top1) !== Boolean(b.top1)) return a.top1 ? -1 : 1;
    const ar = a.rank ?? Number.POSITIVE_INFINITY;
    const br = b.rank ?? Number.POSITIVE_INFINITY;
    if (ar !== br) return ar - br;
    return (b.expectedScore ?? -Infinity) - (a.expectedScore ?? -Infinity);
  });
  return sorted[0] ?? null;
};

const BASIC_LANDS = new Set([
  'Island',
  'Mountain',
  'Plains',
  'Swamp',
  'Forest',
  'Wastes',
  'Snow-Covered Island',
  'Snow-Covered Mountain',
  'Snow-Covered Plains',
  'Snow-Covered Swamp',
  'Snow-Covered Forest',
]);

/** Labels that already exist on the frame. A card may carry more than one. */
export const conditionLabels = frame => {
  const tags = new Set((frame.tags ?? []).map(tag => String(tag).toLowerCase()));
  const labels = [];
  if (frame.frameFamily === 'modern_standard') labels.push('modern_standard');
  if (frame.frameFamily === 'showcase' || tags.has('showcase')) labels.push('showcase');
  if (frame.frameFamily === 'borderless' || tags.has('borderless')) labels.push('borderless');
  if (frame.frameFamily === 'retro' || frame.frameFamily === 'old' || tags.has('classic-frame') || tags.has('old_frame')) {
    labels.push('old/retro');
  }
  if (tags.has('foil')) labels.push('foil');
  if (tags.has('glare')) labels.push('glare');
  if (tags.has('foreign_language') || [...tags].some(tag => tag.startsWith('language-'))) labels.push('non-english');
  if (BASIC_LANDS.has(frame.cardName)) labels.push('basic land');
  return labels;
};

/**
 * Pick a policy from the predefined margins only.
 * A gain under 3 Top1 hits on 46 frames is not treated as a new crop policy.
 * Category splits are reported, and they override a global winner only when
 * two groups of at least 6 frames want different margins by 2 or more hits.
 */
export const chooseMarginPolicy = ({ table, categoryTables }) => {
  const exact = table.find(row => row.id === 'manual_0');
  const current = table.find(row => row.id === 'current');
  const margins = table.filter(row => row.id.startsWith('manual_'));
  const best = margins.slice().sort((a, b) => {
    if (b.top1 !== a.top1) return b.top1 - a.top1;
    return (a.correctToWrong ?? 0) - (b.correctToWrong ?? 0);
  })[0];
  const populated = (categoryTables ?? []).filter(group => group.n >= 6);
  const divergent = [];
  for (let i = 0; i < populated.length; i++) {
    for (let j = i + 1; j < populated.length; j++) {
      const left = populated[i];
      const right = populated[j];
      if (left.bestId === right.bestId) continue;
      const leftGap = left.byId[left.bestId] - (left.byId[right.bestId] ?? 0);
      const rightGap = right.byId[right.bestId] - (right.byId[left.bestId] ?? 0);
      if (leftGap >= 2 && rightGap >= 2) divergent.push(`${left.label} wants ${left.bestId}, ${right.label} wants ${right.bestId}`);
    }
  }
  if (divergent.length) {
    return {
      verdict: 'CATEGORY_DEPENDENT',
      bestId: best.id,
      why: `No single margin is safe to apply to every card. ${divergent.join('; ')}.`,
    };
  }
  const gainCurrent = best.top1 - current.top1;
  const gainExact = best.top1 - exact.top1;
  if (best.id === 'manual_0' && margins.every(row => row.top1 <= exact.top1)) {
    return {
      verdict: 'EXACT_ART_BEST',
      bestId: best.id,
      why: `The exact human art box is at least as good as every padded or tighter crop (${exact.top1} Top1).`,
    };
  }
  if (
    best.id !== 'manual_0' &&
    gainCurrent >= 3 &&
    gainExact >= 2 &&
    (best.correctToWrong ?? 0) <= (best.wrongToCorrect ?? 0)
  ) {
    return {
      verdict: 'CONTEXT_CROP_WIN',
      bestId: best.id,
      why: `${best.id} reaches ${best.top1} Top1 versus current ${current.top1} and exact art ${exact.top1}, with ${best.wrongToCorrect} wrong→correct and ${best.correctToWrong} correct→wrong.`,
    };
  }
  return {
    verdict: 'CROP_NOT_MAIN_LIMIT',
    bestId: best.id,
    why: `Best predefined crop is ${best.id} at ${best.top1} Top1, versus current ${current.top1} and exact art ${exact.top1}. That is not a material, low-regression gain.`,
  };
};
