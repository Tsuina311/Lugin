# Historical mobile audit

Written before the current Lugin Web parity decision. Keep this as historical
design context; `LUGIN_MOBILE_PARITY.md` is the current product and architecture
contract. Lugin Native is the Android app and Lugin Web is the zero-install,
first-class iPhone experience.

Scanner vNext stays frozen. This work is persistence, sync, and product
screens. Recognition thresholds, CLIP, galleries, and the detector are out
of scope.

## What already agrees

Lugin Chrome and Lugin Web already share one domain and one Drive
document. Native does not need a new file format.

| Piece           | Where                                                 | Notes                                                                                                                                                    |
| --------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema version  | `SYNC_SCHEMA_VERSION = 1` in `src/core/sync/model.ts` | A newer version is refused. It is not partially applied.                                                                                                 |
| Document        | `SyncedApplicationState`                              | `schemaVersion`, `deviceId`, `updatedAt`, `data`                                                                                                         |
| Domains         | `collection`, `decks`, `preferences`, `printings`     | Each is `{ updatedAt, value }`                                                                                                                           |
| Drive file      | `app-state.json` in `appDataFolder`                   | `src/core/sync/drive.ts`. Revision is Drive's file `version`.                                                                                            |
| Conflict copies | `conflict-<domain>-<stamp>.json`                      | Same folder. The loser is archived, then the newer stamp is shown.                                                                                       |
| Engine          | `createSyncEngine`                                    | Per domain. Same domain edited on both sides since `SyncMeta.base`: newer `updatedAt` wins, the other is archived. Different domains are not a conflict. |
| Local port      | `LocalRepository`                                     | Lugin Chrome: `chrome.storage`. Lugin Web: IndexedDB (`src/platform/web/localRepository.ts`).                                                            |
| Token port      | `TokenProvider`                                       | Lugin Chrome: `chrome.identity`. Lugin Web: Google Identity Services. No client secret.                                                                  |
| Scopes          | `drive.appdata` and `drive.file`                      | App data is the library. `drive.file` is the optional scanner corpus only.                                                                               |

There is no Lugin account and no Lugin server.

### Collection

`CollectionCard` in `src/lib/collection.ts` is the row. Persisted shape is
`StoredCollection`: `cards`, `format` (`manabox` | `list`), `importedAt`,
`source`. `byKey` is derived, not stored.

Fields already on a row: `name`, `quantity`, `foil`, `language`, `condition`,
`setCode`, `setName`, `collectorNumber`, `scryfallId`, `productId`,
`imageUrl`, `rarity`, `purchasePrice`, `source` (`import` | `purchases`).
The Drive reader keeps any extra fields on the row (`readCollection` spreads
the object). A native serializer must do the same.

Identity for "how many of this card" is `cardKey(name)`. Identity for one
printing row is `printingIdentity` in `src/lib/collectionEdit.ts`. A row does
not require a printing. A name-only row is valid.

Quantity edits already exist: `adjustCollectionQuantity`,
`adjustPrintingQuantity`, `withCopies`. Scan merge in Lugin Web is
`findDuplicates` + `applyImport`. Matching set + number + foil should bump
quantity rather than insert a twin. Purchase rows are not a merge target.

### Decks

`Deck` / `DeckCard` in `src/lib/deck.ts`. One logical deck, not a native
variant. Fields: `id`, `name`, `format`, `cards`, `source`, `createdAt`,
`updatedAt`, optional `frozen` (paper lock), `autoLands`, `landTarget`,
`tagOverrides`, `tagSections`, and per card `printing`.

Formats: commander, standard, pioneer, modern, legacy, vintage, pauper,
freeform. Sections: `commander`, `main`, `sideboard`.

Shared operations the native editor can call without a second algorithm:
`newDeck`, `parseDeckList`, `deckFromImport`, `mergeDeckCards`, `withFormat`,
`deckShortfall`, `copiesAcrossDecks`, `coverageView`, `estimateDeck` (pass
`null` for the combo bundle; the construction floor still runs). The combo
index loader uses the extension messaging bridge. Do not call it from native.

Mana curve, land balancing, and the printing picker are desktop UI. Leave
them there.

### Preferences and printings

`SyncedPreferences`: `addPurchasesToCollection`, `homeCountry`, `theme`.
The first two are Cardmarket settings. Native must round-trip them and does
not need screens for them.

