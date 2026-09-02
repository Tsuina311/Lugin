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

## First setup

### 1. Expo account + project

```bash
npm install -g eas-cli   # or use npx eas-cli@latest
cd mobile
eas login
eas init                 # creates project; copy the projectId
```

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
> `development-client` manually (`eas build --profile development-client`).

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

Inside `mobile/` (same effect):

```bash
eas fingerprint:generate --platform android --build-profile development --environment development --json --non-interactive
eas build:list --platform android --build-profile development --fingerprint-hash "$HASH" --status finished --limit 1 --json --non-interactive
eas update --channel development --platform android --environment development --message "…" --non-interactive
eas build --platform android --profile development --non-interactive
```

## Rollback

OTA (JS) problems — republish a known-good update or roll back via EAS:

```bash
cd mobile
eas update:list --channel development --non-interactive
# Republish previous bundle / use Expo dashboard rollback for the branch
eas update --channel development --platform android --environment development --message "rollback" --non-interactive
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
