// Strict metadata / image checks for corpus samples (portable).
// Used by the web uploader (preflight) and developer import tooling.

import { CORPUS_SCHEMA_VERSION, type ScanCorpusEventType } from './types';

export const CORPUS_VALIDATE_LIMITS = {
  MAX_CANDIDATES: 24,
  MAX_IMAGE_BYTES: 2_500_000,
  MAX_META_BYTES: 64_000,
  MAX_STRING: 512,
};

export const CORPUS_EVENT_TYPES = new Set<ScanCorpusEventType>([
  'DETECTION_TIMEOUT',
  'DETECTION_REJECTED',
  'DETECTION_UNSTABLE',
  'DETECTION_LOCKED',
  'FALSE_POSITIVE_REPORTED',
  'DETECTION_FAILURE_REPORTED',
  'RECOGNITION_AMBIGUOUS',
  'RECOGNITION_CORRECTED',
  'PRINTING_CORRECTED',
  'SUCCESS_SAMPLE',
  'CAMERA_BLUR',
  'CAMERA_FOCUS_FAILURE',
]);

export const FORBIDDEN_META_KEYS = [
  'email',
  'googleId',
  'accountId',
  'gps',
  'exif',
  'ip',
  'path',
  'objectKey',
  'filename',
  'storageKey',
  'userEmail',
  'googleAccountId',
  'profileName',
] as const;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const tooLong = (s: unknown, max: number): boolean =>
  typeof s === 'string' && s.length > max;

/** Returns error code string or null if OK. */
export const validateMetaStrict = (
  meta: unknown,
  limits = CORPUS_VALIDATE_LIMITS,
): string | null => {
  if (!isPlainObject(meta)) return 'invalid_meta';
  if (meta.schemaVersion !== CORPUS_SCHEMA_VERSION) return 'bad_schema';
  if (typeof meta.eventType !== 'string' || !CORPUS_EVENT_TYPES.has(meta.eventType as ScanCorpusEventType)) {
    return 'bad_event';
  }
  if (typeof meta.contributorId !== 'string' || meta.contributorId.length < 8) {
    return 'bad_contributor';
  }
  if (typeof meta.sessionId !== 'string' || meta.sessionId.length < 8) {
    return 'bad_session';
  }
  if (typeof meta.appVersion !== 'string' || tooLong(meta.appVersion, 64)) {
    return 'bad_app_version';
  }
  if (typeof meta.scannerVersion !== 'string' || tooLong(meta.scannerVersion, 64)) {
    return 'bad_scanner_version';
  }
  if (typeof meta.priority !== 'string') return 'bad_priority';
  if (!['high', 'medium', 'low'].includes(meta.priority)) return 'bad_priority';
  if (typeof meta.labelKind !== 'string' || tooLong(meta.labelKind, 64)) {
    return 'bad_label';
  }
  if (typeof meta.createdAt !== 'string' || tooLong(meta.createdAt, 40)) {
    return 'bad_created_at';
  }
  if (typeof meta.sampleId !== 'string' || meta.sampleId.length < 8 || meta.sampleId.length > 64) {
    return 'bad_sample_id';
  }

  for (const bad of FORBIDDEN_META_KEYS) {
    if (Object.prototype.hasOwnProperty.call(meta, bad)) return 'forbidden_field';
  }

  if (meta.detector != null) {
    if (!isPlainObject(meta.detector)) return 'bad_detector';
    const cands = meta.detector.candidates;
    if (cands != null) {
      if (!Array.isArray(cands) || cands.length > limits.MAX_CANDIDATES) {
        return 'too_many_candidates';
      }
    }
  }

  if (meta.recognition != null) {
    if (!isPlainObject(meta.recognition)) return 'bad_recognition';
    const cands = meta.recognition.candidates;
    if (cands != null) {
      if (!Array.isArray(cands) || cands.length > limits.MAX_CANDIDATES) {
        return 'too_many_candidates';
      }
    }
    for (const k of [
      'predictedName',
      'predictedOracleId',
      'predictedPrintingId',
      'correctedOracleId',
      'correctedPrintingId',
      'status',
    ]) {
      if (meta.recognition[k] != null && tooLong(String(meta.recognition[k]), limits.MAX_STRING)) {
        return 'string_too_long';
      }
    }
  }

  if (meta.image != null) {
    if (!isPlainObject(meta.image)) return 'bad_image_meta';
    if (meta.image.kind !== 'full-frame' && meta.image.kind !== 'normalized-card') {
      return 'bad_image_kind';
    }
    if (meta.image.mimeType !== 'image/jpeg' && meta.image.mimeType !== 'image/webp') {
      return 'bad_image_mime';
    }
    const w = meta.image.width;
    const h = meta.image.height;
    if (
      typeof w !== 'number' ||
      typeof h !== 'number' ||
      !Number.isFinite(w) ||
      !Number.isFinite(h) ||
      w < 1 ||
      h < 1 ||
      w > 8192 ||
      h > 8192
    ) {
      return 'bad_dimensions';
    }
  }

  if (meta.detectedCards != null) {
    if (!Array.isArray(meta.detectedCards) || meta.detectedCards.length > 8) {
      return 'too_many_cards';
    }
  }

  return null;
};

/** JPEG SOI or RIFF/WEBP magic. */
export const sniffImageMime = (bytes: ArrayBuffer | Uint8Array): 'image/jpeg' | 'image/webp' | null => {
  if (!bytes || bytes.byteLength < 12) return null;
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return 'image/jpeg';
  const riff = u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46;
  const webp = u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50;
  if (riff && webp) return 'image/webp';
  return null;
};
