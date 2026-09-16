// Geometry Test local persistence (dev / benchmarkTools only).
// Benchmark corpus PNGs are FULL resolution — never the 120px thumbnail default.

import {
  assertGeometryCardArtifactDims,
  assertGeometrySourceArtifactDims,
  geometryItemStem,
  monoNow,
  type GeometryTestBundle,
  type GeometryTestItemRecord,
} from '@/lib/scan/geometryTest';
import type { ScanImage } from '../sharedCore';
import {
  bytesToBase64,
  pngIhdrDimensions,
  scanImageToArtifactPngBytes,
  scanImageToThumbnailPngBytes,
} from '../debug/scanImagePng';
import { isBenchmarkToolsEnabled } from '../benchmark/isBenchmarkEnabled';

/** Display-only Geometry preview width (phone screen). Never a benchmark artifact. */
export const GEOMETRY_DISPLAY_PREVIEW_MAX_WIDTH = 420;

type LegacyFS = typeof import('expo-file-system/legacy');

const ROOT = 'lugin-geometry-test/';
const ACTIVE = 'active-run.json';

const fs = async (): Promise<LegacyFS> => import('expo-file-system/legacy');

export const geometryTestRoot = async (): Promise<string> => {
  const FileSystem = await fs();
  const root = FileSystem.documentDirectory;
  if (!root) throw new Error('documentDirectory unavailable');
  const dir = `${root}${ROOT}`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
};

