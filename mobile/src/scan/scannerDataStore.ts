// Offline-first scanner indexes: disk cache → optional bundled seed → background update.
//
// Ordinary identification never waits on network. Manifest checks are throttled.
// Remote assets are untrusted: HTTPS host allowlist + sha256 + schema gates.

import {
  ART_INDEX_MIN_PRODUCTION_ENTRIES,
  NAME_INDEX_MIN_PRODUCTION_NAMES,
  PRINTING_INDEX_MIN_PRODUCTION_ENTRIES,
  SCANNER_ASSET_MAX_BYTES,
  SCANNER_MANIFEST_CHECK_INTERVAL_MS,
  SCANNER_MANIFEST_FILENAME,
  isScannerManifest,
  type ScannerManifest,
} from '@/lib/scan/scannerManifest';

import {
  buildNameIndex,
  buildPrintingIndex,
  createArtworkMatcher,
  validatePrintingIndexData,
  type ArtworkIndexData,
  type ArtworkMatcher,
  type CardNameIndex,
  type CardNameIndexData,
  type PrintingIndex,
  type PrintingIndexData,
  type TextIndexData,
} from './sharedCore';
import {
  textIndexFromArtworkPayload,
  validateArtworkIndexData,
  validateNameIndexData,
} from './indexValidate';
import { DEFAULT_INDEX_BASE, checksumJson } from './indexLoader';

const ALLOWED_HOSTS = new Set(['tsuina311.github.io']);

export type ScannerDataOrigin = 'bundled' | 'disk' | 'network' | 'memory';

export interface ScannerDataStatus {
  artEntries: number | null;
  artGenerated: string | null;
  artOrigin: ScannerDataOrigin | null;
  artChecksum: string | null;
  lastCheckAt: number | null;
  lastError: string | null;
  manifestGeneratedAt: string | null;
  names: number | null;
  namesChecksum: string | null;
  namesOrigin: ScannerDataOrigin | null;
  printingEntries: number | null;
  printingChecksum: string | null;
  printingOrigin: ScannerDataOrigin | null;
  statusLabel: 'Current' | 'Update available' | 'Offline' | 'Checking' | 'Unknown';
  updating: boolean;
}

export interface ActiveScannerIndexes {
  art: ArtworkIndexData | null;
  artChecksum: string;
  artGenerated: string | null;
  artMatcher: ArtworkMatcher | null;
  artOrigin: ScannerDataOrigin;
  artUniqueOracles: number;
  nameChecksum: string;
  nameIndex: CardNameIndex | null;
  nameOrigin: ScannerDataOrigin;
  names: number;
  nameData: CardNameIndexData | null;
  printing: PrintingIndexData | null;
  printingChecksum: string;
  printingIndex: PrintingIndex | null;
  printingOrigin: ScannerDataOrigin | null;
  text: TextIndexData | null;
}

const META_FILE = 'meta.json';

interface DiskMeta {
  artChecksum?: string;
  artSha256?: string;
  artVersion?: string;
  lastCheckAt?: number;
  manifestGeneratedAt?: string;
  namesChecksum?: string;
  namesSha256?: string;
  namesVersion?: string;
  printingChecksum?: string;
  printingSha256?: string;
  printingVersion?: string;
}

const state = {
  active: null as ActiveScannerIndexes | null,
  lastError: null as string | null,
  lastCheckAt: null as number | null,
  manifest: null as ScannerManifest | null,
  updating: false,
  listeners: new Set<() => void>(),
};

const notify = () => {
  for (const l of state.listeners) l();
};

export const subscribeScannerData = (fn: () => void): (() => void) => {
  state.listeners.add(fn);
  return () => {
    state.listeners.delete(fn);
  };
};

type LegacyFS = typeof import('expo-file-system/legacy');

const fs = async (): Promise<LegacyFS> => import('expo-file-system/legacy');

