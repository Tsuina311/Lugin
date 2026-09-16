/** Binder policy — separate from Single Scan topComponents. */

export const BINDER_POLICY = Object.freeze({
  name: 'binder-v0',
  /** Host/native diagnostic budget when multi-return is available. */
  topComponents: 7,
  dedupeCap: 12,
  multiReturn: true,
  maxCards: 12,
  nmsIou: 0.35,
  minScore: 0.28,
  gridRows: 3,
  gridCols: 3,
});

/** Production Single Scan equivalent — do not mutate from Binder. */
export const SINGLE_SCAN_DETECT_POLICY = Object.freeze({
  name: 'single',
  topComponents: 4,
  dedupeCap: 12,
  multiReturn: false,
  maxCards: 1,
});
