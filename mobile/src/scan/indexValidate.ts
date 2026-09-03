// Same shapes the web loaders accept. Native must reject a bad payload
// before `buildNameIndex` / `createArtworkMatcher` see it.

import type { ArtworkIndexData, CardNameIndexData, TextIndexData } from './sharedCore';

export const NAME_INDEX_MIN_VERSION = 1;
export const ART_INDEX_MIN_VERSION = 1;

export const validateNameIndexData = (
  raw: unknown,
): { data: CardNameIndexData; reason?: undefined } | { data?: undefined; reason: string } => {
  if (!raw || typeof raw !== 'object') return { reason: 'name index is not an object' };
  const body = raw as Partial<CardNameIndexData>;
  if (!Array.isArray(body.names) || body.names.length === 0) {
    return { reason: 'name index has no names' };
  }
  if (body.names.some(n => typeof n !== 'string' || !n)) {
    return { reason: 'name index contains a non-string name' };
  }
  if (typeof body.version !== 'number' || body.version < NAME_INDEX_MIN_VERSION) {
    return { reason: `name index version ${String(body.version)} is unsupported` };
  }
  if (body.printed) {
    for (const [lang, list] of Object.entries(body.printed)) {
      if (!Array.isArray(list)) return { reason: `printed[${lang}] is not a list` };
      for (const row of list) {
        if (!Array.isArray(row) || row.length < 2) {
          return { reason: `printed[${lang}] row is malformed` };
        }
        const [idx, title] = row;
        if (typeof idx !== 'number' || idx < 0 || idx >= body.names.length) {
          return { reason: `printed[${lang}] points outside names` };
        }
        if (typeof title !== 'string') return { reason: `printed[${lang}] title is not a string` };
      }
    }
  }
  return { data: body as CardNameIndexData };
};

const isDescriptor = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const d = value as { block?: unknown; dhash?: unknown; hue?: unknown };
  return (
    Array.isArray(d.dhash) &&
    d.dhash.length === 2 &&
    Array.isArray(d.block) &&
    d.block.length === 4 &&
    Array.isArray(d.hue) &&
    d.hue.length === 8
  );
};

export const validateArtworkIndexData = (
  raw: unknown,
): { data: ArtworkIndexData; reason?: undefined } | { data?: undefined; reason: string } => {
  if (!raw || typeof raw !== 'object') return { reason: 'art index is not an object' };
  const body = raw as {
    art?: ArtworkIndexData;
    entries?: ArtworkIndexData['entries'];
    text?: TextIndexData;
    version?: number;
  };
  const art: ArtworkIndexData | null = body.art?.entries
    ? body.art
    : body.entries
      ? { entries: body.entries, version: body.version ?? 1 }
      : null;
  if (!art?.entries?.length) return { reason: 'art index has no entries' };
  if (typeof art.version !== 'number' || art.version < ART_INDEX_MIN_VERSION) {
    return { reason: `art index version ${String(art.version)} is unsupported` };
  }
  const sample = art.entries[0];
  if (!sample?.name || !sample.oracleId || !isDescriptor(sample.descriptor)) {
    return { reason: 'art index entries are not compact descriptors' };
  }
  return { data: art };
};

export const textIndexFromArtworkPayload = (raw: unknown): TextIndexData | null => {
  if (!raw || typeof raw !== 'object') return null;
  const text = (raw as { text?: TextIndexData }).text;
  return text?.entries?.length ? text : null;
};
