/**
 * Manual capture for a long session.
 *
 * The tap saves a native JPEG and a small thumbnail, then returns.
 * Every straightened card is written and uploaded before any of them is named.
 * A name that does not finish cannot hold the next picture. Full frames are
 * not kept in memory.
 */

import { cornersToQuad, warpQuadToCard } from '@/lib/scan/geometry';
import { withBoundedTimeout } from '@/lib/scan/boundedPromise';
import { Images, type Image } from 'react-native-nitro-image';

import { runBenchmarkUploadSession } from './benchmarkUpload/session';
import { waitUntilCaptureGap } from './capturePace';
import { scanImageToThumbnailPngDataUri } from './debug/scanImagePng';
import type { HiResSpaces } from './hiresCapture';
import { mapCornersToHiRes } from './hiresMap';
import { imageToScanImage } from './imageToScanImage';
import { trackSend } from './sendProgress';
import type { CardCorners, ScanImage } from './sharedCore';

type LegacyFS = typeof import('expo-file-system/legacy');

const fs = async (): Promise<LegacyFS> => import('expo-file-system/legacy');

const absPath = (uri: string): string => (uri.startsWith('file://') ? uri.slice('file://'.length) : uri);

const drop = (image: Image | null | undefined): void => {
  image?.dispose();
};

type QueuedCard = {
  absJpeg: string;
  dirUri: string;
  jpegUpload: Promise<boolean>;
  onName: ((warp: ScanImage) => Promise<void>) | null;
  runId: string;
  score: number;
  spaces: HiResSpaces;
  corners: CardCorners;
  /** Straightened JPEG is already on disk. */
  warpSaved: boolean;
  warpUpload: Promise<boolean>;
};

const queue: QueuedCard[] = [];
const toName: QueuedCard[] = [];
let draining = false;

const NAME_MS = 45_000;
const UPLOAD_MS = 20_000;

const WARP_UPLOAD = [
  { relativePath: 'source.jpg', required: true },
  { relativePath: 'metadata.json', required: true },
  { relativePath: 'recognition-quad.json', required: true },
  { relativePath: 'recognition-card.jpg', required: true },
];

const uploadFiles = async (
  runId: string,
  dirUri: string,
  files: { relativePath: string; required: boolean }[],
): Promise<boolean> => {
  const result = await runBenchmarkUploadSession({
    dirUri,
    manifest: {
      createdAt: new Date().toISOString(),
      files: files.map(file => ({ ...file, logicalHeight: null, logicalWidth: null })),
      kind: 'normal-scan',
      runId,
    },
  });
  return result.uploadStatus === 'COMPLETE';
};

const writeWarpJpeg = async (dirUri: string, warp: ScanImage): Promise<void> => {
  const copy = new Uint8Array(warp.data.length);
  copy.set(warp.data);
  const soft = await Images.loadFromRawPixelDataAsync({
    buffer: copy.buffer,
    height: warp.height,
    pixelFormat: 'RGBA',
    width: warp.width,
  });
  try {
    await soft.saveToFileAsync(absPath(`${dirUri}recognition-card.jpg`), 'jpg', 82);
  } finally {
    soft.dispose();
  }
};

