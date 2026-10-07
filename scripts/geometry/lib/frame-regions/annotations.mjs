/** Edit tracking for frame-region annotations. Pure; used by Geometry Lab and tests. */

import { FRAME_FAMILIES, FRAME_REGION_KEYS } from '../schema.mjs';

const cloneQuad = quad => ({
  tl: quad.tl.slice(),
  tr: quad.tr.slice(),
  br: quad.br.slice(),
  bl: quad.bl.slice(),
});

export function effectiveFrameFamily(card) {
  return FRAME_FAMILIES.includes(card?.frameFamily) ? card.frameFamily : 'unknown';
}

export function regionStatus(region) {
  if (!region?.quad) return 'missing';
  if (region.source === 'auto') return 'auto';
  if (region.source === 'auto-accepted') return 'auto-accepted';
  if (region.source === 'auto-edited') return 'auto-edited';
  if (region.source === 'manual') return 'manual';
  return 'missing';
}

/**
 * Human confirmed this polygon.
 * A saved draw (`manual`) or corner move (`auto-edited`) is that confirmation.
 * Accepting an automatic polygon counts only when `reviewed` is set.
 * `source: "auto"` never counts.
 */
export function isReviewedArtBox(region) {
  if (!region?.quad || region.reviewed === false) return false;
  if (region.source === 'manual' || region.source === 'auto-edited') return true;
  if (region.source === 'auto-accepted') return region.reviewed === true;
  return false;
}

/** Accept the automatic polygon unchanged. */
export function acceptArtBox(region) {
  if (!region?.quad) return null;
  if (region.source === 'auto-edited' || region.source === 'manual') {
    return { ...region, reviewed: true };
  }
  const original = region.autoQuad || region.quad;
  return {
    ...region,
    quad: cloneQuad(original),
    autoQuad: cloneQuad(original),
    source: 'auto-accepted',
    reviewed: true,
  };
}

/** Put the corners back on the stored automatic proposal. */
export function resetArtBox(region) {
  if (!region?.autoQuad) return null;
  return {
    ...region,
    quad: cloneQuad(region.autoQuad),
    source: 'auto',
    reviewed: false,
  };
}

/**
 * Move one corner. An automatic proposal becomes auto-edited and keeps the
 * original quad in autoQuad so later reports can measure the correction.
 */
export function moveRegionCorner(region, key, xy) {
  const quad = {
    tl: region.quad.tl.slice(),
    tr: region.quad.tr.slice(),
    br: region.quad.br.slice(),
    bl: region.quad.bl.slice(),
  };
  quad[key] = [xy[0], xy[1]];
  const next = { ...region, quad };
  if (region.source === 'auto' || region.source === 'auto-accepted') {
    next.source = 'auto-edited';
    next.autoQuad = region.autoQuad ? cloneQuad(region.autoQuad) : cloneQuad(region.quad);
  }
  next.reviewed = false;
  return next;
}

/**
 * Insert auto proposals without touching manual or auto-edited polygons.
 * `force` is the explicit Redetect all path: it replaces every targeted region,
 * and clears one when the new pass found nothing.
 */
export function applyAutoProposals(regions, proposals, options = {}) {
  const force = Boolean(options.force);
  const only = options.only ?? null;
  const next = {};
  for (const key of FRAME_REGION_KEYS) {
    if (regions?.[key]) next[key] = regions[key];
  }
  const skipped = [];
  const applied = [];
  const cleared = [];
  for (const key of FRAME_REGION_KEYS) {
    if (only && key !== only) continue;
    const proposal = proposals?.[key] ?? null;
    const existing = regions?.[key] ?? null;
    const locked = existing && (existing.reviewed === true || existing.source === 'manual' || existing.source === 'auto-edited' || existing.source === 'auto-accepted');
    if (!force && locked) {
      skipped.push(key);
      continue;
    }
    if (!proposal?.quad) {
      if (force && existing) {
        delete next[key];
        cleared.push(key);
      }
      continue;
    }
    const quad = cloneQuad(proposal.quad);
    next[key] = {
      quad,
      source: 'auto',
      confidence: proposal.confidence,
      autoQuad: cloneQuad(quad),
    };
    applied.push(key);
  }
  return { regions: next, skipped, applied, cleared };
}
