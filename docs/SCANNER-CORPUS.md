# Scanner development corpus

Selective, opt-in capture of real scanner failures and corrections — stored in
the **user's own Google Drive**, then imported locally for annotation and
benchmarks.

```text
scanner events
→ sanitizer (JPEG, EXIF stripped)
→ IndexedDB queue
→ Google Drive: Lugin / Scanner Corpus / …
→ (optional) share / export
→ yarn scan:corpus:import
→ yarn scan:detect-annotate --queue
→ .scan-real/
→ yarn scan:detect-eval --real
```

No Cloudflare Worker, R2 bucket, or corpus API is required.

---

## Tester workflow

1. Open the scanner and choose **Help development** (or decline).
2. When Google Drive is connected (same Connect Google flow as collection sync),
   selected samples upload to:

   ```text
   My Drive / Lugin / Scanner Corpus / contributor-<id> / YYYY-MM / <sampleId>/
     image.jpg
     metadata.json
   ```

3. Offline or disconnected: samples stay in IndexedDB; scanning continues.
4. Samples are **not** sent to the Lugin developer automatically.

### Sharing with the developer

**Option A — Share the Drive folder**

Open **Lugin → Scanner Corpus** in Google Drive and share that folder (or a
month / sample subfolder) with the developer. Lugin never auto-grants sharing.

**Option B — Export pending samples**

In the scanner capture menu: **Export pending samples** downloads a JSON bundle
you can send manually. Import it with `yarn scan:corpus:import`.

---

## Developer workflow

### Own phone / own Drive

1. Download or open `Lugin / Scanner Corpus` from Drive (or use a shared link).
2. Import:

   ```bash
   yarn scan:corpus:import ./path/to/Scanner-Corpus
   # or
   yarn scan:corpus:import ./lugin-scanner-corpus-YYYY-MM-DD.json
   ```

3. Annotate (detector polygons are **not** ground truth until reviewed):

   ```bash
   yarn scan:detect-annotate --queue
   ```

4. Evaluate:

   ```bash
   yarn scan:detect-eval --real
   yarn scan:pipeline:real   # full pipeline vs real fixtures when available
   ```

### Tester samples

Same import path after they explicitly share or export. Never pull other users'
Drives silently.

---

## Privacy

* Frames may show the desk and objects around the card.
* No continuous video, no audio, no GPS/EXIF.
* Metadata uses anonymous `contributorId` / `sessionId` / `sampleId` — **not**
  Google email or account id.
* Opt-out stops **future** captures; existing Drive files remain until you
  delete them in Drive.
* Typical sizes: full-frame ≈ JPEG ≤1280px edge @ q≈0.82; card crop ≤744px.

---

## Google scopes

| Scope | Purpose |
| --- | --- |
| `drive.appdata` | Hidden collection / deck sync (unchanged) |
| `drive.file` | Create/manage the visible `Lugin / Scanner Corpus` tree |

Existing Google connections may need **Connect Google** again once to grant
`drive.file`. Sync still uses only appDataFolder; corpus writes only files this
app creates under My Drive.

---

## Security model (Drive era)

There is **no** public ingest HTTP endpoint. Threat focus:

* Existing OAuth / token handling
* Minimal scopes (`appdata` + `file`)
* Safe folder/file names (no user path input)
* No Google identity in `metadata.json`
* Schema + magic-byte validation on import
* Scanner continues if Drive is unavailable

---

## Cost / infrastructure

This path needs **no** dedicated corpus backend, Worker, Durable Object, or R2
bucket. It uses the user's Google Drive quota (not unlimited).

---

## Commands

```bash
yarn test:corpus
yarn scan:corpus:import <path>
yarn scan:detect-annotate --queue
yarn scan:detect-eval --real
yarn scan:pipeline:real
```

---

## Remaining limitations

* Uploads require a connected Google account with the updated scopes.
* Drive API quotas / rate limits can delay drains; the queue backs off.
* Sharing is manual — there is no central corpus inbox.
* Imported samples still need human annotation before `.scan-real/` eval.
