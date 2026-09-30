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
  /**
   * Algorithm stamp from `ARTWORK_DESCRIPTOR_VERSION`. Absent on indexes built
   * before incremental reuse; those match version 1.
   */
  descriptorVersion?: number;
  entries: ArtworkIndexEntry[];
  generated?: string;
  /** Schema version — bump when the entry shape changes. */
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
