# Native Android deployment (EAS Build + EAS Update)

Lugin’s web companion still deploys to **GitHub Pages**. The native Samsung
development app deploys through **EAS** on the same `main` push, using Expo’s
**native fingerprint** as the source of truth for OTA vs new APK.

```text
git push main
        ↓
gate (tests)
        ↓
┌──────────────────────┬────────────────────────────┐
│ WEB                  │ NATIVE (Android)           │
│ yarn build:web       │ fingerprint                │
│ GitHub Pages         │ match finished build?      │
│                      │  yes → eas update (OTA)    │
│                      │  no  → eas build (APK)     │
└──────────────────────┴────────────────────────────┘
```

Web never waits on EAS. If `EXPO_TOKEN` is missing, Pages still deploys and the
native job warns and skips.

## Monorepo layout (two package.json files)

Having two `package.json` files is intentional. Do **not** merge them.

| Path | Role | May contain |
| --- | --- | --- |
| `/package.json` | Yarn Berry **workspace root** (extension + web) | `workspaces`, `packageManager`, web/extension deps, root scripts |
| `/mobile/package.json` | Expo **app** package | Expo/RN deps, `eas-build-pre-install`, mobile scripts |

Expo / EAS config does **not** live in either `package.json`:

| File | Purpose |
| --- | --- |
| `mobile/app.config.ts` | Expo app config (name, plugins, updates, projectId) |
| `mobile/eas.json` | EAS Build / Update profiles |
| `mobile/eas-project.json` | EAS project id fallback |

Root must **not** gain `expo`, `react-native`, or `app.json`/`app.config.*`. Mobile must **not** become the Yarn workspace root (no root `workspaces` move).

EAS runs `yarn install` at the **repo root** because it detects the workspace.
Both package.json files share the same `packageManager` pin. EAS’s image still
ships Yarn **1.22** and may invoke it by absolute path, so Corepack alone is not
enough. We commit Yarn Berry at `.yarn/releases/` (`yarnPath` in `.yarnrc.yml`)
and run `scripts/eas-build-pre-install.mjs` to replace that Yarn 1 entrypoint
with a wrapper that execs the committed Berry binary. The builder log line
“Yarn 1.22.22” under spin-up is only the image default — after the pre-install
hook, install should show Yarn Berry `YN0000` lines.

Fingerprint OTA uses `runtimeVersion.policy: fingerprint`. Volatile git stamps
in `app.config.ts` (`version`, `extra.lugin`) and prebuild’s `android/` folder
must not shift the hash between your machine and EAS. That is handled by
`mobile/fingerprint.config.js` (source skips + ignore native dirs) and by baking
`mobile/build-stamp.json` before `eas build` / `eas update` / fingerprint
(`scripts/write-mobile-build-stamp.mjs`) so the APK still shows the real
commit-count version even though `.git/` is not uploaded.

## First setup

### 1. Expo account + project

```bash
yarn install                 # installs eas-cli in the mobile workspace
yarn mobile:eas login
yarn mobile:eas init         # creates project; copy the projectId
```

No global `eas-cli` install. All commands go through Yarn (`yarn mobile:eas …`
or the higher-level `yarn mobile:build:eas` / `yarn mobile:update` scripts).

Put the project id in **one** of:

- GitHub repo **variable** `EAS_PROJECT_ID` (preferred for CI), or
- `mobile/eas-project.json` → `{ "projectId": "<uuid>" }` (committed, not secret)

### 2. GitHub secret

