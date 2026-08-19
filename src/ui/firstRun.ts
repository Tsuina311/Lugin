// Whether to greet someone, decided in one place.
//
// Extracted from the overlay shell because getting it wrong is invisible in
// development and obnoxious in use: every store here loads asynchronously from
// chrome.storage, so "this user has nothing" and "we have not looked yet" are the
// same shape. Reading them as the same thing would show a welcome screen to
// everyone, on every page load, for as long as storage took to answer.
//
// No DOM, no stores — just the question, so it can be tested.

export interface FirstRunInput {
  /** A collection has been imported. */
  collection: boolean;
  /** Every store has finished its initial read from storage. */
  hydrated: boolean;
  /** Purchase history has been synced. */
  purchases: boolean;
  /** Want lists have been synced. */
  wants: boolean;
  /** The welcome has already been answered — proceeded through, or skipped. */
  welcomed: boolean;
}

/**
 * `true` to show the welcome, `false` to show the app, `null` while it cannot be
 * known yet.
 *
 * The caller is expected to decide once and hold the answer: recomputing it as
 * data arrives would tear the screen away the moment the first sync landed, which
 * is precisely when the user is watching it.
 */
export const shouldWelcome = (input: FirstRunInput): boolean | null => {
  if (!input.hydrated) return null;
  if (input.welcomed) return false;
  // An imported collection counts as data. Someone who has already spent an
  // afternoon uploading one has met the app; greeting them would be absurd.
  return !input.wants && !input.purchases && !input.collection;
};