`printings` is `Record<string, CardImageOverride>` (`scryfallId`, `setCode`,
`setName`, `collectorNumber`, `imageUrl`). Chosen printings travel even when
the phone UI only displays them.

### What does not sync

Want lists, purchase history, carts, the price table, and scanner indexes
stay on the device that produced them. Prices are a public daily file
(`prices.json` beside Lugin Web, about 3.5 MB), not a Drive domain.

### Import / export

`src/lib/import.ts` and `src/lib/export.ts`. ManaBox CSV and deck text.
`inspectImport` is the round-trip check. Native should call these, not
reimplement them.

## Extension

Overlay tabs read and write the same `ApplicationData` through
`src/platform/chrome/localRepository.ts` and `createSyncEngine`. Collection
and deck stores are Chrome-specific shells over the shared types. Schema
assumptions are `SYNC_SCHEMA_VERSION` and the four domains. No second
collection type.

## Phone website

`src/web/syncStore.ts` is the behaviour native should match:

- Render the local document. Drive is a delayed copy.
- Local write is immediate. Push is debounced.
- A failed push leaves data on the device and shows pending, not a block.
- Empty install is asked to sign in before the first import, because a later
  local stamp with no shared base would beat the desktop and only keep the
  desktop as a conflict copy.

Screens: Collection, Decks, Scan, Import. Scan uses the browser camera and
writes through `syncStore.addCards`. Decks already include tags, EDHREC,
Goldfish, cuts, paper lock, and the bracket mark. They do not include the
mana curve, land balancing, or printing picker.

IndexedDB database name `lugin`, object store `sync`, keys `data` and `meta`.
If IndexedDB cannot open, the session falls back to memory.

Role from here: zero-install access, collection, decks, import, fallback.
Do not keep growing it toward the native app.

## Native Android, before this work

Expo SDK 57, React Native 0.86, package `app.lugin.mobile`, scheme `lugin`.
Development client. Camera is VisionCamera. Detector, OCR, and the visual
recognizer are local Expo modules.

| Tab         | State                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| Collection  | `StubScreen`. No rows.                                                                               |
| Decks       | `StubScreen`.                                                                                        |
| Single Scan | Real. Default pipeline is geometry-v2 (`VerifiedScanPanel`). Legacy path still has `ScanResultCard`. |
| Binder      | Binder Mode V0. Tracks and best frame. No names. No collection write.                                |
| Settings    | Version, updates, scanner data, debug inbox, benchmark tools.                                        |
| Geometry    | Development builds only.                                                                             |

`collectionAddFromPrinting` builds a `CollectionCard` via `cardFromScan` and
returns it. Nothing stores it. `mobile/src/scan/memoryRepository.ts` is an
in-memory `LocalRepository` used by a smoke test. Its own comment says
`expo-sqlite` was deferred because it changes the EAS fingerprint.

No `expo-sqlite`, `expo-auth-session`, or `expo-secure-store` in the app
package. `expo-file-system` and `expo-sharing` are already in the binary.
Google sign-in does not exist on native. Scanner session files under the
app's document directory are diagnostics, not a user collection. Do not
delete them. The library database starts empty.

`SessionSnapshot.resultCardSessionId` and `lockGates.cardSessionId` are the
ownership pair. An add must use the session that published the result.

## Conflict rule to preserve

Do not replace the engine. It is already per-domain, with an archive of the
loser. It is not a blind whole-file overwrite.

The dangerous case is the first sync, when `SyncMeta.base` is empty, so both
sides look edited. A phone that scanned cards and then connects can out-stamp
the desktop. Lugin Web avoids that by signing in before the first
import. Native must not auto-push in that situation. Keep the phone data,
refuse the automatic merge, and require an explicit choice.

## Native build

`expo-sqlite` `~57.0.2` matches this SDK and is not in the installed APK.
Adding it does not run on the current binary until a new development build.
Until that build exists, the app persists the same document through
`expo-file-system` (already linked) so a kill/reopen still keeps cards.
Settings names which store is active. Do not start an EAS build from this
change.

OAuth on the current binary uses the system browser and `lugin://oauth`
(React Native `Linking`, already present). The existing Google client is a
web client. It needs `lugin://oauth` as a redirect URI, which Google's web
client type may reject. Tokens then wait on an Android/iOS OAuth client.
Local use does not wait on that.

## iOS

New library, auth, and file code must not import Kotlin or the detector.
The scanner stays Android-only in this phase. No Swift scanner, no iOS CLIP,
no iOS ML Kit port.
