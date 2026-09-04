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
const fsStub = join(bundleDir, 'fs-stub.mjs');
const sharingStub = join(bundleDir, 'sharing-stub.mjs');
const legacyStub = join(bundleDir, 'fs-legacy-stub.mjs');
const outfile = join(bundleDir, 'saveDebug.mjs');

await writeFile(
  rnStub,
  'export const Platform = { OS: "android" };\nexport const Share = { share: async () => ({ action: "sharedAction" }) };\n',
);
await writeFile(
  fsStub,
  `
export const EncodingType = { Base64: "base64", UTF8: "utf8" };
export class Paths { static cache = "file:///cache/"; }
export class Directory {
  constructor(...parts) { this.uri = parts.map(p => typeof p === "string" ? p : p.uri).join("/").replace(/\\/+/g, "/"); this.exists = false; }
  create() { this.exists = true; }
}
export class File {
  constructor(dir, name) { this.uri = (dir.uri || dir) + "/" + name; this.exists = false; }
  create() { this.exists = true; }
  delete() { this.exists = false; }
  write() {}
}
`,
);
await writeFile(
  sharingStub,
  'export const isAvailableAsync = async () => true;\nexport const shareAsync = async () => {};\n',
);
await writeFile(
  legacyStub,
  'export const StorageAccessFramework = { requestDirectoryPermissionsAsync: async () => ({ granted: false }) };\n',
);

try {
  await esbuild.build({
    alias: {
      'expo-file-system': fsStub,
      'expo-file-system/legacy': legacyStub,
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
    exportDebugBundle,
    formatColorChecklist,
    formatDebugReportText,
  } = mod;
  const report = buildDebugReport({
    analysisLongEdge: 480,
    deviceLine: 'Back Triple Camera',
    panel: {
      frameMeta: { pixelFormat: 'rgb-bgra-8-bit' },
      phase: 'locking',
      artCandidates: [{ name: 'Sol Ring', score: 0.7 }],
      session: { recognitionSource: 'analysis-fallback' },
    },
    preferredSource: 'snapshot',
    recognitionSource: 'analysis-fallback',
    stamp: 'test',
  });
  check('report has generatedAt', typeof report.generatedAt === 'string');
  check('report keeps panel payload', report.panel.phase === 'locking');
  check('Detector input color correct? present', report['Detector input color correct?'] === 'unverified');
  check(
    'Recognition input color correct? present',
    report['Recognition input color correct?'] === 'unverified',
  );
  check('Recognition source is fallback', report['Recognition source'] === 'fallback');
  check('pixel format present', report['pixel format'] === 'rgb-bgra-8-bit');
  check('channel order is rgba on android', report['channel order'] === 'rgba');
  const text = formatDebugReportText(report);
  check('text starts with banner', text.startsWith('Lugin scan debug\n'));
  check(
    'text leads with checklist',
    text.includes('Detector input color correct? unverified') &&
      text.includes('Recognition source: fallback') &&
      text.includes('pixel format: rgb-bgra-8-bit') &&
      text.includes('channel order: rgba'),
  );
  check('text is JSON-ish', text.includes('"phase": "locking"'));
  const checklist = buildColorChecklist({
    panel: {
      frameMeta: { pixelFormat: 'rgb-rgba-8-bit' },
      session: { recognitionSource: 'photo' },
    },
  });
  check('checklist formats', formatColorChecklist(checklist).includes('Recognition source: photo'));
  check('rgba channel order', checklist.channelOrder === 'rgba');

  const exported = await exportDebugBundle({
    panel: { phase: 'locking' },
    stamp: 'smoke',
  });
  check('export ok', exported.ok === true, exported.ok ? '' : exported.reason);
  if (exported.ok) {
    check('export method is sharing', exported.method === 'sharing', exported.method);
  }

  if (failures > 0) {
    console.error(`save-debug smoke: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('save-debug smoke ok');
} finally {
  await rm(bundleDir, { force: true, recursive: true });
}
