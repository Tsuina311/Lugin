// Load the same card-name / artwork indexes the web scanner consumes.
//
// Filesystem cache is acceptable for this milestone; AsyncStorage / SecureStore
// are not (these payloads are megabytes). Until expo-file-system ships in a
// new APK, the cache is process memory — one parse per cold start.

import {
  buildNameIndex,
  createArtworkMatcher,
  NO_ARTWORK_MATCHER,
  type ArtworkIndexData,
  type ArtworkMatcher,
  type CardNameIndex,
  type CardNameIndexData,
  type TextIndexData,
} from './sharedCore';
import {
  textIndexFromArtworkPayload,
  validateArtworkIndexData,
  validateNameIndexData,
} from './indexValidate';

/** GitHub Pages deploy of the web app — same files the browser fetches. */
export const DEFAULT_INDEX_BASE = 'https://tsuina311.github.io/Lugin/';

export interface NameIndexLoad {
  checksum: string;
  coldMs: number;
  data: CardNameIndexData;
  index: CardNameIndex;
  names: number;
  source: 'network' | 'memory';
  version: number;
  warmMs: number;
}

export interface ArtIndexLoad {
  checksum: string;
  coldMs: number;
  data: ArtworkIndexData;
  entries: number;
  matcher: ArtworkMatcher;
  source: 'network' | 'memory';
  text: TextIndexData | null;
  version: number;
  warmMs: number;
}

const memory = {
  art: null as ArtIndexLoad | null,
  artInflight: null as Promise<ArtIndexLoad | null> | null,
  names: null as NameIndexLoad | null,
  namesInflight: null as Promise<NameIndexLoad | null> | null,
};

const now = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const joinUrl = (base: string, file: string): string =>
  `${base.replace(/\/?$/, '/')}${file}`;

/** Cheap integrity stamp — not cryptographic; enough to notice a bad payload. */
export const checksumJson = (value: unknown): string => {
  const text = JSON.stringify(value);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

const fetchJson = async (url: string): Promise<unknown> => {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
};

export const loadNameIndex = async (
  base = DEFAULT_INDEX_BASE,
): Promise<NameIndexLoad | null> => {
  if (memory.names) {
    return { ...memory.names, source: 'memory', warmMs: 0 };
  }
  if (memory.namesInflight) return memory.namesInflight;
  memory.namesInflight = (async () => {
    const t0 = now();
    const raw = await fetchJson(joinUrl(base, 'card-names.json'));
    const checked = validateNameIndexData(raw);
    if (checked.reason || !checked.data) throw new Error(checked.reason ?? 'invalid name index');
    const data = checked.data;
    const builtAt = now();
    const index = buildNameIndex(data);
    const load: NameIndexLoad = {
      checksum: checksumJson({ names: data.names.length, version: data.version }),
      coldMs: now() - t0,
      data,
      index,
      names: data.names.length,
      source: 'network',
      version: data.version,
      warmMs: now() - builtAt,
    };
    memory.names = load;
    return load;
  })()
    .catch(() => null)
    .finally(() => {
      memory.namesInflight = null;
    });
  return memory.namesInflight;
};

export const loadArtworkIndex = async (
  base = DEFAULT_INDEX_BASE,
): Promise<ArtIndexLoad | null> => {
  if (memory.art) {
    return { ...memory.art, source: 'memory', warmMs: 0 };
  }
  if (memory.artInflight) return memory.artInflight;
  memory.artInflight = (async () => {
    const t0 = now();
    const raw = await fetchJson(joinUrl(base, 'art-index.json'));
    const checked = validateArtworkIndexData(raw);
    if (checked.reason || !checked.data) throw new Error(checked.reason ?? 'invalid art index');
    const data = checked.data;
    const builtAt = now();
    const load: ArtIndexLoad = {
      checksum: checksumJson({ entries: data.entries.length, version: data.version }),
      coldMs: now() - t0,
      data,
      entries: data.entries.length,
      matcher: createArtworkMatcher(data),
      source: 'network',
      text: textIndexFromArtworkPayload(raw),
      version: data.version,
      warmMs: now() - builtAt,
    };
    memory.art = load;
    return load;
  })()
    .catch(() => null)
    .finally(() => {
      memory.artInflight = null;
    });
  return memory.artInflight;
};

export const peekNameIndex = (): NameIndexLoad | null => memory.names;
export const peekArtworkIndex = (): ArtIndexLoad | null => memory.art;

export const emptyArtMatcher = (): ArtworkMatcher => NO_ARTWORK_MATCHER;

/** Test hook — drop cached indexes. */
export const resetIndexCache = (): void => {
  memory.art = null;
  memory.artInflight = null;
  memory.names = null;
  memory.namesInflight = null;
};
