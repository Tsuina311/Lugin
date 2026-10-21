# Native Google sign-in

Lugin Chrome and Lugin Web keep using the **Web** OAuth client
(`VITE_GOOGLE_CLIENT_ID`). The native app does not. A Web client cannot
register a custom scheme, and Google rejects `lugin://oauth` because that
scheme has no period.

The native app uses an **Android** OAuth client and this redirect:

```text
com.googleusercontent.apps.<CLIENT_ID_PREFIX>:/oauth2redirect
```

`<CLIENT_ID_PREFIX>` is the client id with `.apps.googleusercontent.com`
removed. There is no client secret in the app. Scopes stay:

- `https://www.googleapis.com/auth/drive.appdata`
- `https://www.googleapis.com/auth/drive.file`

Tokens are stored with `expo-secure-store` (Android Keystore). A leftover
`lugin-library/google-token.json` is copied into that store and deleted only
after the copy reads back the same value.

The iOS TestFlight app uses a separate **iOS** OAuth client for bundle id
`app.lugin.mobile` and redirect:

```text
com.googleusercontent.apps.<CLIENT_ID_PREFIX>:/oauth2callback
```

Store that public client id in `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`. Tokens use
the iOS Keychain through the same `expo-secure-store` API.

## Google Cloud console

Use the same project as the existing Web client. Drive API already enabled.

1. APIs & Services → Credentials → Create credentials → OAuth client ID.
2. Application type: **Android**. Not Web, and not Desktop.
3. Package name: `app.lugin.mobile`.
4. SHA-1: the certificate EAS uses to sign the development APK.
   From the repo root, after `yarn mobile:eas login`:

   ```bash
   yarn mobile:eas credentials --platform android
   ```

   Open the development build's keystore and copy the SHA-1 fingerprint.
   A debug keystore from a local `expo run:android` is a different certificate.
   The installed EAS APK will not match it.

5. Create the client. Open it → Advanced settings → enable **Custom URI scheme** → Save.
   New Android clients leave this off, and the browser redirect then fails.
6. Copy the Android client id (it ends in `.apps.googleusercontent.com`).

## Where the client id goes

It is public, same as the Web client id. Do not create a client secret.

Local builds read it from `.env.local`:

```bash
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=<the Android client id>
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=<the iOS client id>
```

EAS development builds read it from the EAS environment named `development`
(see `mobile/eas.json`). Set the same variable there before the build that
should be able to sign in. `extra.lugin` is not part of the fingerprint, but
the reversed-client-id scheme is an Android intent filter, so a build made
without the variable cannot receive the redirect. Settings then says
"No Android Google client id in this build".

The app scheme `lugin` stays for other links. Google does not redirect there.
