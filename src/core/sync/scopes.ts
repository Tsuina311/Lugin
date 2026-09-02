// Google Drive OAuth scopes used by Lugin.
//
// Collection sync stays in the hidden `appDataFolder` (`drive.appdata`).
// Scanner development samples need a *visible* folder so testers can find and
// share them — that requires `drive.file` (files this app creates only).

/** Hidden app-data folder for collection / deck sync. */
export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

/**
 * Create and manage files/folders the app creates in the user's My Drive.
 * Used for `Lugin / Scanner Corpus` only — not a blanket Drive read.
 */
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** Space-separated scope string for OAuth token requests. */
export const DRIVE_SCOPES = `${DRIVE_APPDATA_SCOPE} ${DRIVE_FILE_SCOPE}`;
