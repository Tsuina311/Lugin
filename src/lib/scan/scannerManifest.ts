// Versioned scanner-data manifest (card names + art index).
// Independent of app / OTA / native fingerprint versions.

export const SCANNER_MANIFEST_SCHEMA = 1 as const;

export interface ScannerAssetRef {
  /** SHA-256 hex of the uncompressed JSON bytes. */
  sha256: string;
  /** Approximate compressed transfer size (gzip), when known. */
  compressedBytes?: number;
  /** Uncompressed JSON byte length. */
  bytes?: number;
  /** Absolute or site-relative URL. */
  url: string;
  /** Opaque content version (usually ISO date or build id). */
  version: string;
  /** Record count for sanity checks. */
  recordCount?: number;
}

export interface ScannerManifest {
  schemaVersion: typeof SCANNER_MANIFEST_SCHEMA;
  generatedAt: string;
  /** Scryfall bulk `updated_at` / equivalent when known. */
  sourceUpdatedAt?: string;
  cardNames: ScannerAssetRef;
  artIndex: ScannerAssetRef;
  /** Optional until Pages publishes printing-index.json. */
  printingIndex?: ScannerAssetRef;
}

export const SCANNER_MANIFEST_FILENAME = 'scanner-manifest.json';

/** How often cold launches may hit the network for a manifest check. */
export const SCANNER_MANIFEST_CHECK_INTERVAL_MS = 18 * 60 * 60 * 1000; // 18h

export const NAME_INDEX_MIN_PRODUCTION_NAMES = 5_000;
export const ART_INDEX_MIN_PRODUCTION_ENTRIES = 500;
export const PRINTING_INDEX_MIN_PRODUCTION_ENTRIES = 10_000;

/** Reject absurd payloads (uncompressed). */
export const SCANNER_ASSET_MAX_BYTES = 80 * 1024 * 1024;

export const isScannerManifest = (raw: unknown): raw is ScannerManifest => {
  if (!raw || typeof raw !== 'object') return false;
  const m = raw as Partial<ScannerManifest>;
  if (m.schemaVersion !== SCANNER_MANIFEST_SCHEMA) return false;
  if (typeof m.generatedAt !== 'string' || !m.generatedAt) return false;
  if (!isAssetRef(m.cardNames) || !isAssetRef(m.artIndex)) return false;
  if (m.printingIndex != null && !isAssetRef(m.printingIndex)) return false;
  return true;
};

const isAssetRef = (raw: unknown): raw is ScannerAssetRef => {
  if (!raw || typeof raw !== 'object') return false;
  const a = raw as Partial<ScannerAssetRef>;
  return (
    typeof a.sha256 === 'string' &&
    /^[a-f0-9]{64}$/i.test(a.sha256) &&
    typeof a.url === 'string' &&
    a.url.length > 0 &&
    typeof a.version === 'string' &&
    a.version.length > 0
  );
};
