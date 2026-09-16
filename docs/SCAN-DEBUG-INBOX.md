# Scan debug inbox

Development-only upload: phone geometry traces land in `.scan-inbox/` so Cursor can read them. Not telemetry. No Share sheet.

Helpers:

- `yarn scan:inbox` — local receiver (`http://127.0.0.1:8787`, Bearer token)
- `yarn scan:inbox:tunnel` — optional temporary HTTPS in front of that receiver
- `yarn scan:inbox:latest` — print path / type / phase / sample count
- `yarn scan:inbox:clean` — delete `.scan-inbox/` only (explicit)
- `yarn scan:replay --promote` — copy selected inbox traces into `.scan-fixtures/replay/` (PNG once)
- `yarn scan:replay <fixture-id>` — host recorded-OCR + portable warp (no ML Kit)
- `yarn scan:regression` — every saved replay fixture; gate for recognition-logic changes
- `yarn scan:device-replay <fixture-id>` — queue a debug ML Kit job; phone worker optional
- `yarn scan:capture-report` — A/B fast-snapshot vs photo summaries (separate from recognition regression)

Promote once after a Samsung upload. Later JS/TS recognition changes are evaluated on Mac from recorded OCR (`Maddenino Hey` / `Maddening Hesy`). Node does not reproduce Android ML Kit.

**HOST REPLAYABLE:** warp, title crop, preprocess hashes, CardNameIndex, fuzzy, consensus, acceptance.

**DEVICE REQUIRED:** new camera captures, native detector/focus, or a fresh ML Kit reading.

Device replay is debug-only: bearer auth, known job schema, explicit **Device replay worker ON**, no production polling. It does not replace `yarn scan:replay`.

`.scan-inbox/` is gitignored. Bearer auth is always required, including through a tunnel.

---

## CURRENT APK (cleartext HTTP blocked)

The installed development APK does not allow `http://192.168…`. Use a temporary HTTPS tunnel. No native change and no EAS.

1. **Terminal A:** `yarn scan:inbox`  
   Leave it running. Copy is not needed yet.
2. **Terminal B:** `yarn scan:inbox:tunnel`  
   Requires `cloudflared`. Prints an `https://….trycloudflare.com` URL and a Pair line.
3. **Phone:** Settings → Check for update → Apply (version stamp may look unchanged). Then Scan dbg **or** Settings → **Debug receiver** → paste the **Pair** line → Test connection
4. **Phone:** Scan dbg → Capture geometry trace
5. Wait for **Uploaded ✓ trace-00NN**
6. **Cursor:** *Analyze the latest scanner trace in `.scan-inbox/latest.json`*

The tunnel is not saved. Ctrl+C in terminal B stops only the tunnel; keep `yarn scan:inbox` running.

If `cloudflared` is missing, the command prints Homebrew install steps and does not install anything.

---

## FUTURE DEVELOPMENT APK (LAN HTTP)

A later development-only Android network-security config may allow `http://` on the LAN. **Do not implement that now.**

When that APK exists:

1. **Mac:** `yarn scan:inbox`
2. **Phone:** paste the printed `http://<LAN-IPv4>:8787` URL + token (same Wi-Fi)
3. Capture geometry trace as above

Until then, `yarn scan:inbox` alone is not enough for the current APK.

---

## Phone configuration

Shown only when developer/benchmark tools are on (`__DEV__` or EAS channel `development`).

- **Current APK:** HTTPS URL from `yarn scan:inbox:tunnel`
- **Token:** from `.scan-inbox/.receiver.json` (same token across restarts unless that file is deleted)
- Test connection → Connected + receiver version. This only checks `/health`, not upload.
- Capture geometry trace (recognition is not required)

Debug images go only to this configured receiver. A tunneled URL is temporarily on the public internet; the Bearer token is still required.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Tunnel: receiver not reachable | `yarn scan:inbox` is running on port 8787 |
| Tunnel: cloudflared missing | `brew install cloudflared` (not automatic) |
| Test connection Failed on `http://192.168…` | Current APK blocks cleartext. Use `yarn scan:inbox:tunnel` |
| Unauthorized | Token from `.scan-inbox/.receiver.json` / current Pair line |
| unexpected file recognition-attempt-… | Restart `yarn scan:inbox` (reloads allowlist; token stays). Phone → Retry uploads |
| HTTPS health not ready | Wait a few seconds, then Test connection on the phone |
| Pending / last error | Settings → Retry uploads. Local files stay until HTTP 200 |
| Receiver stopped | Uploads stay queued; start the Mac server and Retry |

Optional USB fallback (often still blocked by cleartext):

```text
adb reverse tcp:8787 tcp:8787
```

Then `http://127.0.0.1:8787`. Not the normal current-APK path.

The tunnel is supervised: if cloudflared exits (VPN/network route change), it
retries with backoff and prints a new Pair line when the Quick Tunnel URL
changes. Bearer token / inbox name live in `.scan-inbox/config.json` and are
**not** regenerated on tunnel restart.

Phone Settings → Debug receiver: paste the new Pair line (or bare HTTPS URL).
Saved token/name on the phone are kept; only the endpoint updates.

Current state is written to `.scan-inbox/tunnel.json` (url, status, pid).

### Named Tunnel (optional, stable hostname)

Quick Tunnel URLs are ephemeral after restart. For daily VPN use, configure a
[named Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)
with your own hostname, then:

1. Keep `yarn scan:inbox` running (same persistent token in `config.json`)
2. Point the named tunnel at `http://127.0.0.1:8787`
3. On the phone, set the stable `https://your-hostname` once + same token

`SCAN_INBOX_NAMED_TUNNEL=1 yarn scan:inbox:tunnel` prints guidance only — it does
not invent credentials or domains. Named tunnels require your Cloudflare account.

Do not use ngrok or other public hosts unless you choose to. The supported optional path is Cloudflare quick tunnel via `yarn scan:inbox:tunnel`.

## Android cleartext HTTP

`mobile/app.config.ts` does **not** set `usesCleartextTraffic`. That is unchanged.

- Current APK + LAN HTTP: **blocked**
- Current APK + HTTPS tunnel: intended workaround
- Future development APK may add a development-only network-security config — not in this pass
- Enabling cleartext would require a new APK / fingerprint — do not start EAS for that here

## Privacy

Explicit debug mode. No analytics. No third-party upload except the optional Cloudflare quick tunnel you start yourself. Queue never runs in production UI. Tunnel URL may be written to local gitignored `.scan-inbox/tunnel.json` for operator convenience; bearer token is not printed into permanent logs by the supervisor.
