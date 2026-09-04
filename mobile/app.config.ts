// Expo app config for the Lugin native companion.
// Dynamic so version stamps match web/extension (build/version.ts) and EAS
// project id can come from the environment without committing secrets.

import type { ConfigContext, ExpoConfig } from 'expo/config';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const mobileDir = __dirname;
const rootDir = join(mobileDir, '..');

type Stamp = { id: string; label: string; version: string };

function readStamp(): Stamp {
  // Prefer a baked stamp (scripts/write-mobile-build-stamp.mjs). EAS uploads
  // omit `.git/`, so live git counting on the builder would always fall to 1.0.0.
  const baked = join(mobileDir, 'build-stamp.json');
  if (existsSync(baked)) {
    try {
      return JSON.parse(readFileSync(baked, 'utf8')) as Stamp;
    } catch {
      /* fall through */
    }
  }
  try {
    const raw = execSync(
      `node --experimental-strip-types -e "import { buildVersion } from './build/version.ts'; process.stdout.write(JSON.stringify(buildVersion('./')))"`,
      { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return JSON.parse(raw) as Stamp;
  } catch {
    const declared = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')) as {
      version: string;
    };
    const [major = '1', minor = '0'] = declared.version.split('.');
    return { id: 'unknown', label: `v${major}.${minor}.0 · unknown`, version: `${major}.${minor}.0` };
  }
}

function resolveProjectId(): string | undefined {
  if (process.env.EAS_PROJECT_ID?.trim()) return process.env.EAS_PROJECT_ID.trim();
  const local = join(mobileDir, 'eas-project.json');
  if (existsSync(local)) {
    try {
      const parsed = JSON.parse(readFileSync(local, 'utf8')) as { projectId?: string };
      const id = parsed.projectId?.trim();
      if (id) return id;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const stamp = readStamp();
  const projectId = resolveProjectId();
  const updatesUrl = projectId ? `https://u.expo.dev/${projectId}` : undefined;

  return {
    ...config,
    name: 'Lugin',
    slug: 'lugin',
    version: stamp.version,
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    scheme: 'lugin',
    runtimeVersion: {
      policy: 'fingerprint',
    },
    updates: updatesUrl
      ? {
          url: updatesUrl,
          // Download on launch; apply on the next cold start so an active scan
          // is never force-reloaded mid-session. Channel comes from the EAS
          // build profile (`eas.json`), not a hardcoded request header, so
          // preview/production binaries stay on their own channels.
          checkAutomatically: 'ON_LOAD',
          fallbackToCacheTimeout: 0,
        }
      : undefined,
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'app.lugin.mobile',
      infoPlist: {
        NSCameraUsageDescription: 'Lugin uses the camera to scan Magic cards offline.',
      },
    },
    android: {
      package: 'app.lugin.mobile',
      permissions: ['android.permission.CAMERA'],
      adaptiveIcon: {
        backgroundColor: '#0B1220',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    plugins: ['expo-dev-client', 'expo-updates', 'expo-sharing'],
    web: {
      favicon: './assets/favicon.png',
    },
    extra: {
      eas: projectId ? { projectId } : undefined,
      lugin: {
        buildId: stamp.id,
        buildLabel: stamp.label,
        channel: 'development',
      },
    },
  };
};