const warpJpeg = async (card: QueuedCard, longEdge: number, outW: number, outH: number): Promise<ScanImage> => {
  const image = await Images.loadFromFileAsync(card.absJpeg);
  const long = Math.max(image.width, image.height);
  const scale = long > longEdge ? longEdge / long : 1;
  const sized =
    scale === 1
      ? image
      : image.resize(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
  try {
    const source = await imageToScanImage(sized, longEdge);
    const mapped = mapCornersToHiRes(card.corners, {
      dest: { height: source.height, width: source.width },
      destMirrored: false,
      detector: card.spaces.detector,
      kind: 'same-fov',
      oriented: card.spaces.oriented,
      visible: card.spaces.visible,
    });
    return warpQuadToCard(source, cornersToQuad(mapped), outW, outH);
  } finally {
    if (sized !== image) drop(sized);
    drop(image);
  }
};

const finishCard = async (card: QueuedCard, attempted: boolean): Promise<void> => {
  const FileSystem = await fs();
  if (attempted) {
    try {
      await FileSystem.writeAsStringAsync(
        `${card.dirUri}named.json`,
        JSON.stringify({ at: new Date().toISOString() }),
      );
    } catch {
      // The directory may already be gone after a confirmed upload.
    }
  }
  const warpOk = await card.warpUpload;
  const jpegOk = await card.jpegUpload;
  if (jpegOk && warpOk) await FileSystem.deleteAsync(card.dirUri, { idempotent: true });
};

/** Write the straightened JPEG and start its upload. Naming is not called here. */
const saveWarp = async (card: QueuedCard): Promise<void> => {
  await waitUntilCaptureGap();
  const warp = await warpJpeg(card, 1280, 744, 1039);
  await writeWarpJpeg(card.dirUri, warp);
  card.warpSaved = true;
  card.warpUpload = withBoundedTimeout(uploadFiles(card.runId, card.dirUri, WARP_UPLOAD), UPLOAD_MS).catch(
    () => false,
  );
  toName.push(card);
};

const nameCard = async (card: QueuedCard): Promise<void> => {
  await waitUntilCaptureGap();
  if (!card.onName) {
    await finishCard(card, false);
    return;
  }
  let attempted = false;
  try {
    const warp = await warpJpeg(card, 1280, 744, 1039);
    if (!card.warpSaved) {
      await writeWarpJpeg(card.dirUri, warp);
      card.warpSaved = true;
      card.warpUpload = withBoundedTimeout(uploadFiles(card.runId, card.dirUri, WARP_UPLOAD), UPLOAD_MS).catch(
        () => false,
      );
    }
    attempted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((_, reject) => {
      timer = setTimeout(() => reject(new Error('naming took too long')), NAME_MS);
    });
    const naming = (async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      await card.onName!(warp);
    })();
    void naming.catch(() => {});
    try {
      await Promise.race([timeout, naming]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch {
    // The straightened JPEG is already on its way. The next card does not wait.
  }
  await finishCard(card, attempted);
};

const drain = async (): Promise<void> => {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const card = queue.shift();
      if (card) {
        try {
          if (card.warpSaved) toName.push(card);
          else await saveWarp(card);
        } catch {
          toName.push(card);
        }
        continue;
      }
      const naming = toName.shift();
      if (!naming) break;
      if (queue.length > 0) {
        toName.unshift(naming);
        continue;
      }
      await nameCard(naming);
    }
  } finally {
    draining = false;
    if (queue.length > 0 || toName.length > 0) void drain();
  }
};

export const captureColorCard = async (args: {
  captureId: number;
  cardSessionId: number;
  corners: CardCorners;
  onName: ((warp: ScanImage) => Promise<void>) | null;
  parentSessionId: string;
  childId: string;
  saveSnapshotJpeg: (absolutePath: string) => Promise<Image>;
  score: number;
  spaces: HiResSpaces;
}): Promise<{ ok: true; previewUri: string } | { ok: false; reason: string }> => {
  const FileSystem = await fs();
  const root = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? '';
  if (!root) return { ok: false, reason: 'no app storage' };
  const runId = `${args.parentSessionId}--${args.childId}`.slice(0, 80);
  const dirUri = `${root}normal-scan/${runId}/`;
  await FileSystem.makeDirectoryAsync(dirUri, { intermediates: true });
  const jpegUri = `${dirUri}source.jpg`;
  let snap: Image | null = null;
  let previewUri = '';
  try {
    snap = await args.saveSnapshotJpeg(absPath(jpegUri));
    try {
      const long = Math.max(snap.width, snap.height);
      const scale = long > 320 ? 320 / long : 1;
      const thumbSource =
        scale === 1
          ? snap
          : snap.resize(
              Math.max(1, Math.round(snap.width * scale)),
              Math.max(1, Math.round(snap.height * scale)),
            );
      try {
        const pixels = await imageToScanImage(thumbSource, 320);
        const mapped = mapCornersToHiRes(args.corners, {
          dest: { height: pixels.height, width: pixels.width },
          destMirrored: false,
          detector: args.spaces.detector,
          kind: 'same-fov',
          oriented: args.spaces.oriented,
          visible: args.spaces.visible,
        });
        previewUri = scanImageToThumbnailPngDataUri(
          warpQuadToCard(pixels, cornersToQuad(mapped), 120, 168),
          120,
        );
      } finally {
        if (thumbSource !== snap) drop(thumbSource);
      }
    } catch {
      previewUri = jpegUri;
    }
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'Could not take a color picture. Hold the card in view and tap again.',
    };
  } finally {
    drop(snap);
  }

  const quad = {
    kind: 'recognition-quad',
    captureId: args.captureId,
    cardSessionId: args.cardSessionId,
    corners: args.corners,
    detector: args.spaces.detector,
    picture: 'source.jpg',
    score: args.score,
  };
  await FileSystem.writeAsStringAsync(`${dirUri}recognition-quad.json`, JSON.stringify(quad));
  await FileSystem.writeAsStringAsync(
    `${dirUri}metadata.json`,
    JSON.stringify({
      kind: 'normal-scan',
      captureId: args.captureId,
      cardSessionId: args.cardSessionId,
      childId: args.childId,
      parentSessionId: args.parentSessionId,
      picture: 'source.jpg',
      savedAt: new Date().toISOString(),
    }),
  );

  let jpegOk = false;
  const jpegUpload = trackSend(runId, 3, async onProgress => {
    const ok = await withBoundedTimeout(
      uploadFiles(runId, dirUri, [
        { relativePath: 'source.jpg', required: true },
        { relativePath: 'metadata.json', required: true },
        { relativePath: 'recognition-quad.json', required: true },
      ]),
      UPLOAD_MS,
    ).catch(() => false);
    jpegOk = ok;
    onProgress(ok ? 3 : 0, 3, ok ? null : 'Picture is still on the phone');
    return { detail: ok ? null : 'Picture is still on the phone', done: ok ? 3 : 0, ok, total: 3 };
  }).then(() => jpegOk);

  queue.push({
    absJpeg: absPath(jpegUri),
    corners: args.corners,
    dirUri,
    jpegUpload,
    onName: args.onName,
    runId,
    score: args.score,
    spaces: {
      detector: { ...args.spaces.detector },
      oriented: { ...args.spaces.oriented },
      overlay: { ...args.spaces.overlay },
      visible: { ...args.spaces.visible },
    },
    warpSaved: false,
    warpUpload: Promise.resolve(false),
  });
  void drain();
  return { ok: true, previewUri };
};

