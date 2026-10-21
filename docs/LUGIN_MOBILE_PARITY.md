# Lugin mobile parity

## Product names

- **Lugin Chrome** — the Chrome/Cardmarket extension.
- **Lugin Native** — the Android React Native app. A native iOS app is deferred.
- **Lugin Web** — the installable Progressive Web App and current iPhone experience.

## Feature audit

| FEATURE           | NATIVE                                                                                    | WEB                                                                    | SHARED LOGIC                                                                        | GAP                                                                                          | ACTION                                                                |
| ----------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Collection        | Search, list/grid images, quantities, printings, foil, value, add/edit/delete, counts     | Same core workflow; Scryfall suggestions and art/edition/finish picker | `collection`, `collectionEdit`, `collectionView`, `collectionPrintPicker`, `prices` | Language/condition are preserved by import and sync but neither direct add UI edits them yet | Add those fields once in shared intake, then expose platform controls |
| Decks             | List/create/rename/delete, quantities, paste, commander, tags, paper lock and suggestions | Same, including import/export and suggestion panels                    | `deck`, `deckPaper`, deck feature modules                                           | Presentation remains intentionally platform-specific                                         | Keep rules shared; keep React Native/DOM views separate               |
| Drive sync        | SQLite/file adapter + native OAuth                                                        | IndexedDB adapter + Google Web OAuth                                   | `src/core/sync`, schema 1, `app-state.json`                                         | Storage and OAuth adapters differ by design                                                  | Preserve adapter boundary                                             |
| Import/export     | ManaBox and deck parsing; native file/share adapters                                      | ManaBox/deck import, downloads and browser sharing                     | `import`, `export`, `duplicates`, deck parser                                       | Picker/share UI differs                                                                      | Parser fixes belong in shared modules                                 |
| Preferences       | Settings screen and synced preference domain                                              | Preference domain is read, stored and synced; no full Settings screen  | Sync model/serializer                                                               | Fewer Web controls                                                                           | Add only useful Web controls during polish                            |
| Chosen printings  | Synced and applied to images                                                              | Synced and now applied to Collection/Deck images                       | `printing`, sync `printings` domain, image candidate rules                          | Picker presentation differs                                                                  | Keep domain shared                                                    |
| Prices            | Cached prices and collection value                                                        | Cached prices, total value and per-deck/card data                      | `prices` and common price sources                                                   | Cache adapters differ                                                                        | No domain gap                                                         |
| Copy coverage     | Owned/missing and use across decks                                                        | Same                                                                   | `coverageView`, `copiesAcrossDecks`, deck paper rules                               | None found                                                                                   | Shared tests guard results                                            |
| Commander bracket | Deck/list indication and explanation                                                      | Deck/list indication and explanation                                   | `bracket`, `decks/bracket/estimator`                                                | None found                                                                                   | One estimator only                                                    |
| EDHREC            | In-app suggestion tab                                                                     | In-app suggestion tab                                                  | EDHREC client and deck suggestion rules                                             | Layout differs                                                                               | Keep as tabs, not outbound-only buttons                               |
| Goldfish          | In-app archetype suggestion tab                                                           | In-app archetype suggestion tab                                        | `mtggoldfish` and `GoldfishPanel` behavior                                          | Network source can lack an archetype                                                         | Keep fallback/error behavior aligned                                  |
| Search            | Collection/deck/Scryfall suggestions                                                      | Collection/deck/Scryfall suggestions                                   | `search`, card-name normalization, Scryfall request gate                            | Platform controls differ                                                                     | Search semantics stay shared                                          |
| Card images       | Persistent native cache and preload batches                                               | Browser HTTP cache/service worker plus shared fallbacks                | `cardImage`, `collectionView`, chosen printings                                     | Browser cache lifecycle is not native cache lifecycle                                        | Keep URL/printing choice shared                                       |
| Scanner           | Android native camera, detector, OCR, Binder                                              | Browser camera scanner where supported                                 | `collectionIntake` after recognition                                                | Recognition is intentionally platform-specific                                               | Do not port/fake native ML                                            |
| Offline           | Local SQLite/file state and pending sync                                                  | IndexedDB state, precached application assets and pending sync         | Sync conflict/merge behavior                                                        | Safari may evict browser storage; private mode falls back to memory                          | Surface persistence warning and sync state                            |
| Sharing           | Native share/filesystem                                                                   | `navigator.share`, download fallback and Web Share Target              | Export serialization                                                                | Browser capability varies                                                                    | Use capability checks                                                 |

## Shared mobile core

`src/core/mobile/capabilities.ts` names each product surface and describes
platform capabilities. UI uses this contract to show browser or native features
without cloning business rules.

