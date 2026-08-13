// The document that travels between a user's own devices.
//
// Nothing here may touch Chrome, the DOM or React: this is the vocabulary the
// extension and a future mobile app both speak, so it has to survive being read
// on a phone that has none of those. Only plain JSON-compatible data.
//
// The types the domains are built from already exist and are already portable
// (`Deck`, `StoredCollection`, `CardImageOverride`), so they're reused rather
// than mirrored — one shape, one place to change it.

import type { StoredCollection } from '@/lib/collection';
import type { Deck } from '@/lib/deck';
import type { CardImageOverride } from '@/lib/printing';

/**
 * Bumped when the shape below changes in a way an older client can't read.
 *
 * A client refuses to write a document whose version it doesn't know, so a
 * phone running ahead of a desktop can never be silently downgraded by it.
 */
export const SYNC_SCHEMA_VERSION = 1;

/** One synchronised area of the app, stamped with when it last changed. */
export interface Domain<T> {
  /** ISO 8601. Compared against the other device's, so it must be UTC. */
  updatedAt: string;
  value: T;
}

/** The parts of the app that mean the same thing on any device. */
export interface SyncedPreferences {
  /** Fold Cardmarket purchases into the collection after a purchase sync. */
  addPurchasesToCollection: boolean;
  /** Cardmarket country id used for shipping estimates. */
  homeCountry: number | null;
  theme: 'dark' | 'site';
}

/**
 * Everything worth carrying between devices, and nothing else.
 *
 * Deliberately absent: want lists, purchases and every cache. Both devices sign
 * into the same Cardmarket account and can fetch those themselves, so sending
 * them through Google would cost quota and privacy for nothing.
 */
export interface ApplicationData {
  collection: Domain<StoredCollection | null>;
  decks: Domain<Deck[]>;
  preferences: Domain<SyncedPreferences>;
  printings: Domain<Record<string, CardImageOverride>>;
}

/** The domains, as a value — the engine walks them and callers name them. */
export const DOMAINS = ['collection', 'decks', 'preferences', 'printings'] as const;
export type DomainKey = (typeof DOMAINS)[number];

/** The whole document, as it sits in the user's own cloud storage. */
export interface SyncedApplicationState {
  data: ApplicationData;
  /** The device that wrote this revision, so conflicts can name a culprit. */
  deviceId: string;
  schemaVersion: number;
  /** ISO 8601: the most recent of the domains' stamps. */
  updatedAt: string;
}

/** An opaque revision as the remote knows it (Drive's per-file `version`). */
export type Revision = string;

/** What this device remembers about its last reconciliation. */
export interface SyncMeta {
  /**
   * Each domain's `updatedAt` as of the last successful sync. A domain whose
   * local stamp still matches this hasn't been touched here since — which is
   * what separates "the other device edited it" from "we both did".
   */
  base: Partial<Record<DomainKey, string>>;
  baseRevision: Revision | null;
  /** Stable per-install id. Never leaves the device except inside a revision. */
  deviceId: string;
  /** Set when local data changed after the last push; cleared by a push. */
  dirtyAt: string | null;
  lastPulledAt: string | null;
  lastPushedAt: string | null;
}

export const emptyMeta = (deviceId: string): SyncMeta => ({
  base: {},
  baseRevision: null,
  deviceId,
  dirtyAt: null,
  lastPulledAt: null,
  lastPushedAt: null,
});

/** The starting point for a device that has never synced or stored anything. */
export const emptyData = (at: string): ApplicationData => ({
  collection: { updatedAt: at, value: null },
  decks: { updatedAt: at, value: [] },
  preferences: {
    updatedAt: at,
    value: { addPurchasesToCollection: false, homeCountry: null, theme: 'dark' },
  },
  printings: { updatedAt: at, value: {} },
});
