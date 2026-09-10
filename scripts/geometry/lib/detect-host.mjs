/** Host-side detector runner — shared-js detectCardQuad only. */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';

import { rootDir } from './paths.mjs';

let cached = null;

export const HOST_LIMITATION = {
  nativeAndroidRunsOnHost: false,
  reason:
    'DetectCard.kt (Expo native module) requires Android runtime / JVM instrumentation. Node cannot load Kotlin DetectCard.detectFromRgba or live Y-plane detection.',
  hostEngine: 'shared-js detectCardQuad (src/lib/scan/detectCard.ts)',
  parityPath:
    'yarn scan:detect-native-parity exports RGBA sidecars; gradle unit tests compare Kotlin DetectCard.detectFromRgba offline. That is the deterministic parity path — not a speculative rewrite.',
  extractability:
    'The core algorithm is already mirrored: shared TypeScript is the reference; Kotlin is a port. Host parity = continue running shared-js here + optional gradle RGBA fixtures. A large native rewrite is unnecessary for measurement.',
};

export const loadDetectScan = async () => {
  if (cached) return cached;
  const bundleDir = await mkdtemp(join(tmpdir(), 'lugin-geometry-'));
  const bundle = join(bundleDir, 'scan.mjs');
  await esbuild.build({
    bundle: true,
    format: 'esm',
    outfile: bundle,
    platform: 'neutral',
    stdin: {
      contents: `
        export * from '${join(rootDir, 'src/lib/scan/types.ts')}';
        export * from '${join(rootDir, 'src/lib/scan/geometry.ts')}';
        export * from '${join(rootDir, 'src/lib/scan/detectCard.ts')}';
        export { DETECT_MIN_SCORE } from '${join(rootDir, 'src/lib/scan/params.ts')}';
      `,
      resolveDir: rootDir,
      sourcefile: 'geometry-entry.ts',
    },
  });
  cached = {
    scan: await import(pathToFileURL(bundle).href),
    cleanup: async () => {
      await rm(bundleDir, { recursive: true, force: true });
      cached = null;
    },
  };
  return cached;
};

export const decodeImageFile = async abs => {
  const buf = await readFile(abs);
  const lower = abs.toLowerCase();
  if (lower.endsWith('.png')) {
    const png = PNG.sync.read(buf);
    return {
      data: new Uint8ClampedArray(png.data),
      height: png.height,
      width: png.width,
    };
  }
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
    const j = jpeg.decode(buf, { useTArray: true });
    return {
      data: new Uint8ClampedArray(j.data),
      height: j.height,
      width: j.width,
    };
  }
  throw new Error(`unsupported image type: ${abs}`);
};

export const runHostDetector = async (absImage, { detectMinScore } = {}) => {
  const { scan } = await loadDetectScan();
  const image = await decodeImageFile(absImage);
  const t0 = performance.now();
  const det = scan.detectCardQuad(image);
  const ms = performance.now() - t0;
  const min = detectMinScore ?? scan.DETECT_MIN_SCORE;
  const detected = Boolean(det.corners && det.score >= min);
  return {
    detected,
    corners: det.corners,
    score: det.score,
    runtimeMs: ms,
    method: det.debug?.candidates?.[det.debug.selectedIndex]?.method ?? null,
    polygonIoU: scan.polygonIoU,
    detectMinScore: min,
    candidates: (det.debug?.candidates ?? []).map((c, i) => ({
      rank: i + 1,
      selected: i === det.debug?.selectedIndex,
      quad: c.corners,
      finalScore: c.score,
      method: c.method,
      aspectRatio: null,
      areaShare: null,
      components: c.components ?? null,
      rejectedBecause: c.rejectedBecause ?? null,
    })),
    selectedIndex: det.debug?.selectedIndex ?? null,
    nestedPairs: [],
    diagnostics: {
      candidateCount: det.debug?.candidates?.length ?? 0,
      shortlistCount: det.debug?.candidates?.length ?? 0,
      nestedInnerPreferred: det.debug?.nestedInnerPreferred ?? null,
    },
    engine: 'shared-js',
  };
};
