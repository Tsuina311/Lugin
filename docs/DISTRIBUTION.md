# Shipping Lugin to a list of test users

Four routes, because they carry different things:

| What                        | Where                | Gate on the tester list                | Cost |
| --------------------------- | -------------------- | -------------------------------------- | ---- |
| The extension, as a zip     | **You, by hand**     | Whoever you send the file to           | free |
| The extension, installable  | **Chrome Web Store** | Visibility `Private` + trusted testers | $5   |
| The phone app (read-only)   | **GitHub Pages**     | OAuth test users — no sign-in, no data | free |
| The phone app (minibrowser) | **Google Play**      | Internal testing track + tester emails | $25  |

Google Play does not distribute browser extensions, and the Chrome Web Store does
not distribute Android apps. There is no single place that does both — and
neither of the free routes needs an account anywhere.

A third list also exists and is easy to forget: the **OAuth consent screen's
test users**, in Google Cloud. Lugin's consent screen is in `Testing` status, so
a person who is not on that list cannot sign in to Google *even if the store let
them install the extension*. Any tester therefore has to appear on **two** lists:
the store's, and the OAuth one.

---

# Part 1 — The extension, today: a zip you send people

No account, no review, no fee. The cost is manual installation and manual
updates, which is a fair trade for the first handful of testers.

## 1. Give the extension a fixed identity

Do this once, before building anything you intend to send out:

```bash
yarn key
```

It generates an RSA key pair, keeps the private half in `.extension-key.pem`
(gitignored), and writes the public half into `.env.local` as
`LUGIN_EXTENSION_KEY`, which the manifest carries as `key`.

This exists because the sign-in redirect is derived from the extension id:

```ts
`https://${chrome.runtime.id}.chromiumapp.org/`;
```

Google matches that string exactly, and an unpacked extension is assigned a
**random id every time it is loaded fresh** — so without a pinned key, every
tester's install would have a different id and a different redirect URI, and
Google would answer `redirect_uri_mismatch` for all of them. With the key, every
copy of this build has the same id, which `yarn key` prints:

```
extension id: dlkphhoegbfpjnkmijopncgbmfbimakg
redirect URI: https://dlkphhoegbfpjnkmijopncgbmfbimakg.chromiumapp.org/
```

**Back up `.extension-key.pem`.** Regenerating it changes the id, which makes
every existing install a different extension — new redirect URI, and Chrome
treats it as unrelated to the one already installed.

## 2. Register that redirect URI

Google Cloud console → **APIs & Services** → **Credentials** → your OAuth 2.0
client (the *Web application* one) → **Authorised redirect URIs** → add the line
`yarn key` printed, trailing slash included. A client can hold several, so
existing ones can stay.

Then add each tester's Google address under **OAuth consent screen** →
**Audience** → **Test users**. Without that they can install the extension and
still not sign in.

## 3. Build the zip

```bash
yarn package:testers
```

Writes `release/lugin-<version>-testers.zip` (~190 KB). Unlike `yarn package`,
this **keeps** the manifest's `key` — that is the entire point — and refuses to
build at all if no key is set, since a keyless tester build installs fine and
then fails at sign-in on every machine.

## 4. What a tester does

1. Unzip it somewhere it can stay: Chrome loads an unpacked extension from that
   folder every start, so deleting or moving it uninstalls the extension.
2. `chrome://extensions` → turn on **Developer mode** (top right).
3. **Load unpacked** → select the unzipped `lugin-<version>` folder.
4. Open a Cardmarket page; the toolbar icon toggles the overlay.

What to warn them about, so it doesn't read as a bug:

- Chrome shows **"Disable developer mode extensions"** on some startups. Dismissing
  it is safe; it reappears.
- There are **no automatic updates**. A new version means a new zip, and
  **Update** on `chrome://extensions` after replacing the folder.
- Chrome will not install a `.crx` dragged in from outside the store on Windows or
  macOS, so unpacked really is the only free route.

## 5. Shipping an update

Bump `version` in `package.json`, `yarn package:testers`, send the new zip. The
key is unchanged, so the id, the redirect URI and their signed-in state all
survive.