/** Name pictures still on disk from an earlier session. One at a time, same as a live tap. */
export const resumeSavedCards = (onName: (warp: ScanImage) => Promise<void>): void => {
  void (async () => {
    const FileSystem = await fs();
    const root = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? '';
    if (!root) return;
    const base = `${root}normal-scan/`;
    const info = await FileSystem.getInfoAsync(base);
    if (!info.exists) return;
    const names = await FileSystem.readDirectoryAsync(base);
    for (const name of names) {
      const dirUri = `${base}${name}/`;
      const jpeg = await FileSystem.getInfoAsync(`${dirUri}source.jpg`);
      const straight = await FileSystem.getInfoAsync(`${dirUri}recognition-card.jpg`);
      const oldPng = await FileSystem.getInfoAsync(`${dirUri}recognition-card.png`);
      const named = await FileSystem.getInfoAsync(`${dirUri}named.json`);
      const quadFile = await FileSystem.getInfoAsync(`${dirUri}recognition-quad.json`);
      if (!jpeg.exists || !quadFile.exists || oldPng.exists) continue;
      if (named.exists && straight.exists) {
        void withBoundedTimeout(uploadFiles(name, dirUri, WARP_UPLOAD), UPLOAD_MS)
          .then(async ok => {
            if (ok) await FileSystem.deleteAsync(dirUri, { idempotent: true });
          })
          .catch(() => false);
        continue;
      }
      const quad = JSON.parse(await FileSystem.readAsStringAsync(`${dirUri}recognition-quad.json`)) as {
        corners?: CardCorners;
        detector?: { height: number; width: number };
        score?: number;
      };
      if (!quad.corners || !quad.detector) continue;
      const warpUpload = straight.exists
        ? withBoundedTimeout(uploadFiles(name, dirUri, WARP_UPLOAD), UPLOAD_MS).catch(() => false)
        : Promise.resolve(false);
      queue.push({
        absJpeg: absPath(`${dirUri}source.jpg`),
        corners: quad.corners,
        dirUri,
        jpegUpload: Promise.resolve(true),
        onName,
        runId: name,
        score: quad.score ?? 0,
        spaces: {
          detector: quad.detector,
          oriented: quad.detector,
          overlay: quad.detector,
          visible: { height: quad.detector.height, width: quad.detector.width, x: 0, y: 0 },
        },
        warpSaved: straight.exists,
        warpUpload,
      });
    }
    void drain();
  })();
};
