# iOS port readiness

Inspection of the tree after the native collection / deck / Drive work.
No iOS prebuild was run, and no Swift scanner code was added.
A percentage of reusable code is not stated here, because it was not measured.

## CROSS_PLATFORM_READY

These modules do not import Android or Kotlin APIs.

- Collection, decks, printings, preferences, import/export, prices, and deck coverage: `src/lib/collection.ts`, `src/lib/collectionEdit.ts`, `src/lib/deck.ts`, `src/lib/printing.ts`, `src/lib/import.ts`, `src/lib/export.ts`, `src/lib/prices.ts`, `src/lib/duplicates.ts`.
- Scan-to-collection decision only: `src/lib/collectionIntake.ts`. It does not call the recognizer.
- Drive document and sync engine: `src/core/sync/` (`model`, `engine`, `serialize`, `drive`, `scopes`). The native app uses the same `TokenProvider` seam as the extension and the phone site.
- SQLite repository: `src/platform/sqlite/`. It talks to a `SqlExecutor`. Node tests use `node:sqlite`. The phone uses `expo-sqlite` when the binary contains it (`mobile/src/data/openLibrary.ts`). `expo-sqlite` ~57.0.2 publishes Android and iOS. This project's currently installed Android APK does not include that native module yet, so the running app falls back to JSON files under the app document directory.
- File fallback and price cache: `expo-file-system` and `expo-sharing`, already in the app.
- Collection and deck screens, the library store, and settings Drive controls: React Native, no Android-only imports.
- Card images on the collection list: React Native `Image` plus the Scryfall CDN helper `cdnImageFromId`.
- Google sign-in: system browser, PKCE, and `Linking` to `lugin://oauth` (`mobile/src/auth/nativeGoogleAuth.ts`). No Android SDK. The same redirect has to be accepted by the Google client on iOS as on Android. Tokens are a JSON file in the app document directory, not the platform keychain.

## ANDROID_SPECIFIC

Present in the repo as Android projects only. There is no `ios/` directory and no Swift file under `mobile/modules/`.

| Module | What the Android code actually uses |
| --- | --- |
| `lugin-card-detector` | Kotlin geometry (`DetectCard.kt`, `Geometry.kt`). No third-party vision library in `android/build.gradle`. |
| `lugin-ocr` | ML Kit `com.google.mlkit:text-recognition:16.0.1`. |
| `lugin-visual-recognizer` | ONNX Runtime `com.microsoft.onnxruntime:onnxruntime-android:1.19.2`, plus the CLIP / gallery Kotlin (`LuginVisualModule.kt`, `VNextGallery.kt`). |

`app.config.ts` registers those three modules as Expo plugins. An iOS prebuild would have to omit them or supply an iOS implementation. They were not changed for this work.

Scanner frame code also branches on Android pixel layout:

- `mobile/src/scan/imageToScanImage.ts` remaps a reported `bgra` buffer to `rgba` when `Platform.OS === 'android'`.
- `mobile/src/scan/frameToScanImage.ts` documents CameraX RGB analysis.
- `mobile/src/scan/saveDebugBundle.ts` uses Android Storage Access Framework and the Android share-message size cap.

## IOS_IMPLEMENTATION_NEEDED

Not started. This phase does not port the scanner.

- iOS implementations of the detector, OCR, and ONNX recognizer, if a later phase wants the camera on iPhone. ML Kit's Android artifact and `onnxruntime-android` do not cover that.
- An iOS pass over the camera adapters above before Single Scan or Binder can be trusted. `react-native-vision-camera` and `react-native-nitro-image` are dependencies with their own iOS support; the Lugin adapters around them are written against the Android camera.
- A new development binary before SQLite is the on-device store. The JS package is installed. The installed APK is not.
- A Google OAuth client that allows `lugin://oauth`. That is configuration, not Swift. A Web client may reject the custom scheme. Collection editing does not wait on it.

## UNKNOWN

- Whether `expo prebuild --platform ios` succeeds with the current plugin list. It was not run, because the three local modules are Android-only and a prebuild would become a scanner-port task.
- Whether VisionCamera 5.2.3 and nitro-image 0.14.0 link cleanly against this Expo SDK 57 / React Native 0.86.3 app on iOS. No iOS build was made.
- Whether Google will accept `lugin://oauth` for the existing client id. The app reads `EXPO_PUBLIC_GOOGLE_CLIENT_ID` or `VITE_GOOGLE_CLIENT_ID` and does not embed a secret.
