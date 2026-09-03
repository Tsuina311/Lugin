#!/usr/bin/env node
/**
 * EAS fingerprint / build / update helpers for the Lugin mobile workspace.
 *
 * Commands:
 *   node scripts/mobile-eas.mjs fingerprint
 *   node scripts/mobile-eas.mjs decide
 *   node scripts/mobile-eas.mjs status
 *   node scripts/mobile-eas.mjs summary-ota
 *   node scripts/mobile-eas.mjs summary-build
 *   node scripts/mobile-eas.mjs which
 *
 * Invokes the workspace `eas-cli` package (no global install). Auth via
 * EXPO_TOKEN (CI) or `yarn mobile:eas login` (local). Always runs with
 * cwd = mobile/ so fingerprint matches EAS Build.
 */

import { execFileSync, execSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mobile = join(root, 'mobile');
const PROFILE = process.env.LUGIN_EAS_PROFILE || 'development';
const ENVIRONMENT = process.env.LUGIN_EAS_ENVIRONMENT || 'development';
const PLATFORM = process.env.LUGIN_EAS_PLATFORM || 'android';
const CHANNEL = process.env.LUGIN_EAS_CHANNEL || 'development';

/** Resolve the eas-cli binary from the mobile workspace, never PATH/global. */
function resolveEasBin() {
  const requireFromMobile = createRequire(join(mobile, 'package.json'));
  let pkgJsonPath;
  try {
    pkgJsonPath = requireFromMobile.resolve('eas-cli/package.json');
  } catch {
    throw new Error(
      'eas-cli is not installed in the mobile workspace. Run `yarn install` from the repo root.',
    );
  }
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  const binField = pkg.bin?.eas ?? pkg.bin;
  if (typeof binField !== 'string') {
    throw new Error(`eas-cli package.json has unexpected bin field at ${pkgJsonPath}`);
  }
  const binPath = join(dirname(pkgJsonPath), binField);
  if (!existsSync(binPath)) {
    throw new Error(`eas-cli bin missing: ${binPath}`);
  }
  return binPath;
}

function eas(args, { json = false } = {}) {
  const bin = resolveEasBin();
  const argv = [...args, ...(json ? ['--json', '--non-interactive'] : ['--non-interactive'])];
  // eas-cli's bin is a JS entry — run via node for Windows + yarn PnP/node-modules.
  const out = execFileSync(process.execPath, [bin, ...argv], {
    cwd: mobile,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 20 * 1024 * 1024,
  });
  return out;
}

function parseJson(stdout) {
  const text = stdout.trim();
  // EAS sometimes prints warnings before JSON; take the last JSON value.
  const start = text.indexOf('{') >= 0 && (text.indexOf('[') < 0 || text.indexOf('{') < text.indexOf('['))
    ? text.indexOf('{')
    : text.indexOf('[');
  if (start < 0) throw new Error(`Expected JSON from eas, got:\n${text.slice(0, 500)}`);
  return JSON.parse(text.slice(start));
}

function writeBuildStamp() {
  execFileSync(process.execPath, [join(root, 'scripts', 'write-mobile-build-stamp.mjs')], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function fingerprintHash() {
  // Bake stamp before fingerprint so app.config matches what EAS will evaluate
  // after upload (no .git on the builder).
  writeBuildStamp();
  // eas-cli forbids combining --build-profile and --environment.
  // Use environment so fingerprint matches build/update (all "development").
  const raw = eas(
    ['fingerprint:generate', '--platform', PLATFORM, '--environment', ENVIRONMENT],
    { json: true },
  );
  const parsed = parseJson(raw);
  const hash =
    parsed.hash ??
    parsed.fingerprintHash ??
    parsed.fingerprint?.hash ??
    (typeof parsed === 'string' ? parsed : null);
  if (!hash || typeof hash !== 'string') {
    throw new Error(`Could not parse fingerprint hash from: ${JSON.stringify(parsed).slice(0, 400)}`);
  }
  return hash;
}

function findCompatibleBuild(hash) {
  const raw = eas(
    [
      'build:list',
      '--platform',
      PLATFORM,
      '--build-profile',
      PROFILE,
      '--fingerprint-hash',
      hash,
      '--status',
      'finished',
      '--limit',
      '1',
    ],
    { json: true },
  );
  const parsed = parseJson(raw);
  const list = Array.isArray(parsed) ? parsed : parsed.builds ?? parsed.data ?? [];
  return list[0] ?? null;
}

function buildInstallUrl(build) {
  if (!build) return null;
  return (
    build.artifacts?.buildUrl ??
    build.artifacts?.applicationArchiveUrl ??
    build.appBuildUrl ??
    build.buildDetailsPageUrl ??
    (build.id ? `https://expo.dev/accounts/_/projects/_/builds/${build.id}` : null)
  );
}

function writeGithubOutput(pairs) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  for (const [k, v] of Object.entries(pairs)) {
    appendFileSync(file, `${k}=${String(v ?? '').replace(/\n/g, '%0A')}\n`);
  }
}

function writeSummary(md) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, md);
  else process.stdout.write(md);
}