export const geometryRunDir = async (fixtureId: string): Promise<string> => {
  const FileSystem = await fs();
  const dir = `${await geometryTestRoot()}${fixtureId}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
};

const writeJson = async (uri: string, value: unknown) => {
  const FileSystem = await fs();
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(value, null, 2));
};

const writePng = async (uri: string, bytes: Uint8Array) => {
  const FileSystem = await fs();
  await FileSystem.writeAsStringAsync(uri, bytesToBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });
};

export const persistGeometryActiveMeta = async (fixtureId: string | null) => {
  if (!isBenchmarkToolsEnabled()) return;
  const FileSystem = await fs();
  const uri = `${await geometryTestRoot()}${ACTIVE}`;
  if (!fixtureId) {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) await FileSystem.deleteAsync(uri, { idempotent: true });
    return;
  }
  await writeJson(uri, { fixtureId });
};

export const loadGeometryActiveMeta = async (): Promise<{ fixtureId: string } | null> => {
  if (!isBenchmarkToolsEnabled()) return null;
  try {
    const FileSystem = await fs();
    const uri = `${await geometryTestRoot()}${ACTIVE}`;
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    return JSON.parse(await FileSystem.readAsStringAsync(uri)) as { fixtureId: string };
  } catch {
    return null;
  }
};

export const saveGeometryBundle = async (bundle: GeometryTestBundle): Promise<string> => {
  const dir = await geometryRunDir(bundle.fixtureId);
  await writeJson(`${dir}summary.json`, bundle);
  return dir;
};

export const loadGeometryBundle = async (
  fixtureId: string,
): Promise<GeometryTestBundle | null> => {
  try {
    const FileSystem = await fs();
    const uri = `${await geometryRunDir(fixtureId)}summary.json`;
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    return JSON.parse(await FileSystem.readAsStringAsync(uri)) as GeometryTestBundle;
  } catch {
    return null;
  }
};

export type GeometryCardPersistResult = {
  record: GeometryTestItemRecord;
  cardUri: string;
  cardBytes: number;
  encodedWidth: number;
  encodedHeight: number;
  encodeStartAt: number;
  encodeDoneAt: number;
  writeStartAt: number;
  writeDoneAt: number;
};

/** Persist the true 744×1039 card warp. Throws if encoded IHDR is wrong. */
export const saveGeometryCardArtifact = async (args: {
  fixtureId: string;
  record: GeometryTestItemRecord;
  cardWarp: ScanImage;
}): Promise<GeometryCardPersistResult> => {
  const dir = await geometryRunDir(args.fixtureId);
  const stem = geometryItemStem(args.record.itemIndex);
  const name = `${stem}-card.png`;
  const thumbName = `${stem}-card-thumbnail.png`;
  const encodeStartAt = monoNow();
  const bytes = scanImageToArtifactPngBytes(args.cardWarp);
  const encodeDoneAt = monoNow();
  const ihdr = pngIhdrDimensions(bytes);
  if (!ihdr) throw new Error('geometry card PNG missing IHDR');
  assertGeometryCardArtifactDims({
    encodedWidth: ihdr.width,
    encodedHeight: ihdr.height,
    bytes: bytes.length,
  });
  const writeStartAt = monoNow();
  await writePng(`${dir}${name}`, bytes);
  // Optional contact-sheet thumb — explicit name, never replaces card.png.
  await writePng(`${dir}${thumbName}`, scanImageToThumbnailPngBytes(args.cardWarp, 120));
  const writeDoneAt = monoNow();

  const next: GeometryTestItemRecord = {
    ...args.record,
    warpWidth: args.cardWarp.width,
    warpHeight: args.cardWarp.height,
    cardEncodedWidth: ihdr.width,
    cardEncodedHeight: ihdr.height,
    cardArtifactBytes: bytes.length,
    files: {
      ...args.record.files,
      metadata: args.record.files.metadata || `${stem}-metadata.json`,
      cardWarp: name,
      cardThumbnail: thumbName,
    },
    artifacts: {
      ...args.record.artifacts,
      cardWarp: {
        role: 'card-warp',
        logicalWidth: args.cardWarp.width,
        logicalHeight: args.cardWarp.height,
        encodedWidth: ihdr.width,
        encodedHeight: ihdr.height,
        bytes: bytes.length,
      },
    },
  };
  await writeJson(`${dir}${next.files.metadata}`, next);
  return {
    record: next,
    cardUri: `${dir}${name}`,
    cardBytes: bytes.length,
    encodedWidth: ihdr.width,
    encodedHeight: ihdr.height,
    encodeStartAt,
    encodeDoneAt,
    writeStartAt,
    writeDoneAt,
  };
};

/** Persist full-resolution source. Throws if IHDR ≠ buffer size. */
export const saveGeometrySourceArtifact = async (args: {
  fixtureId: string;
  record: GeometryTestItemRecord;
  source: ScanImage;
}): Promise<GeometryTestItemRecord> => {
  const dir = await geometryRunDir(args.fixtureId);
  const stem = geometryItemStem(args.record.itemIndex);
  const name = `${stem}-source.png`;
  const bytes = scanImageToArtifactPngBytes(args.source);
  const ihdr = pngIhdrDimensions(bytes);
  if (!ihdr) throw new Error('geometry source PNG missing IHDR');
  // Reject classic thumbnail trap before writing a bad corpus file.
  if (args.source.width <= 120 || ihdr.width <= 120) {
    throw new Error(
      `geometry source buffer is thumbnail-sized (${args.source.width}×${args.source.height}) — refusing to write source.png`,
    );
  }
  assertGeometrySourceArtifactDims({
    logicalWidth: args.source.width,
    logicalHeight: args.source.height,
    encodedWidth: ihdr.width,
    encodedHeight: ihdr.height,
    bytes: bytes.length,
  });
  await writePng(`${dir}${name}`, bytes);

  const next: GeometryTestItemRecord = {
    ...args.record,
    sourceWidth: args.source.width,
    sourceHeight: args.source.height,
    sourceEncodedWidth: ihdr.width,
    sourceEncodedHeight: ihdr.height,
    sourceArtifactBytes: bytes.length,
    files: {
      ...args.record.files,
      metadata: args.record.files.metadata || `${stem}-metadata.json`,
      source: name,
    },
    artifacts: {
      ...args.record.artifacts,
      source: {
        role: 'source',
        logicalWidth: args.source.width,
        logicalHeight: args.source.height,
        encodedWidth: ihdr.width,
        encodedHeight: ihdr.height,
        bytes: bytes.length,
      },
    },
  };
  await writeJson(`${dir}${next.files.metadata}`, next);
  return next;
};

/** Metadata-only update (no image rewrite). */
export const saveGeometryItemMetadata = async (args: {
  fixtureId: string;
  record: GeometryTestItemRecord;
}): Promise<GeometryTestItemRecord> => {
  const dir = await geometryRunDir(args.fixtureId);
  const stem = geometryItemStem(args.record.itemIndex);
  const metaName = args.record.files.metadata || `${stem}-metadata.json`;
  const next: GeometryTestItemRecord = {
    ...args.record,
    files: { ...args.record.files, metadata: metaName },
  };
  await writeJson(`${dir}${metaName}`, next);
  return next;
};

/**
 * @deprecated Prefer {@link saveGeometryCardArtifact} + {@link saveGeometrySourceArtifact}
 * so display can happen before source encode.
 */
export const saveGeometryItemArtifacts = async (args: {
  fixtureId: string;
  record: GeometryTestItemRecord;
  source: ScanImage | null;
  cardWarp: ScanImage | null;
}): Promise<GeometryTestItemRecord> => {
  let next = args.record;
  if (args.cardWarp) {
    next = (await saveGeometryCardArtifact({
      fixtureId: args.fixtureId,
      record: next,
      cardWarp: args.cardWarp,
    })).record;
  }
  if (args.source) {
    next = await saveGeometrySourceArtifact({
      fixtureId: args.fixtureId,
      record: next,
      source: args.source,
    });
  }
  if (!args.cardWarp && !args.source) {
    next = await saveGeometryItemMetadata({ fixtureId: args.fixtureId, record: next });
  }
  return next;
};

export const fileUriForGeometryArtifact = async (
  fixtureId: string,
  name: string,
): Promise<string> => {
  const dir = await geometryRunDir(fixtureId);
  return `${dir}${name}`;
};