Expo → [Access tokens](https://expo.dev/settings/access-tokens) → create token.

GitHub → Settings → Secrets → Actions → **`EXPO_TOKEN`**.

Never commit the token. Never put it in `VITE_*`.

### 3. EAS credentials (Android)

First `eas build` will prompt for Android credentials. Prefer **EAS-managed**
keystore. Do not commit keystores or passwords.

### 4. Install the first development APK

```bash
yarn mobile:build:eas        # or wait for CI after EXPO_TOKEN is set
```

Install the APK URL from the EAS build page / CI summary on the Samsung
(sideload). Package: `app.lugin.mobile`.

> The CI **`development`** profile is a **release-style APK** with channel
> `development` so cold-start OTA works. For Metro debugging, use
> `development-client` manually (`yarn mobile:eas build --profile development-client`).
>
> EAS Build uses the committed Yarn Berry binary (`.yarn/releases` + `yarnPath`)
> and `scripts/eas-build-pre-install.mjs` to replace the image’s Yarn 1 before
> install. Do **not** set `"corepack": true` or `"yarn": "3.x"` in `eas.json`
> for this monorepo.

## Normal development (JS-only)

```text
edit TypeScript / UI
↓
git push main
↓
fingerprint unchanged
↓
EAS Update → channel development
↓
open / cold-start Lugin
↓
update downloads; applies on next cold start (or Settings → Apply)
```

No APK reinstall.

## Native change

```text
new native module / Expo SDK / permission / VisionCamera bump
↓
git push main
↓
fingerprint changed
↓
NO incompatible OTA
↓
EAS Build APK
↓
CI summary shows Install URL
↓
install APK once
↓
later JS pushes return to OTA
```

## Manual commands

Run from repo root (scripts use `mobile/` as EAS project root):

```bash
yarn mobile:fingerprint          # print Android development fingerprint
yarn mobile:deploy:status        # local fp vs matching finished build
yarn mobile:update               # publish OTA to development
yarn mobile:build:eas            # force development APK build
```

Inside `mobile/` via Yarn (same CLI; no global install):

```bash
yarn eas fingerprint:generate --platform android --environment development --json --non-interactive
yarn eas build:list --platform android --build-profile development --fingerprint-hash "$HASH" --status finished --limit 1 --json --non-interactive
yarn eas update --channel development --platform android --environment development --message "…" --non-interactive
yarn eas build --platform android --profile development --non-interactive
```

Or from the repo root: `yarn mobile:eas <args…>`.

Note: `eas fingerprint:generate` accepts **either** `--environment` **or** `--build-profile`, not both. CI uses `--environment development`.

## Rollback

OTA (JS) problems — republish a known-good update or roll back via EAS:

```bash
cd mobile
yarn eas update:list --channel development --non-interactive
# Republish previous bundle / use Expo dashboard rollback for the branch
yarn eas update --channel development --platform android --environment development --message "rollback" --non-interactive
```

Or use the [EAS dashboard](https://expo.dev) → Updates → roll back / republish.

There is **no** in-app APK auto-installer. Native rollbacks = install an older APK.

```bash
yarn mobile:update:status    # alias of deploy:status
```

## Profiles / channels / runtime

| Profile | Channel | Artifact | Role |
| --- | --- | --- | --- |
| `development` | `development` | APK | Daily driver + CI OTA target |
| `development-client` | `development` | APK + dev client | Metro / camera debugging |
| `preview` | `preview` | APK | Manual |
| `production` | `production` | AAB default | Manual / later store |

`runtimeVersion.policy`: **`fingerprint`** — OTA never loads into an incompatible native binary.

Fingerprint, build, and update all use environment **`development`**.

## Phone update lifecycle

1. Cold start: `expo-updates` + app `UpdateProvider` check/fetch.
2. `fallbackToCacheTimeout: 0` — do not block first paint waiting for network.
3. If update downloaded and no active scan block → reload once at startup.
4. On resume: fetch in background; if ready, Settings shows **Apply** — never
   force-reload mid-scan (`setBlockReload(true)` from scanner later).

## Secrets / config classification

| Name | Where | Class |
| --- | --- | --- |
| `EXPO_TOKEN` | GitHub Actions secret | **SECRET** |
| `EAS_PROJECT_ID` | GitHub variable or `eas-project.json` | PUBLIC CONFIG |
| Google OAuth client id (future native) | EAS env / app config | PUBLIC CONFIG |
| Google client secret | **never in mobile** | — |
| Android keystore | EAS credentials | SECRET (not in git) |

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Phone not updating | Channel `development`? Matching fingerprint APK installed? Settings → Check |
| Wrong fingerprint every commit | CNG `android/`/`ios/` dirty locally? Compare with `eas fingerprint:compare` |
| CI skipped native | `EXPO_TOKEN` missing |
| OTA failed, web ok | Expected — jobs are independent; phone keeps last good update |
| Native build failed | No OTA published for that fingerprint; keep old APK |
| Updates disabled in Settings | Running Metro / Expo Go / `development-client` debug binary |
| Google auth mismatch | Android OAuth client SHA-1 must match the **installed** signing cert |
| EAS: Yarn 1.22 vs `packageManager` yarn@3 | Ensure `.yarn/releases/yarn-3.8.1.cjs` is committed and `eas-build-pre-install` runs; check Install logs for “Replaced yarn at …” |
| EAS: Failed to install yarn | Do not set `"corepack": true` or `"yarn": "3.x"` in eas.json |

## Acceptance scenario (document when you run it)

| Commit | Change | Expect |
| --- | --- | --- |
| A | First APK | Install once |
| B | UI string only | OTA, no EAS Build |
| C | Scanner TS only | OTA, no EAS Build |
| D | Native dep / manifest | New APK, **no** OTA |
| E | JS after D | OTA again |

JS-only pushes must **not** consume a native EAS build.

## Related

- Architecture / camera PoC: [`MOBILE-NATIVE.md`](MOBILE-NATIVE.md)
- Distribution / Play: [`DISTRIBUTION.md`](DISTRIBUTION.md)
