# Lugin — Privacy Policy

_Last updated: 13 August 2026_

Lugin is a browser extension that adds an alternative interface on top of
Cardmarket. It is built so that no operator of Lugin ever holds your data:
there is no Lugin server, no Lugin database, and no Lugin account.

## What Lugin reads

Only pages you open yourself on `https://www.cardmarket.com`, and only while
you are on them. Lugin reads the page that is already rendered in your browser —
your collection, decks, want lists, purchases and shipping details — the same
information visible on screen.

Lugin does not read any other website. It is not injected anywhere else, and the
permissions it requests name Cardmarket explicitly.

## Where that data is kept

On your own computer, in the browser's extension storage.

If — and only if — you press **Connect Google**, your collection, decks,
printing choices and preferences are also written to your own Google Drive, in
the hidden per-application folder Google calls `appDataFolder`. This is the sole
purpose of the Google connection: to move your data between your own devices.

That folder is private to this application. Lugin requests exactly one Google
permission, `drive.appdata`, which cannot see, read or alter anything else in
your Drive: not your documents, not your photos, not your other files. The data
lives in your Google account, under your control, and can be deleted by
disconnecting and removing the folder from your account's app settings.

Your want lists, your purchase history and all cached card data are deliberately
**not** synchronised. They stay on the device that produced them.

## What is never collected

- Your Cardmarket password, cookies or session — Lugin never reads, stores or
  transmits them, and the extension cannot sign in as you.
- Your browsing history, or any page outside Cardmarket.
- Analytics, telemetry, advertising identifiers or crash reports. There are none.
- Anything at all sent to a server operated by Lugin's author, because none
  exists.

## Third parties Lugin talks to

To show card information Cardmarket does not publish, Lugin looks cards up by
**name** against public, free APIs. Only card names and set codes are sent —
never anything about you, your account or your collection's value.

| Service                | What is sent                | Why                                          |
| ---------------------- | --------------------------- | -------------------------------------------- |
| Scryfall               | Card names, set codes       | Card metadata, legality, images              |
| EDHREC                 | Commander card names        | Deck recommendations                         |
| MTGGoldfish            | Archetype page requests     | Archetype card breakdowns                    |
| Cardmarket help API    | Weights and destination     | Shipping cost calculation                    |
| Google Drive API       | Your synced data            | Storing it in your own Drive, if you connect |

Each of these has its own privacy policy, and each sees only an anonymous
request from your browser.

## Your control

- Lugin only syncs after you explicitly connect a Google account.
- **Disconnect** revokes the access token immediately. It does not delete your
  Drive data, so reconnecting restores it; removing the app's data from your
  Google account settings deletes it for good.
- Uninstalling the extension removes everything stored locally.

## Contact

Questions about this policy, or a request to delete data, can be raised on the
project's issue tracker.