---

# Part 2 — The extension, properly: the Chrome Web Store

Worth doing when the tester list outgrows email, or the developer-mode nag does.
`Private` visibility keeps it invisible to everyone but your trusted testers,
while giving them a normal one-click install and automatic updates.

> **The id changes here, and it is the one thing to plan for.** The store re-signs
> the item with its *own* key and assigns its own permanent id, so the published
> extension does **not** have the id from Part 1. Nothing breaks if you register
> both redirect URIs on the OAuth client and leave them there: the zip installs
> keep working while the store item takes over. Step 3 below then switches
> `.env.local` to the store's key so your local build matches the published id.

## 1. Register as a Chrome Web Store developer

<https://chrome.google.com/webstore/devconsole> → accept the terms → pay the
one-time $5 registration fee. Use the same Google account that owns the Cloud
project holding the OAuth client, or you will be juggling two logins forever.

## 2. Build the upload

```bash
yarn package
```

This writes `release/lugin-<version>.zip` and refuses to build one the store
would reject: it checks the name and description lengths, that every icon the
manifest names is really there, that `dist/` isn't stale, and it strips the
manifest's `key` field, which the store rejects on upload.

## 3. Create the item, then re-pin the extension id to it

This ordering matters, and it's the step that breaks Google sign-in if skipped.
The id you get here replaces the one from Part 1 — same mechanism, different key,
because the store insists on signing with its own.

1. On the dashboard, **Add new item**, and upload the zip. Do not publish yet.
2. Open the item's **Package** tab → **View public key**.
3. Copy everything between `-----BEGIN PUBLIC KEY-----` and `-----END PUBLIC
   KEY-----`, and **replace** the value `yarn key` wrote in `.env.local`:

   ```bash
   LUGIN_EXTENSION_KEY=MIIBIjANBgkqhkiG9w0…
   ```

   Newlines are stripped for you, so pasting the block as-is on one line is fine.
   Keep `.extension-key.pem` regardless: it is what the zip installs from Part 1
   are still running on.
4. `yarn build`, then reload the unpacked extension. Its id at
   `chrome://extensions` should now equal the **Item ID** on the dashboard.

Your local build and every tester's installed build now share one id, and so one
redirect URI.

## 4. Register the redirect URI on the OAuth client

Google Cloud console → **APIs & Services** → **Credentials** → your OAuth 2.0
client (the *Web application* one, `690972952850-…`) → **Authorised redirect
URIs** → add, with the trailing slash:

```
https://<ITEM_ID>.chromiumapp.org/
```

Keep any existing dev URI alongside it; a client can hold several.

## 5. Add the testers — both lists

**Chrome Web Store**, controlling who can install:
Dashboard → **Account** tab → **Management** → **Trusted testers** → tester
emails, comma- or space-separated → **Save**. This field takes individual
accounts only, not a Google Group address.

**Google Cloud**, controlling who can sign in:
**APIs & Services** → **OAuth consent screen** → **Audience** → **Test users** →
**Add users** → the same emails. Cap is 100, and each one consumes the project's
quota permanently, so don't add addresses speculatively.

> Worth knowing: Lugin's only scope, `drive.appdata`, is classified
> **non-sensitive** by Google. You will never need to pass OAuth verification,
> and the "unverified app" 100-user cap doesn't apply to you. If maintaining the
> test-user list becomes annoying, you can publish the consent screen to
> Production and delete the list entirely without triggering a review — the store
> visibility keeps gating who gets the extension. Testers see a "Google hasn't
> verified this app" notice either way until you complete optional brand
> verification.

## 6. Fill in the listing

The tabs that block submission, and what Lugin's answers are:

**Store listing** — description (the manifest's is reused; the store's own field
allows more), category *Productivity*, language, and:

- At least one **screenshot**, 1280×800 or 640×400 PNG/JPEG. Screenshot the
  overlay open on a Cardmarket page.
- Optional but worth it: a **small promo tile**, 440×280.

**Privacy** — the fiddly one:

- _Single purpose_:

  > Lugin provides an alternative interface for Cardmarket, letting a user view
  > and organise their own collection, decks and want lists with card metadata
  > the site does not itself expose.