The existing shared core remains the source of truth:

- Collection mutation/intake: `src/lib/collection*.ts`
- Printing selection: `src/lib/collectionPrintPicker.ts`, `src/lib/printing.ts`
- Deck behavior, paper lock and coverage: `src/lib/deck*.ts`
- Commander bracket: `src/lib/bracket.ts`, `src/lib/decks/bracket/`
- Search and images: `src/lib/search.ts`, `src/lib/cardImage.ts`
- Import/export: `src/lib/import.ts`, `src/lib/export.ts`, `src/lib/duplicates.ts`
- Drive document, validation, merge and conflicts: `src/core/sync/`

Do not create `NativeCollectionLogic` and `WebCollectionLogic`. When a generic
mobile feature changes, first decide whether its rule belongs in shared core.
Native and Web may then render that rule with separate React Native and React DOM
components.

Intentionally platform-specific:

- Lugin Native: SQLite/file adapter, VisionCamera, native recognition, Binder,
  SecureStore, permissions, native filesystem and share implementation.
- Lugin Web: IndexedDB, browser camera, browser OAuth, service worker, manifest,
  browser storage and Web Share APIs.

## Cross-client contract

All three clients use sync schema version 1 and the private Drive app-data
document. Lugin Web keeps the Google Web OAuth client; it does not use an
Android or iOS client. The shared parser retains unknown fields so an older
client does not erase data from another surface.

Automated shared-engine tests cover:

- Lugin Chrome → Drive → Lugin Web
- Lugin Web → Drive → Lugin Native
- Lugin Native → Drive → Lugin Chrome and Lugin Web
- Collection, decks, preferences and chosen printings together
- Unknown collection/card/deck/preference/printing fields
- Concurrent edits and conflict archives

These tests use the Web repository's memory fallback plus reference repositories
for Lugin Native and Lugin Chrome. Full conformance tests against real IndexedDB,
Chrome mapped storage, SQLite and the Native file fallback remain outstanding;
the suite must not be described as proof that every persistent adapter is
lossless.

Known sync risks to address separately:

- Drive's version check and update are currently separate requests rather than a
  guaranteed compare-and-swap.
- The Native JSON file fallback is not yet covered by durability/conformance
  tests.
- Local adapter writes do not expose a revision token, so an edit racing a pull
  needs stronger transactional protection.

## Lugin Web on iPhone

Public URL: <https://tsuina311.github.io/Lugin/>

The root URL is the public product chooser. **Open Lugin Web** enters the Web
client with `?app=1`; an installed Home Screen app starts there directly, so it
does not show the chooser or repeat installation instructions. Shared-file
launches also enter the Web client directly.

In iPhone/iPad Safari, when the site is not already standalone, Lugin Web shows
a dismissible install helper:

1. Share
2. Add to Home Screen
3. Add

Websites cannot invoke Apple's Add-to-Home-Screen dialog. The helper is hidden
in standalone mode and a dismissal is remembered for 30 days.

The manifest uses the Pages base path as its stable app id, scope and start URL.
It defines standalone display, portrait orientation, safe-area-friendly theme
colors, iOS touch icon, regular/maskable icons and the Android share target.
The service worker precaches the generated JavaScript/CSS and shell, while
preserving price, card-name, artwork and share-inbox caches across deployments.
It checks for updates again when the app becomes visible; a newer activated
bundle shows **Lugin Web has been updated — Reload** instead of interrupting an
active edit.

## Deployment

`.github/workflows/pages.yml` builds and deploys Lugin Web to GitHub Pages:

- trigger: push to `main`, manual `workflow_dispatch`, or the daily price refresh
  schedule at 10:30 UTC
- hosting: GitHub Pages; no paid host or backend
- assets: content-hashed JavaScript/CSS
- navigation: network-first with `cache: no-cache`, then offline shell fallback
- updates: old shell caches are removed during service-worker activation; users
  receive a safe reload prompt when an update activates

Lugin Native Android deployment remains on EAS channel `development`. iOS
build/signing/TestFlight profiles are intentionally absent.

## Cousin iPhone test

1. Open <https://tsuina311.github.io/Lugin/> in Safari.
2. Share → **Add to Home Screen** → **Add**, then open Lugin from the icon.
3. Tap **Connect Google** and confirm Collection and Decks appear.
4. Add one card, then create or edit one deck.
5. Close and reopen Lugin; confirm both edits remain.
6. Turn on Airplane Mode, make one quantity change, then reconnect and tap Sync.
7. Change something in Lugin Chrome and confirm it appears after Sync.
