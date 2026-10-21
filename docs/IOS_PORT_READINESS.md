# iOS port readiness

Inspection of the tree after the native collection / deck / Drive work.
An iOS prebuild now succeeds, but no Swift scanner code was added.
A percentage of reusable code is not stated here, because it was not measured.

## CROSS_PLATFORM_READY

These modules do not import Android or Kotlin APIs.

- Collection, decks, printings, preferences, import/export, prices, and deck coverage: `src/lib/collection.ts`, `src/lib/collectionEdit.ts`, `src/lib/deck.ts`, `src/lib/printing.ts`, `src/lib/import.ts`, `src/lib/export.ts`, `src/lib/prices.ts`, `src/lib/duplicates.ts`.
- Scan-to-collection decision only: `src/lib/collectionIntake.ts`. It does not call the recognizer.
- Drive document and sync engine: `src/core/sync/` (`model`, `engine`, `serialize`, `drive`, `scopes`). Lugin Native uses the same `TokenProvider` seam as Lugin Chrome and Lugin Web.
- SQLite repository: `src/platform/sqlite/`. It talks to a `SqlExecutor`. Node tests use `node:sqlite`. The phone uses `expo-sqlite` when the binary contains it (`mobile/src/data/openLibrary.ts`). `expo-sqlite` ~57.0.2 publishes Android and iOS. This project's currently installed Android APK does not include that native module yet, so the running app falls back to JSON files under the app document directory.
- File fallback and price cache: `expo-file-system` and `expo-sharing`, already in the app.
- Collection and deck screens, the library store, and settings Drive controls: React Native, no Android-only imports.
- Card images on the collection list: React Native `Image` plus the Scryfall CDN helper `cdnImageFromId`.
- Google sign-in: system browser and PKCE (`mobile/src/auth/nativeGoogleAuth.ts`). The redirect is the reversed Android client id, not `lugin://oauth`. Tokens use `expo-secure-store`. See `docs/NATIVE_GOOGLE_OAUTH.md`. An iOS client would be a separate Google credential and a different reversed scheme.

## ANDROID_SPECIFIC

Present in the repo as Android projects only. There is no `ios/` directory and no Swift file under `mobile/modules/`.

| Module                    | What the Android code actually uses                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lugin-card-detector`     | Kotlin geometry (`DetectCard.kt`, `Geometry.kt`). No third-party vision library in `android/build.gradle`.                                       |
| `lugin-ocr`               | ML Kit `com.google.mlkit:text-recognition:16.0.1`.                                                                                               |
| `lugin-visual-recognizer` | ONNX Runtime `com.microsoft.onnxruntime:onnxruntime-android:1.19.2`, plus the CLIP / gallery Kotlin (`LuginVisualModule.kt`, `VNextGallery.kt`). |

`app.config.ts` registers those three modules as Expo plugins. An iOS prebuild would have to omit them or supply an iOS implementation. They were not changed for this work.

Scanner frame code also branches on Android pixel layout:

- `mobile/src/scan/imageToScanImage.ts` remaps a reported `bgra` buffer to `rgba` when `Platform.OS === 'android'`.
- `mobile/src/scan/frameToScanImage.ts` documents CameraX RGB analysis.
- `mobile/src/scan/saveDebugBundle.ts` uses Android Storage Access Framework and the Android share-message size cap.

## IOS_NATIVE_DEFERRED

Native iOS distribution and TestFlight are intentionally deferred. Lugin Web
is the supported iPhone experience; no Apple Developer membership is required.
Do not run EAS iOS builds, configure signing, or submit this project to
TestFlight unless that product decision changes.

The collection, deck builder, Settings, SQLite library, secure token storage,
sharing, card images, and iOS OAuth-compatible code remain in place for a
possible future port. The iOS tab bar deliberately omits Single Scan, Binder,
and Geometry. Android remains the only Lugin Native distribution target.

Google Drive on iOS requires an iOS OAuth client in the same Google Cloud
project, with bundle id `app.lugin.mobile`. Put its public client id in the EAS
`development` environment as `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`.

## IOS_IMPLEMENTATION_NEEDED

Not started. This phase does not port the scanner.

- iOS implementations of the detector, OCR, and ONNX recognizer, if a later phase wants the camera on iPhone. ML Kit's Android artifact and `onnxruntime-android` do not cover that.
- An iOS pass over the camera adapters above before Single Scan or Binder can be trusted. `react-native-vision-camera` and `react-native-nitro-image` are dependencies with their own iOS support; the Lugin adapters around them are written against the Android camera.
- iOS scanner implementations. Collection and deck testing do not wait on them.
- Apple signing and the first TestFlight upload require the Apple Developer
  account/App Store Connect app to be completed outside the repository.

## UNKNOWN

- Whether VisionCamera 5.2.3 and nitro-image 0.14.0 link cleanly against this
  Expo SDK 57 / React Native 0.86.3 app on EAS iOS. Prebuild and the JavaScript
  export pass; the first remote archive is the remaining native link test.