- _Permission justifications_:

  | Permission                  | Justification                                                                                                        |
  | --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
  | `storage`                   | Stores the user's collection, decks and preferences locally.                                                          |
  | `unlimitedStorage`          | A full collection with cached card metadata exceeds the 10 MB quota.                                                  |
  | `identity`                  | Opens the Google sign-in window so the user can sync their own data to their own Google Drive. Nothing starts unprompted. |
  | `host` — cardmarket.com     | The site the interface is built on; the extension reads the page the user has open.                                   |
  | `host` — api.scryfall.com   | Free card metadata (types, colours, mana values) that Cardmarket doesn't expose, looked up by card name.               |
  | `host` — json.edhrec.com    | Commander deck recommendations; serves no CORS headers, so the request must come from the worker.                      |
  | `host` — www.mtggoldfish.com | Per-archetype card breakdowns, parsed from the page.                                                                  |
  | `host` — help.cardmarket.com | Cardmarket's own public shipping-cost calculator.                                                                    |
  | `host` — googleapis.com     | The Drive appDataFolder the user's data syncs through.                                                                 |

- _Remote code_: **No, I am not using remote code.** Everything is bundled.
- _Data usage_: tick **Website content**, and the three certifications (not sold
  to third parties, not used or transferred for purposes unrelated to the single
  purpose, not used to determine creditworthiness or for lending). Syncing to the
  user's own Drive counts as data leaving the device, so declaring it is the
  honest answer even though no server of ours receives it.
- _Privacy policy URL_: required, and already satisfied now that the repository is
  public — GitHub renders the file, and that counts:

  ```
  https://github.com/Tsuina311/lugin/blob/main/docs/PRIVACY.md
  ```

**Distribution** — **Visibility: Private**, then *Only trusted testers from the
current publisher settings*. Free, and pick your countries.

## 7. Submit

**Submit for review.** Private items are still reviewed; a small extension like
this is typically a few hours to a few days. Untick the auto-publish box if you'd
rather release it manually once it passes.

## 8. What a tester does

Send them the item URL. While signed into Chrome with a listed email they'll see
the listing and an **Add to Chrome** button; anyone else gets a 404. On first use
they press **Connect Google** and consent to the app-data scope.

If a tester reports sign-in failing, it is almost always one of: their address
missing from the OAuth test users list, or the redirect URI not matching the
published item id.

## Shipping an update

Bump `version` in `package.json` (the manifest reads it), `yarn package`, then
upload the new zip to the same item and submit again. The extension id never
changes, so the OAuth client needs no further edits. Keep the `key` in
`.env.local` — it's stripped from every zip automatically.

---

# Part 3 — The phone app, today: a web app on GitHub Pages

No store, no review, no tester list, no toolchain. `yarn build:web` produces a
static site; Pages serves it; your phone opens it and can add it to the home
screen, where it runs fullscreen with its own icon.

It is read-only on purpose: it shows the collection and decks your desktop
synced, and can't write to Drive.

## Why a web app can't be the minibrowser

Worth being explicit, because it's the one thing this path cannot do. Showing
Cardmarket *inside* our own interface needs two things a web page may not have:

- **Framing.** Cardmarket sends `x-frame-options: SAMEORIGIN`, so no page on
  another origin may embed it in an `<iframe>`.
- **Cross-origin scripting.** Even without that header, a page cannot read or
  inject into a document from another origin. Cloudflare also challenges
  non-browser requests, so fetching and re-rendering it server-side is out too.

Browsing and buying from the phone therefore needs a native WebView the app owns
— which is Part 4, and the only reason the Android SDK and Play Store come into
it at all.

## Steps

The repository is already on GitHub and public, which Pages requires on a free
account. What remains is three settings and a push.

1. **Enable Pages**: <https://github.com/Tsuina311/lugin/settings/pages> → Build
   and deployment → Source: **GitHub Actions**. Until this is on, the build
   succeeds and the deploy step has nowhere to publish to.
