import { Platform, Share } from 'react-native';

import { scanImageToPngBytes } from './debug/scanImagePng';
import type { GeometryTraceBundle } from './geometryTrace';

export type SaveGeometryTraceResult =
  | { ok: true; directoryHint: string; sampleCount: number; uri: string }
  | { ok: false; reason: string };

const bytesToBase64 = (bytes: Uint8Array): string => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      alphabet[(n >> 18) & 63] +
      alphabet[(n >> 12) & 63] +
      alphabet[(n >> 6) & 63] +
      alphabet[n & 63];
  }
  const rem = bytes.length % 3;
  if (rem === 1) {
    const n = bytes[bytes.length - 1] << 16;
    out += `${alphabet[(n >> 18) & 63]}${alphabet[(n >> 12) & 63]}==`;
  } else if (rem === 2) {
    const n = (bytes[bytes.length - 2] << 16) | (bytes[bytes.length - 1] << 8);
    out += `${alphabet[(n >> 18) & 63]}${alphabet[(n >> 12) & 63]}${alphabet[(n >> 6) & 63]}=`;
  }
  return out;
};

const slimSample = (s: GeometryTraceBundle['samples'][number]) => ({
  seq: s.sequence,
  t: Math.round(s.t),
  hit: s.hit,
  score: Number(s.rawScore.toFixed(3)),
  role: s.role,
  reason: s.selectionReason,
  iou: Number(s.iou.toFixed(3)),
  center: Number(s.centerDelta.toFixed(3)),
  area: Number(s.areaDelta.toFixed(3)),
  rot: Number(s.rotationDelta.toFixed(3)),
  corner: Number(s.cornerDelta.toFixed(3)),
  intervalMs: s.detectorIntervalMs != null ? Math.round(s.detectorIntervalMs) : null,
  phase: s.phase,
  lockBlocker: s.lockBlocker,
  trackId: s.trackId,
  trackAge: s.trackAge,
  roleSwitches: s.roleSwitchCount,
  reset: s.resetReason,
  selectedIndex: s.selectedIndex,
  candidateCount: s.candidateCount,
  focusKind: s.focusKind ?? null,
  focusRequests: s.focusRequests ?? null,
  focusSuccesses: s.focusSuccesses ?? null,
  focusTimeouts: s.focusTimeouts ?? null,
  focusReentries: s.focusReentries ?? null,
  focusWaitMs: s.focusWaitMs != null ? Math.round(s.focusWaitMs) : null,
  focusTimedOut: s.focusTimedOut ?? null,
  highResRequests: s.highResRequests ?? null,
  highResSuccess: s.highResSuccess ?? null,
  highResFailure: s.highResFailure ?? null,
  lastHighResError: s.lastHighResError ?? null,
  recognizeInvocations: s.recognizeInvocations ?? null,
  recognitionStatus: s.recognitionStatus ?? null,
  retryReason: s.retryReason ?? null,
  postLockStall: s.postLockStall ?? null,
  titleRaw: s.titleRawText ?? null,
  titleTop: s.titleTopCandidate ?? null,
  trackHold: s.trackHoldReason ?? null,
  trackUpdate: s.trackUpdateReason ?? null,
  trackedUpdatedAt: s.trackedQuadUpdatedAt != null ? Math.round(s.trackedQuadUpdatedAt) : null,
  consecutiveStable: s.consecutiveStable ?? null,
  stableDurationMs: s.stableDurationMs != null ? Math.round(s.stableDurationMs) : null,
  raw: s.rawCorners,
  tracked: s.trackedCorners,
  recognition: s.recognitionCorners,
  recognitionSource: s.recognitionQuadSource ?? null,
  recognitionValid: s.recognitionQuadValid ?? null,
  recognitionReject: s.recognitionRejectReasons ?? [],
  presented: s.presentedCorners,
  candidates: s.candidates.slice(0, 4).map(c => ({
    score: Number(c.score.toFixed(3)),
    aspect: c.aspect,
    corners: c.corners,
  })),
});

export const writeGeometryTraceFiles = async (
  bundle: GeometryTraceBundle,
): Promise<SaveGeometryTraceResult> => {
  try {
    const FileSystem = await import('expo-file-system/legacy');
    const root = FileSystem.documentDirectory;
    if (!root) return { ok: false, reason: 'documentDirectory unavailable' };
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const dir = `${root}lugin-geometry/${stamp}/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

    const json = JSON.stringify(
      { meta: bundle.meta, samples: bundle.samples.map(slimSample) },
      null,
      2,
    );
    await FileSystem.writeAsStringAsync(`${dir}geometry-trace.json`, json);

    const writePng = async (name: string, image: typeof bundle.images.first) => {
      if (!image) return;
      const png = scanImageToPngBytes(image, Math.min(image.width, 640));
      await FileSystem.writeAsStringAsync(`${dir}${name}`, bytesToBase64(png), {
        encoding: 'base64',
      });
    };
    await writePng('detector-first.png', bundle.images.first);
    await writePng('detector-middle.png', bundle.images.middle);
    await writePng('detector-last.png', bundle.images.last);

    return {
      ok: true,
      directoryHint: `Documents/lugin-geometry/${stamp}`,
      sampleCount: bundle.meta.sampleCount,
      uri: dir,
    };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
};

export const shareGeometryTrace = async (dirUri: string): Promise<{ ok: boolean; reason?: string }> => {
  try {
    const FileSystem = await import('expo-file-system/legacy');
    const jsonUri = `${dirUri}geometry-trace.json`;
    if (Platform.OS === 'android') {
      await Share.share({ message: 'Lugin geometry trace', url: jsonUri, title: 'Geometry trace' });
    } else {
      await Share.share({ url: jsonUri });
    }
    const info = await FileSystem.getInfoAsync(jsonUri);
    return info.exists ? { ok: true } : { ok: false, reason: 'trace file missing' };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
};
