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
 *
 * Requires: eas-cli on PATH, EXPO_TOKEN (CI) or `eas login` (local).
 * Always runs with cwd = mobile/ so fingerprint matches EAS Build.
 */

import { execFileSync, execSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mobile = join(root, 'mobile');
const PROFILE = process.env.LUGIN_EAS_PROFILE || 'development';
const ENVIRONMENT = process.env.LUGIN_EAS_ENVIRONMENT || 'development';
const PLATFORM = process.env.LUGIN_EAS_PLATFORM || 'android';
const CHANNEL = process.env.LUGIN_EAS_CHANNEL || 'development';

function eas(args, { json = false } = {}) {
  const full = ['eas', ...args, ...(json ? ['--json', '--non-interactive'] : ['--non-interactive'])];
  const out = execFileSync(full[0], full.slice(1), {
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

function fingerprintHash() {
  const raw = eas(
    [
      'fingerprint:generate',
      '--platform',
      PLATFORM,
      '--build-profile',
      PROFILE,
      '--environment',
      ENVIRONMENT,
    ],
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

console.error(`Unknown command: ${cmd}`);
process.exit(1);