const scannerRoot = async (): Promise<string> => {
  const FileSystem = await fs();
  const root = FileSystem.documentDirectory;
  if (!root) throw new Error('documentDirectory unavailable');
  const dir = `${root}lugin-scanner/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
};

const readMeta = async (): Promise<DiskMeta> => {
  try {
    const FileSystem = await fs();
    const dir = await scannerRoot();
    const uri = `${dir}${META_FILE}`;
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return {};
    return JSON.parse(await FileSystem.readAsStringAsync(uri)) as DiskMeta;
  } catch {
    return {};
  }
};

const writeMeta = async (meta: DiskMeta): Promise<void> => {
  const FileSystem = await fs();
  const dir = await scannerRoot();
  await FileSystem.writeAsStringAsync(`${dir}${META_FILE}`, JSON.stringify(meta));
};

const assertAllowedUrl = (url: string): URL => {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('scanner asset must be https');
  if (!ALLOWED_HOSTS.has(u.hostname)) {
    throw new Error(`scanner host not allowed: ${u.hostname}`);
  }
  if (u.pathname.includes('..')) throw new Error('path traversal rejected');
  return u;
};

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('SHA-256 unavailable; cannot verify scanner asset');
  const copy = new Uint8Array(bytes);
  const digest = await subtle.digest('SHA-256', copy);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
};

const fetchBytes = async (url: string): Promise<Uint8Array> => {
  assertAllowedUrl(url);
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > SCANNER_ASSET_MAX_BYTES) {
    throw new Error(`asset too large (${buf.byteLength})`);
  }
  return buf;
};

const parseJsonBytes = (bytes: Uint8Array): unknown =>
  JSON.parse(new TextDecoder().decode(bytes));

const loadBundledNames = async (): Promise<CardNameIndexData | null> => {
  try {
    // Optional seed at mobile/assets/scanner/card-names.json
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../assets/scanner/card-names.json') as CardNameIndexData;
    const checked = validateNameIndexData(mod);
    if (checked.data && checked.data.names.length >= 1) return checked.data;
  } catch {
    /* no bundled seed in this build */
  }
  return null;
};

const readDiskJson = async (name: string): Promise<unknown | null> => {
  try {
    const FileSystem = await fs();
    const dir = await scannerRoot();
    const uri = `${dir}${name}`;
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    return JSON.parse(await FileSystem.readAsStringAsync(uri));
  } catch {
    return null;
  }
};

const atomicWriteJson = async (name: string, text: string): Promise<void> => {
  const FileSystem = await fs();
  const dir = await scannerRoot();
  const tmp = `${dir}${name}.tmp`;
  const dest = `${dir}${name}`;
  const bak = `${dir}${name}.bak`;
  await FileSystem.writeAsStringAsync(tmp, text);
  const destInfo = await FileSystem.getInfoAsync(dest);
  if (destInfo.exists) {
    const bakInfo = await FileSystem.getInfoAsync(bak);
    if (bakInfo.exists) await FileSystem.deleteAsync(bak, { idempotent: true });
    await FileSystem.moveAsync({ from: dest, to: bak });
  }
  await FileSystem.moveAsync({ from: tmp, to: dest });
};

const activateFromNameData = (
  data: CardNameIndexData,
  origin: ScannerDataOrigin,
  art: {
    data: ArtworkIndexData | null;
    origin: ScannerDataOrigin;
    raw?: unknown;
  },
  printing?: {
    data: PrintingIndexData | null;
    origin: ScannerDataOrigin | null;
  },
): ActiveScannerIndexes => {
  const nameIndex = buildNameIndex(data);
  const artData = art.data;
  const uniqueOracles = artData
    ? new Set(artData.entries.map(e => e.oracleId)).size
    : 0;
  const printingData = printing?.data ?? null;
  const active: ActiveScannerIndexes = {
    art: artData,
    artChecksum: artData
      ? checksumJson({
          entries: artData.entries.length,
          generated: artData.generated ?? null,
          version: artData.version,
        })
      : '',
    artGenerated: artData?.generated ?? null,
    artMatcher: artData ? createArtworkMatcher(artData) : null,
    artOrigin: art.origin,
    artUniqueOracles: uniqueOracles,
    nameChecksum: checksumJson({ names: data.names.length, version: data.version }),
    nameData: data,
    nameIndex,
    nameOrigin: origin,
    names: data.names.length,
    printing: printingData,
    printingChecksum: printingData
      ? checksumJson({ entries: printingData.entries.length, version: printingData.version })
      : '',
    printingIndex: printingData ? buildPrintingIndex(printingData) : null,
    printingOrigin: printing?.origin ?? null,
    text: art.raw ? textIndexFromArtworkPayload(art.raw) : null,
  };
  state.active = active;
  notify();
  return active;
};

/**
 * Load usable indexes immediately (disk → bundled → null).
 * Does not block on network.
 */
export const loadScannerIndexesLocal = async (): Promise<ActiveScannerIndexes | null> => {
  if (state.active) return state.active;
  const meta = await readMeta();
  state.lastCheckAt = meta.lastCheckAt ?? null;

  const diskNames = await readDiskJson('card-names.json');
  const namesChecked = diskNames ? validateNameIndexData(diskNames) : null;
  const diskArt = await readDiskJson('art-index.json');
  const artChecked = diskArt
    ? validateArtworkIndexData(diskArt, { minEntries: ART_INDEX_MIN_PRODUCTION_ENTRIES })
    : null;
  const diskPrinting = await readDiskJson('printing-index.json');
  const printingChecked = diskPrinting
    ? validatePrintingIndexData(diskPrinting, { minEntries: 1 })
    : null;
  const printingPayload = printingChecked?.data
    ? {
        data: printingChecked.data,
        origin: 'disk' as ScannerDataOrigin,
      }
    : { data: null, origin: null };

  if (namesChecked?.data && namesChecked.data.names.length >= NAME_INDEX_MIN_PRODUCTION_NAMES) {
    return activateFromNameData(
      namesChecked.data,
      'disk',
      {
        data: artChecked?.data ?? null,
        origin: artChecked?.data ? 'disk' : 'memory',
        raw: diskArt ?? undefined,
      },
      printingPayload,
    );
  }

  const bundled = await loadBundledNames();
  if (bundled) {
    return activateFromNameData(
      bundled,
      'bundled',
      {
        data: artChecked?.data ?? null,
        origin: artChecked?.data ? 'disk' : 'memory',
        raw: diskArt ?? undefined,
      },
      printingPayload,
    );
  }

  return null;
};

export const getScannerDataStatus = (): ScannerDataStatus => {
  const a = state.active;
  return {
    artEntries: a?.art?.entries.length ?? null,
    artGenerated: a?.artGenerated ?? null,
    artOrigin: a?.artOrigin ?? null,
    artChecksum: a?.artChecksum ?? null,
    lastCheckAt: state.lastCheckAt,
    lastError: state.lastError,
    manifestGeneratedAt: state.manifest?.generatedAt ?? null,
    names: a?.names ?? null,
    namesChecksum: a?.nameChecksum ?? null,
    namesOrigin: a?.nameOrigin ?? null,
    printingEntries: a?.printing?.entries.length ?? null,
    printingChecksum: a?.printingChecksum ?? null,
    printingOrigin: a?.printingOrigin ?? null,
    statusLabel: state.updating
      ? 'Checking'
      : state.lastError && !a
        ? 'Offline'
        : a
          ? 'Current'
          : 'Unknown',
    updating: state.updating,
  };
};

export const peekActiveScannerIndexes = (): ActiveScannerIndexes | null => state.active;

const installAsset = async (
  url: string,
  expectedSha: string,
  destName: string,
  validate: (raw: unknown) => void,
): Promise<unknown> => {
  const bytes = await fetchBytes(url);
  const digest = await sha256Hex(bytes);
  if (digest.toLowerCase() !== expectedSha.toLowerCase()) {
    throw new Error(`checksum mismatch for ${destName}`);
  }
  const raw = parseJsonBytes(bytes);
  validate(raw);
  await atomicWriteJson(destName, new TextDecoder().decode(bytes));
  return raw;
};

export const checkScannerDataUpdates = async (
  opts: { force?: boolean; base?: string } = {},
): Promise<{ updated: boolean; reason: string }> => {
  const base = (opts.base ?? DEFAULT_INDEX_BASE).replace(/\/?$/, '/');
  const now = Date.now();
  const meta = await readMeta();
  if (
    !opts.force &&
    meta.lastCheckAt &&
    now - meta.lastCheckAt < SCANNER_MANIFEST_CHECK_INTERVAL_MS
  ) {
    return { updated: false, reason: 'check throttled' };
  }

  state.updating = true;
  state.lastError = null;
  notify();

  try {
    const manifestUrl = `${base}${SCANNER_MANIFEST_FILENAME}`;
    assertAllowedUrl(manifestUrl);
    let manifestRaw: unknown;
    try {
      manifestRaw = parseJsonBytes(await fetchBytes(manifestUrl));
    } catch {
      return await legacyDirectRefresh(base, meta);
    }
    if (!isScannerManifest(manifestRaw)) {
      return await legacyDirectRefresh(base, meta);
    }
    state.manifest = manifestRaw;

    const needNames =
      !meta.namesSha256 ||
      meta.namesSha256.toLowerCase() !== manifestRaw.cardNames.sha256.toLowerCase();
    const needArt =
      !meta.artSha256 ||
      meta.artSha256.toLowerCase() !== manifestRaw.artIndex.sha256.toLowerCase();
    const needPrinting =
      Boolean(manifestRaw.printingIndex) &&
      (!meta.printingSha256 ||
        meta.printingSha256.toLowerCase() !==
          (manifestRaw.printingIndex?.sha256 ?? '').toLowerCase());

    if (!needNames && !needArt && !needPrinting) {
      await writeMeta({
        ...meta,
        lastCheckAt: now,
        manifestGeneratedAt: manifestRaw.generatedAt,
        namesSha256: manifestRaw.cardNames.sha256,
        artSha256: manifestRaw.artIndex.sha256,
        printingSha256: manifestRaw.printingIndex?.sha256 ?? meta.printingSha256,
      });
      state.lastCheckAt = now;
      return { updated: false, reason: 'manifest matches disk' };
    }

    let namesRaw: unknown = await readDiskJson('card-names.json');
    let artRaw: unknown = await readDiskJson('art-index.json');
    let printingRaw: unknown = await readDiskJson('printing-index.json');

    if (needNames) {
      namesRaw = await installAsset(
        manifestRaw.cardNames.url.startsWith('http')
          ? manifestRaw.cardNames.url
          : `${base}card-names.json`,
        manifestRaw.cardNames.sha256,
        'card-names.json',
        raw => {
          const v = validateNameIndexData(raw);
          if (v.reason || !v.data) throw new Error(v.reason ?? 'bad names');
          if (v.data.names.length < NAME_INDEX_MIN_PRODUCTION_NAMES) {
            throw new Error(`names too few (${v.data.names.length})`);
          }
        },
      );
    }
    if (needArt) {
      artRaw = await installAsset(
        manifestRaw.artIndex.url.startsWith('http')
          ? manifestRaw.artIndex.url
          : `${base}art-index.json`,
        manifestRaw.artIndex.sha256,
        'art-index.json',
        raw => {
          const v = validateArtworkIndexData(raw);
          if (v.reason || !v.data) throw new Error(v.reason ?? 'bad art');
        },
      );
    }
    if (needPrinting && manifestRaw.printingIndex) {
      printingRaw = await installAsset(
        manifestRaw.printingIndex.url.startsWith('http')
          ? manifestRaw.printingIndex.url
          : `${base}printing-index.json`,
        manifestRaw.printingIndex.sha256,
        'printing-index.json',
        raw => {
          const v = validatePrintingIndexData(raw, {
            minEntries: PRINTING_INDEX_MIN_PRODUCTION_ENTRIES,
          });
          if (v.reason || !v.data) throw new Error(v.reason ?? 'bad printing');
        },
      );
    }

    const names = validateNameIndexData(namesRaw);
    const art = validateArtworkIndexData(artRaw ?? {}, {
      minEntries: ART_INDEX_MIN_PRODUCTION_ENTRIES,
    });
    const printing = printingRaw
      ? validatePrintingIndexData(printingRaw, { minEntries: 1 })
      : null;
    if (!names.data) throw new Error(names.reason ?? 'names missing after install');

    activateFromNameData(
      names.data,
      'disk',
      {
        data: art.data ?? null,
        origin: art.data ? 'disk' : 'memory',
        raw: artRaw ?? undefined,
      },
      {
        data: printing?.data ?? null,
        origin: printing?.data ? 'disk' : null,
      },
    );

    await writeMeta({
      lastCheckAt: now,
      manifestGeneratedAt: manifestRaw.generatedAt,
      namesSha256: manifestRaw.cardNames.sha256,
      artSha256: manifestRaw.artIndex.sha256,
      printingSha256: manifestRaw.printingIndex?.sha256,
      namesVersion: manifestRaw.cardNames.version,
      artVersion: manifestRaw.artIndex.version,
      printingVersion: manifestRaw.printingIndex?.version,
      namesChecksum: state.active?.nameChecksum,
      artChecksum: state.active?.artChecksum,
      printingChecksum: state.active?.printingChecksum,
    });
    state.lastCheckAt = now;
    return { updated: true, reason: 'installed newer scanner data' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    state.lastError = message;
    await writeMeta({ ...(await readMeta()), lastCheckAt: now });
    state.lastCheckAt = now;
    return { updated: false, reason: message };
  } finally {
    state.updating = false;
    notify();
  }
};

const legacyDirectRefresh = async (
  base: string,
  meta: DiskMeta,
): Promise<{ updated: boolean; reason: string }> => {
  const namesBytes = await fetchBytes(`${base}card-names.json`);
  const artBytes = await fetchBytes(`${base}art-index.json`);
  let printingBytes: Uint8Array | null = null;
  try {
    printingBytes = await fetchBytes(`${base}printing-index.json`);
  } catch {
    printingBytes = null;
  }
  const namesRaw = parseJsonBytes(namesBytes);
  const artRaw = parseJsonBytes(artBytes);
  const printingRaw = printingBytes ? parseJsonBytes(printingBytes) : null;
  const names = validateNameIndexData(namesRaw);
  const art = validateArtworkIndexData(artRaw);
  const printing = printingRaw
    ? validatePrintingIndexData(printingRaw, { minEntries: 1 })
    : null;
  if (!names.data) throw new Error(names.reason ?? 'bad names');
  if (!art.data) throw new Error(art.reason ?? 'bad art');

  const namesSha = await sha256Hex(namesBytes);
  const artSha = await sha256Hex(artBytes);
  const printingSha = printingBytes ? await sha256Hex(printingBytes) : undefined;
  if (
    meta.namesSha256 === namesSha &&
    meta.artSha256 === artSha &&
    (!printingSha || meta.printingSha256 === printingSha) &&
    state.active
  ) {
    await writeMeta({ ...meta, lastCheckAt: Date.now() });
    return { updated: false, reason: 'direct fetch unchanged' };
  }

  await atomicWriteJson('card-names.json', new TextDecoder().decode(namesBytes));
  await atomicWriteJson('art-index.json', new TextDecoder().decode(artBytes));
  if (printingBytes && printing?.data) {
    await atomicWriteJson('printing-index.json', new TextDecoder().decode(printingBytes));
  }
  activateFromNameData(
    names.data,
    'disk',
    {
      data: art.data,
      origin: 'disk',
      raw: artRaw,
    },
    {
      data: printing?.data ?? null,
      origin: printing?.data ? 'disk' : null,
    },
  );
  await writeMeta({
    lastCheckAt: Date.now(),
    namesSha256: namesSha,
    artSha256: artSha,
    printingSha256: printingSha,
    namesChecksum: state.active?.nameChecksum,
    artChecksum: state.active?.artChecksum,
    printingChecksum: state.active?.printingChecksum,
  });
  return { updated: true, reason: 'legacy direct install' };
};

export const resetScannerDataState = (): void => {
  state.active = null;
  state.lastError = null;
  state.lastCheckAt = null;
  state.manifest = null;
  state.updating = false;
};
