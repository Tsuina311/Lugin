#!/usr/bin/env node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = join(mobileRoot, 'src/scan/saveDebugBundle.ts');
const esbuild = await createRequire(join(mobileRoot, '..', 'package.json')).call(null, 'esbuild');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) return;
  failures++;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
};

const bundleDir = await mkdtemp(join(tmpdir(), 'lugin-dbg-'));
const rnStub = join(bundleDir, 'rn-stub.mjs');
const fsLegacyStub = join(bundleDir, 'fs-legacy-stub.mjs');
const sharingStub = join(bundleDir, 'sharing-stub.mjs');
const outfile = join(bundleDir, 'saveDebug.mjs');

await writeFile(
  rnStub,
  'export const Platform = { OS: "android" };\nexport const Share = { share: async () => ({ action: "sharedAction" }) };\n',
);
await writeFile(
  fsLegacyStub,
  `
const files = new Map();
export const cacheDirectory = "file:///cache/";
export const documentDirectory = "file:///documents/";
export const makeDirectoryAsync = async () => {};
export const writeAsStringAsync = async (uri, contents) => { files.set(uri, contents); };
export const readAsStringAsync = async (uri) => {
  const c = files.get(uri);
  if (c == null) throw new Error('missing ' + uri);
  return String(c);
};
export const copyAsync = async ({ from, to }) => {
  files.set(to, files.get(from));
};
export const getInfoAsync = async (uri) => {
  const c = files.get(uri);
  return c == null ? { exists: false } : { exists: true, size: String(c).length };
};
export const StorageAccessFramework = {
  requestDirectoryPermissionsAsync: async () => ({ granted: true, directoryUri: "content://tree/downloads" }),
  createFileAsync: async (dir, name, mime) => {
    const uri = dir + "/" + name;
    files.set(uri, "");
    return uri;
  },
};
`,
);
await writeFile(
  sharingStub,
  'export const isAvailableAsync = async () => true;\nexport const shareAsync = async () => {};\n',
);

try {
  await esbuild.build({
    alias: {
      'expo-file-system/legacy': fsLegacyStub,
      'expo-sharing': sharingStub,
      'react-native': rnStub,
    },
    bundle: true,
    entryPoints: [entry],
    format: 'esm',
    outfile,
    platform: 'neutral',
    tsconfigRaw: {
      compilerOptions: { baseUrl: mobileRoot, paths: { '@/*': ['../src/*'] } },
    },
  });

  const mod = await import(pathToFileURL(outfile).href);
  const {
    buildColorChecklist,
    buildDebugReport,
    downloadPreparedBundle,
    formatColorChecklist,
    formatDebugReportText,
    prepareDebugBundle,
    sharePreparedBundle,
  } = mod;
  const report = buildDebugReport({
    analysisLongEdge: 480,
    deviceLine: 'Back Triple Camera',
    panel: {
      frameMeta: { pixelFormat: 'rgb-bgra-8-bit' },
      phase: 'locking',
      session: { recognitionSource: 'analysis-fallback', phase: 'locking' },
    },
    preferredSource: 'snapshot',
    recognitionSource: 'analysis-fallback',
    stamp: 'test',
  });
  check('report has generatedAt', typeof report.generatedAt === 'string');
  check('report omits huge panel', report.panel === undefined);
  check('Detector input color correct? present', report['Detector input color correct?'] === 'unverified');
  check('Recognition source is fallback', report['Recognition source'] === 'fallback');
  check('pixel format present', report['pixel format'] === 'rgb-bgra-8-bit');
  check('channel order is rgba on android', report['channel order'] === 'rgba');
  const text = formatDebugReportText(report);
  check('text starts with banner', text.startsWith('Lugin scan debug\n'));
  check('text leads with checklist', text.includes('Recognition source: fallback'));

  const checklist = buildColorChecklist({
    panel: {
      frameMeta: { pixelFormat: 'rgb-rgba-8-bit' },
      session: { recognitionSource: 'photo' },
    },
  });
  check('checklist formats', formatColorChecklist(checklist).includes('Recognition source: photo'));

  const prepared = await prepareDebugBundle({
    panel: { phase: 'locking' },
    stamp: 'smoke',
  });
  check('prepare ok', prepared.ok === true, prepared.ok ? '' : prepared.reason);
  check('prepare writes report txt', prepared.ok && prepared.bundle.reportUri != null);
  check('prepare writes json', prepared.ok && prepared.bundle.jsonUri != null);

  if (prepared.ok) {
    const shared = await sharePreparedBundle(prepared.bundle);
    check('share ok', shared.ok === true, shared.ok ? '' : shared.reason);
    check('share method is sharing', shared.ok && shared.method === 'sharing', shared.ok ? shared.method : '');

    const downloaded = await downloadPreparedBundle(prepared.bundle);
    check('download ok', downloaded.ok === true, downloaded.ok ? '' : downloaded.reason);
    check(
      'download method is saf',
      downloaded.ok && downloaded.method === 'saf',
      downloaded.ok ? downloaded.method : '',
    );
    check(
      'download includes txt',
      downloaded.ok && downloaded.saved.some((n) => n.endsWith('.txt')),
      downloaded.ok ? downloaded.saved.join(',') : '',
    );
  }

  // Detector + recognition ScanImages should both land in the bundle files.
  const rgba = (w, h, r, g, b) => {
    const data = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
    return { data, height: h, width: w };
  };
  const withImages = await prepareDebugBundle({
    images: {
      detector: rgba(32, 48, 220, 40, 40),
      recognition: rgba(64, 89, 220, 40, 40),
    },
    panel: { frameMeta: { pixelFormat: 'rgb-rgba-8-bit' } },
    stamp: 'smoke-images',
  });
  check('image prepare ok', withImages.ok === true);
  if (withImages.ok) {
    check('recognition png written', withImages.bundle.pngUri != null);
    check('detector png written', withImages.bundle.detectorPngUri != null);
    check('detector preview uri', withImages.bundle.detectorImageUri != null);
    check('report lists detector input', withImages.bundle.reportText.includes('detectorInput'));
  }

  if (failures > 0) {
    console.error(`save-debug smoke: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('save-debug smoke ok');
} finally {
  await rm(bundleDir, { force: true, recursive: true });
}
