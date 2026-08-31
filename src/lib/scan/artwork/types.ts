import type { ArtworkDescriptor } from './descriptors';

/** One entry in the offline artwork index (no image pixels). */
export interface ArtworkIndexEntry {
  descriptor: ArtworkDescriptor;
  /** Scryfall illustration_id when known — groups identical art. */
  illustrationId?: string;
  name: string;
  oracleId: string;
  scryfallId: string;
  setCode?: string;
}

export interface ArtworkIndexData {
  entries: ArtworkIndexEntry[];
  generated?: string;
  /** Schema version — bump when descriptor layout changes. */
  version: number;
}

export interface VisualCandidate {
  illustrationId?: string;
  name: string;
  oracleId: string;
  scryfallId: string;
  setCode?: string;
  visualScore: number;
}
