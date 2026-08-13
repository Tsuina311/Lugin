// How the sync core asks for permission to talk to the user's storage.
//
// An access token and nothing more. Which OAuth dance produced it — Chrome's
// `launchWebAuthFlow` today, a phone's system browser later — is the platform's
// business, and keeping that out of here is what lets the Drive client below be
// shared between them.

/** Why an authorisation attempt didn't produce a token. */
export type AuthFailure =
  /** The user closed the window or refused. */
  | 'cancelled'
  /** No client id was configured for this build. */
  | 'not-configured'
  /** Nobody is signed in, and we weren't allowed to ask. */
  | 'no-session'
  /** The provider refused: revoked grant, expired consent, wrong scope. */
  | 'refused';

export class AuthError extends Error {
  constructor(
    readonly failure: AuthFailure,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface TokenRequest {
  /**
   * Whether a window may be opened. False is the normal case — a token is
   * renewed silently — and true only when the user just asked for this.
   */
  interactive?: boolean;
  /** Ignore any cached token: the last one was rejected. */
  refresh?: boolean;
}

export interface TokenProvider {
  getToken(request?: TokenRequest): Promise<string>;
}
