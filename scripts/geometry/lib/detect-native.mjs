/**
 * Host batch runner for production DetectCard.kt (same sources as the APK).
 *
 * Exports RGBA sidecars + manifest, one JVM invocation → results.json.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeImageFile } from './detect-host.mjs';
import { CORPUS_ROOT, rootDir } from './paths.mjs';

export const NATIVE_BATCH_DIR = join(CORPUS_ROOT, 'native-batch');
export const NATIVE_RUNNER_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../native-runner',
);

export const NATIVE_INPUT_CONTRACT = {
  productionLive: {
    path: 'VisionCamera Frame → Y plane (plane-0) → detectFromYPlane(y, w, h, rowStride)',
    pixelFormat: 'YUV_420_888 plane-0 luma bytes (unsigned)',
    dimensions: 'visible frame width×height after orientation / analysis crop (see useFrameAnalysis)',
    orientation: 'VisionCamera frame.orientation + outputOrientation → analysisGeometry spaces',
    stride: 'rowStride ≥ width (padding allowed)',
    downsample: 'WORK_WIDTH=320 gray (DetectCard)',
    chroma: false,
    coordinateOutput: 'fullW×fullH source of the Y buffer (analysis / mapped spaces on device)',
  },
  hostBenchmarkRgba: {
    path: 'PNG/JPEG → packed RGBA ScanImage → DetectCard.detectFromRgba',
    pixelFormat: 'R,G,B,A uint8, length = w*h*4 (same as JS ScanImage)',
    dimensions: 'decoded image width×height (fixture source pixels)',
    orientation: 'as stored in file — no VisionCamera rotation applied on host',
    stride: 'tight (w); no row padding',
    downsample: 'WORK_WIDTH=320 gray + RGB planes for chroma',
    chroma: true,
    coordinateOutput: 'fixture image pixel space (same as groundTruthQuad)',
  },
  hostBenchmarkYFromRgba: {
    path: 'PNG/JPEG → RGBA → BT.601 luma bytes → DetectCard.detectFromYPlane(y,w,h,stride=w)',
    pixelFormat: 'derived Y from RGBA (not camera YUV)',
    chroma: false,
    note: 'Closer to live algorithm (no chroma) but luma ≠ camera Y plane; orientation still file-space.',
  },
  limitation:
    'Host native benchmark uses detectFromRgba by default (parity with shared-js + chroma). Production live scanning uses detectFromYPlane (no chroma). Pass --native-input=y-from-rgba to approximate the live algorithm without chroma. Neither path reproduces VisionCamera orientation / crop / true YUV on the host.',
};

const resolveJavaHome = () => {
  if (process.env.JAVA_HOME && existsSync(join(process.env.JAVA_HOME, 'bin/java'))) {
    return process.env.JAVA_HOME;
  }
  for (const p of [
    '/opt/homebrew/opt/openjdk@21',
    '/opt/homebrew/opt/openjdk@17',
    '/opt/homebrew/opt/openjdk',
  ]) {
    if (existsSync(join(p, 'bin/java'))) return p;
  }
  return null;
};

export const exportNativeBatch = async (fixtures, { batchDir = NATIVE_BATCH_DIR } = {}) => {
  await mkdir(batchDir, { recursive: true });
  const cases = [];
  for (const fixture of fixtures) {
    const abs = join(rootDir, fixture.image);
    if (!existsSync(abs)) {
      console.warn(`native export skip missing: ${fixture.image}`);
      continue;
    }
    const image = await decodeImageFile(abs);
    const safeId = fixture.id.replace(/[^\w.-]+/g, '_');
    const rgbaName = `${safeId}.rgba`;
    await writeFile(
      join(batchDir, rgbaName),
      Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength),
    );
    cases.push({
      id: fixture.id,
      rgbaFile: rgbaName,
      width: image.width,
      height: image.height,
      orientation: fixture.provenance?.orientation ?? null,
      image: fixture.image,
      source: fixture.source,
    });
  }
  const manifest = {
    generatedAt: new Date().toISOString(),
    note: NATIVE_INPUT_CONTRACT.limitation,
    cases,
  };
  await writeFile(join(batchDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { batchDir, cases };
};

const runGradleBatch = ({
  batchDir,
  inputMode,
  exportPipeline = false,
  diagnosticTopComponents = null,
  diagnosticDedupeCap = null,
}) =>
  new Promise((resolve, reject) => {
    const javaHome = resolveJavaHome();
    if (!javaHome) {
      reject(
        new Error(
          'No JDK found (need OpenJDK 21+). Set JAVA_HOME or install openjdk@21 via Homebrew.',
        ),
      );
      return;
    }
    const gradlew = join(NATIVE_RUNNER_DIR, 'gradlew');
    if (!existsSync(gradlew)) {
      reject(new Error(`Missing ${gradlew} — native-runner gradle wrapper not present`));
      return;
    }
    const env = {
      ...process.env,
      JAVA_HOME: javaHome,
      PATH: `${join(javaHome, 'bin')}:${process.env.PATH ?? ''}`,
      GEOMETRY_NATIVE_BATCH_DIR: batchDir,
      GEOMETRY_NATIVE_INPUT: inputMode,
      GEOMETRY_NATIVE_PIPELINE: exportPipeline ? '1' : '0',
    };
    if (diagnosticTopComponents != null) {
      env.GEOMETRY_NATIVE_DIAG_TOP_COMPONENTS = String(diagnosticTopComponents);
    }
    if (diagnosticDedupeCap != null) {
      env.GEOMETRY_NATIVE_DIAG_DEDUPE_CAP = String(diagnosticDedupeCap);
    }
    const child = spawn(gradlew, ['-q', 'geometryBatch'], {
      cwd: NATIVE_RUNNER_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => {
      stdout += d;
      process.stdout.write(d);
    });
    child.stderr.on('data', d => {
      stderr += d;
      process.stderr.write(d);
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`geometryBatch exited ${code}\n${stderr || stdout}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });

/**
 * @returns {Promise<Map<string, object>>} fixtureId → detection row
 */
