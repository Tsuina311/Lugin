// Decide which saved artwork descriptors can be copied instead of re-downloaded.
//
// An illustration_id's picture does not change. A later Scryfall dump only adds
// ids. The descriptor is recomputed for every id only when the hash formula's
// version changes.

/** Key shared by the bulk builder: illustration id, else the Scryfall card id. */
export const artKey = (illustrationId, scryfallId) => illustrationId || scryfallId || '';

const isReusableDescriptor = entry => {
  const d = entry?.descriptor;
  return (
    !!entry?.name &&
    !!entry?.oracleId &&
    !!entry?.scryfallId &&
    Array.isArray(d?.dhash) &&
    d.dhash.length === 2 &&
    Array.isArray(d?.block) &&
    d.block.length === 4 &&
    Array.isArray(d?.hue) &&
    d.hue.length === 8
  );
};

/** Indexes written before this field existed were built with descriptor version 1. */
export const descriptorVersionOf = payload => {
  const art = payload?.art?.entries ? payload.art : payload;
  return typeof art?.descriptorVersion === 'number' ? art.descriptorVersion : 1;
};

/**
 * @returns {{ entries: Map<string, object>, reason: string | null }}
 * `reason` is set when nothing should be reused. The map is empty in that case.
 */
export const loadReusableArt = (payload, currentVersion, { minEntries = 500 } = {}) => {
  if (!payload || typeof payload !== 'object') {
    return { entries: new Map(), reason: 'missing' };
  }
  const version = descriptorVersionOf(payload);
  if (version !== currentVersion) {
    return {
      entries: new Map(),
      reason: `descriptor version ${version} != ${currentVersion}`,
    };
  }
  const list = payload.art?.entries ?? payload.entries;
  if (!Array.isArray(list)) return { entries: new Map(), reason: 'no entries' };
  const entries = new Map();
  for (const entry of list) {
    if (!isReusableDescriptor(entry)) continue;
    const key = artKey(entry.illustrationId, entry.scryfallId);
    if (!key || entries.has(key)) continue;
    entries.set(key, entry);
  }
  if (entries.size < minEntries) {
    return { entries: new Map(), reason: `only ${entries.size} reusable entries` };
  }
  return { entries, reason: null };
};