2. **Add the client id**:
   <https://github.com/Tsuina311/lugin/settings/variables/actions> → New
   repository variable → `VITE_GOOGLE_CLIENT_ID`, the same one the extension uses.
   A variable rather than a secret deliberately: it ships in the bundle
   regardless. Omitting it still deploys — the app just reports itself
   unconfigured instead of offering sign-in.
3. **Register the origin.** Google Cloud console → Credentials → your OAuth
   client → **Authorised JavaScript origins** → add:

   ```
   https://tsuina311.github.io
   ```

   Origin only — no path, no trailing slash. The phone build uses Google Identity
   Services, which validates the *origin* and needs no redirect URI, so there is
   nothing extension-id-shaped to keep in step here.
4. **Push to `main`.** The workflow in `.github/workflows/pages.yml` runs the
   render checks, builds with the base path derived from the repository name, and
   deploys to <https://tsuina311.github.io/lugin/>. `workflow_dispatch` is also
   enabled, so a failed deploy can be re-run from the Actions tab without a
   commit.
5. **On your phone**, open that URL, tap **Connect Google**, and your collection
   and decks appear. Chrome's ⋮ menu → **Add to Home screen** installs it.

Your testers are gated by the OAuth consent screen's test-user list: without a
Google sign-in the app shows nothing, so an address that isn't on that list gets
an empty app rather than your data.

## Running it locally

```bash
yarn dev:web       # port 5174, reachable from your phone on the same network
yarn build:web
yarn preview:web
yarn test:web      # server-renders every screen; catches blank-page regressions
```

Google sign-in will not work over plain `http` from another device — Google only
exempts `localhost` — so LAN testing shows the interface but not your data. The
deployed Pages URL is the one to sign in from.

---

# Part 4 — Later: the native Android app

> **Status: not built.** Needed only for the minibrowser — browsing Cardmarket
> inside the app with our overlay injected, using your logged-in session.
> Planned as Capacitor wrapping the same React bundle, with
> `@capgo/capacitor-inappbrowser` behind our own `MiniBrowser` interface so the
> plugin can be swapped for a hand-written one later.
>
> Prerequisites nobody can skip: a JDK and the Android SDK (neither is currently
> installed), and the $25 Play registration. This section is the distribution
> half, valid once there is an `.aab` to upload.

## Which track

| Track        | Testers | Review           | Counts toward production access |
| ------------ | ------- | ---------------- | ------------------------------- |
| **Internal** | 100     | none, ~minutes   | no                              |
| Closed       | large   | yes              | **yes**                         |
| Open         | public  | yes              | yes                             |

**Internal testing** is the one that matches "only people on my list": you paste
tester emails, Google generates an opt-in link, and builds reach them within
minutes with no review wait.

You may have read about needing 12 testers for 14 continuous days. That rule
belongs to **closed** testing, and it only gates reaching **production** on
personal developer accounts created after 13 November 2023. It does not stand
between you and testers.

## Steps

1. Register at <https://play.google.com/console> — one-time $25. A personal
   account requires identity verification, which can take a couple of days, so
   start it early.
2. **Create app**: name, default language, *App*, *Free*.
3. Work through **Dashboard → set up your app**: privacy policy URL (the same one
   as the extension), app access, ads declaration, content rating questionnaire,
   target audience, and the **Data safety** form — the Drive-only architecture
   makes this short, and its answers should mirror `docs/PRIVACY.md`.
4. **Testing → Internal testing → Testers**: create an email list, add the same
   addresses as the other two lists.
5. **Create new release**, upload the signed `.aab`, roll out.
6. Copy the **opt-in URL** and send it to testers. They accept, then install from
   the Play Store as usual.

## The Android OAuth client

The Android app needs its **own** OAuth client in the **same** Cloud project —
Android clients are identified by package name plus signing-certificate SHA-1
fingerprint, not by a redirect URI. Because Play re-signs the app with its own
key, register the SHA-1 that Play Console shows under **Release → Setup → App
signing**, not just your local debug key, or sign-in will work in development and
fail for every tester.

Both platforms then hold their own credentials for the same Google account, and
meet in the same `appDataFolder`. There is no token sharing between devices.