export const runNativeDetectorBatch = async (
  fixtures,
  {
    inputMode = 'rgba',
    batchDir = NATIVE_BATCH_DIR,
    exportPipeline = false,
    diagnosticTopComponents = null,
    diagnosticDedupeCap = null,
    /** When true, reuse existing RGBA sidecars + manifest in batchDir (sweep many diag caps). */
    skipExport = false,
  } = {},
) => {
  let cases;
  if (skipExport) {
    const manifestPath = join(batchDir, 'manifest.json');
    if (!existsSync(manifestPath)) {
      throw new Error(`skipExport set but missing manifest at ${manifestPath}`);
    }
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    cases = manifest.cases ?? [];
  } else {
    ({ cases } = await exportNativeBatch(fixtures, { batchDir }));
  }
  if (!cases.length) return new Map();
  await runGradleBatch({
    batchDir,
    inputMode,
    exportPipeline,
    diagnosticTopComponents,
    diagnosticDedupeCap,
  });
  const resultsPath = join(batchDir, 'results.json');
  if (!existsSync(resultsPath)) {
    throw new Error(`native batch produced no results.json at ${resultsPath}`);
  }
  const payload = JSON.parse(await readFile(resultsPath, 'utf8'));
  const map = new Map();
  for (const row of payload.results ?? []) {
    map.set(row.id, {
      detected: Boolean(row.detected),
      corners: row.corners ?? null,
      score: row.score ?? 0,
      runtimeMs: row.runtimeMs ?? null,
      method: row.method ?? null,
      failureReason: row.failureReason ?? null,
      inputMode: row.inputMode ?? inputMode,
      engine: 'android-native',
      runtimeNote: 'HOST_JVM_NOT_DEVICE_LATENCY',
      candidates: row.candidates ?? [],
      nestedPairs: row.nestedPairs ?? [],
      selectedIndex: row.selectedIndex ?? null,
      pipeline: row.pipeline ?? null,
      diagnostics: {
        candidateCount: row.candidateCount,
        shortlistCount: row.shortlistCount ?? row.candidates?.length ?? null,
        rejectReason: row.rejectReason,
        workWidth: row.workWidth,
        workHeight: row.workHeight,
        nestedInnerPreferred: row.nestedInnerPreferred,
        topComponentsUsed: row.pipeline?.topComponentsUsed ?? null,
        dedupeCapUsed: row.pipeline?.dedupeCapUsed ?? null,
      },
    });
  }
  return map;
};
