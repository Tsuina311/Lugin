// Redirect Google will actually call for an Android OAuth client.
//
// A Web client rejects custom schemes. `lugin://oauth` is also invalid here:
// Google requires the scheme to contain a period. The Android client, once
// custom URI schemes are enabled, redirects to the reversed client id.

const SUFFIX = '.apps.googleusercontent.com';

export const googleAndroidRedirect = (
  clientId: string,
): { redirectUri: string; scheme: string } | null => {
  const id = clientId.trim();
  if (!id.endsWith(SUFFIX)) return null;
  const prefix = id.slice(0, -SUFFIX.length);
  if (!prefix || /[^A-Za-z0-9-]/.test(prefix)) return null;
  const scheme = `com.googleusercontent.apps.${prefix}`;
  return { redirectUri: `${scheme}:/oauth2redirect`, scheme };
};