function sourceStamp() {
  try {
    const raw = execSync(
      `node --experimental-strip-types -e "import { buildVersion } from './build/version.ts'; process.stdout.write(JSON.stringify(buildVersion('./')))"`,
      { cwd: root, encoding: 'utf8' },
    );
    return JSON.parse(raw);
  } catch {
    return { id: process.env.GITHUB_SHA?.slice(0, 7) ?? 'unknown', label: 'unknown', version: '0.0.0' };
  }
}

const cmd = process.argv[2] ?? 'status';

if (cmd === 'fingerprint') {
  const hash = fingerprintHash();
  console.log(hash);
  writeGithubOutput({ fingerprint: hash });
  process.exit(0);
}

if (cmd === 'update') {
  // `eas update --non-interactive` refuses to run without a message, so it
  // cannot live in a package.json script alone. Derive one from the same source
  // stamp the app displays, so an update on the phone can be traced back here.
  const stamp = sourceStamp();
  const extra = process.argv.slice(3);
  const message = extra.length > 0 ? extra.join(' ') : `v${stamp.version} · ${stamp.id}`;
  // `eas()` appends --non-interactive itself.
  const out = eas([
    'update',
    '--channel',
    CHANNEL,
    '--platform',
    PLATFORM,
    '--environment',
    ENVIRONMENT,
    '--message',
    message,
  ]);
  process.stdout.write(out);
  console.log(`\nPublished to channel '${CHANNEL}': ${message}`);
  process.exit(0);
}

if (cmd === 'decide') {
  const hash = fingerprintHash();
  const build = findCompatibleBuild(hash);
  const mode = build ? 'ota' : 'build';
  const installUrl = buildInstallUrl(build);
  const stamp = sourceStamp();
  const result = {
    mode,
    fingerprint: hash,
    buildId: build?.id ?? null,
    installUrl,
    commit: stamp.id,
    version: stamp.version,
    channel: CHANNEL,
    profile: PROFILE,
  };
  writeFileSync(join(mobile, '.eas-decide.json'), JSON.stringify(result, null, 2));
  writeGithubOutput({
    mode,
    fingerprint: hash,
    build_id: build?.id ?? '',
    install_url: installUrl ?? '',
    commit: stamp.id,
    version: stamp.version,
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

if (cmd === 'status') {
  const stamp = sourceStamp();
  let hash = '(eas unavailable)';
  let build = null;
  try {
    hash = fingerprintHash();
    build = findCompatibleBuild(hash);
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
  }
  console.log(
    JSON.stringify(
      {
        source: stamp,
        localFingerprint: hash,
        channel: CHANNEL,
        profile: PROFILE,
        environment: ENVIRONMENT,
        matchingDevelopmentBuild: build
          ? {
              id: build.id,
              createdAt: build.createdAt ?? build.completedAt,
              installUrl: buildInstallUrl(build),
            }
          : null,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (cmd === 'summary-ota') {
  const fingerprint = process.env.LUGIN_FINGERPRINT ?? '';
  const commit = process.env.LUGIN_COMMIT ?? sourceStamp().id;
  writeSummary(`## Lugin Android — OTA update published

- **Commit:** \`${commit}\`
- **Fingerprint:** \`${fingerprint}\`
- **Channel:** \`${CHANNEL}\`
- **No APK reinstall required**

Open or cold-start Lugin on the Samsung to download; the update applies on the next cold start (or tap Apply in Settings).
`);
  process.exit(0);
}

if (cmd === 'summary-build') {
  const fingerprint = process.env.LUGIN_FINGERPRINT ?? '';
  const commit = process.env.LUGIN_COMMIT ?? sourceStamp().id;
  const installUrl = process.env.LUGIN_INSTALL_URL ?? '';
  const buildId = process.env.LUGIN_BUILD_ID ?? '';
  writeSummary(`## Lugin Android — NEW NATIVE BUILD REQUIRED

- **Commit:** \`${commit}\`
- **Fingerprint:** \`${fingerprint}\`
- **Build ID:** \`${buildId || '(pending)'}\`
- **Channel:** \`${CHANNEL}\`

### Install

${installUrl ? `[Download / install APK](${installUrl})` : '_Install URL will appear on the EAS build page once the build finishes._'}

Do **not** expect an OTA for this commit — the native runtime changed. Install the new APK once; later JS-only pushes return to OTA.
`);
  process.exit(0);
}

if (cmd === 'which') {
  const bin = resolveEasBin();
  const version = execFileSync(process.execPath, [bin, '--version'], {
    cwd: mobile,
    encoding: 'utf8',
    env: process.env,
  }).trim();
  console.log(JSON.stringify({ bin, version }, null, 2));
  process.exit(0);
}

console.error(`Unknown command: ${cmd}`);
process.exit(1);
