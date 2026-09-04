// Search a compact artwork index for visual near-neighbours.
//
// Brute-force over ~20–30k unique illustrations is fine on a phone for a single
// query (a few ms of integer math). If the index grows far past that, bucket by
// dHash prefix first — the interface stays the same.

import { VISUAL_TOP_N } from '../params';

import { descriptorSimilarity, type ArtworkDescriptor } from './descriptors';
import type { ArtworkIndexData, ArtworkIndexEntry, VisualCandidate } from './types';

export type { ArtworkIndexData, ArtworkIndexEntry, VisualCandidate };

export interface ArtworkMatcher {
  findCandidates(
    descriptor: ArtworkDescriptor,
    limit?: number,
  ): VisualCandidate[];
  /**
   * Restricted search — only score entries matching oracle / scryfall / illustration
   * ids (footer/title already proposed a small set).
   */
  findCandidatesRestricted?(
    descriptor: ArtworkDescriptor,
    restrict: {
      illustrationIds?: readonly string[];
      oracleIds?: readonly string[];
      scryfallIds?: readonly string[];
    },
    limit?: number,
  ): VisualCandidate[];
}

/** In-memory matcher over a loaded index. */
export const createArtworkMatcher = (index: ArtworkIndexData | null): ArtworkMatcher => {
  const entries = index?.entries ?? [];

  const scorePool = (
    descriptor: ArtworkDescriptor,
    pool: ArtworkIndexEntry[],
    limit: number,
  ): VisualCandidate[] => {
    if (!pool.length) return [];
    const best = new Map<string, VisualCandidate>();
    for (const e of pool) {
      const visualScore = descriptorSimilarity(descriptor, e.descriptor);
      if (visualScore < 0.45) continue;
      const prev = best.get(e.oracleId);
      if (prev && prev.visualScore >= visualScore) continue;
      best.set(e.oracleId, {
        ...(e.illustrationId ? { illustrationId: e.illustrationId } : {}),
        name: e.name,
        oracleId: e.oracleId,
        scryfallId: e.scryfallId,
        ...(e.setCode ? { setCode: e.setCode } : {}),
        visualScore,
      });
    }
    return [...best.values()]
      .sort((a, b) => b.visualScore - a.visualScore || a.name.localeCompare(b.name))
      .slice(0, limit);
  };

  return {
    findCandidates(descriptor, limit = VISUAL_TOP_N) {
      return scorePool(descriptor, entries, limit);
    },
    findCandidatesRestricted(descriptor, restrict, limit = VISUAL_TOP_N) {
      const oracle = new Set(restrict.oracleIds ?? []);
      const scry = new Set(restrict.scryfallIds ?? []);
      const ill = new Set(restrict.illustrationIds ?? []);
      if (!oracle.size && !scry.size && !ill.size) {
        return scorePool(descriptor, entries, limit);
      }
      const pool = entries.filter(
        e =>
          (oracle.size && oracle.has(e.oracleId)) ||
          (scry.size && scry.has(e.scryfallId)) ||
          (ill.size && e.illustrationId && ill.has(e.illustrationId)),
      );
      return scorePool(descriptor, pool, limit);
    },
  };
};

/** Empty matcher used before the index downloads. */
export const NO_ARTWORK_MATCHER: ArtworkMatcher = {
  findCandidates: () => [],
};

/** Pack/unpack helpers for tests that build tiny indexes inline. */
export const indexFromEntries = (entries: ArtworkIndexEntry[]): ArtworkIndexData => ({
  entries,
  version: 1,
});
