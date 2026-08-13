// Cloudflare's bot check, as it reaches us from a request rather than from the
// page. `challenge.ts` handles the other half: the page we're *on* being the
// interstitial, where the overlay takes itself off screen until it's cleared.
//
// A run can be refused while the page we're standing on is still the site: the
// tab looks fine, nothing is visibly wrong, and the task stops with a line about
// human verification the user has no way to act on. Reloading turns it into
// something they can act on — Cloudflare serves the checkbox, they click it, the
// clearance cookie lands, and the interrupted task carries on from its
// checkpoint when the real page brings the overlay back.

const KEY = 'lugin:verify';

/**
 * How long a reload is given to lead somewhere before we'd consider another.
 * Long enough to read a checkbox and click it: reloading under the user while
 * they're solving one would take the check away and start over.
 */
const QUIET_MS = 45_000;

/** Reloads before we stop and say so. Two is enough to rule out a fluke. */
const MAX_RELOADS = 2;

interface VerifyState {
  at: number;
  reason: string;
  reloads: number;
}

/** What to tell someone when reloading hasn't cleared it. */
export const VERIFY_HELP =
  'Cardmarket is asking to verify you’re human. Clear the check on the page, then retry.';

/** Was this failure Cloudflare asking for a human, rather than something we did? */
export const needsVerification = (message: string): boolean => /^CHALLENGE:/.test(message);

const read = async (): Promise<VerifyState | undefined> =>
  (await chrome.storage.local.get(KEY))[KEY] as VerifyState | undefined;

/**
 * Put the check in front of the user by reloading into it.
 *
 * Returns false when a reload isn't the answer — one is already in flight, or
 * two have been and it's still asking — and the caller should surface
 * {@link VERIFY_HELP} instead of trying again.
 */
export const askForVerification = async (reason: string): Promise<boolean> => {
  const state = await read();
  if (state && Date.now() - state.at < QUIET_MS) return false;

  const reloads = (state?.reloads ?? 0) + 1;
  if (reloads > MAX_RELOADS) return false;

  await chrome.storage.local.set({ [KEY]: { at: Date.now(), reason, reloads } });
  console.debug(`[Lugin] ${reason} — reloading so the check can be solved`);
  location.reload();
  return true;
};

/**
 * Forget the reload history, on reaching a page that isn't a check.
 *
 * Whatever it took to get here worked, so the next challenge starts from a clean
 * count rather than inheriting one from an hour ago.
 */
export const verificationCleared = async (): Promise<void> => {
  if (!(await read())) return;
  await chrome.storage.local.remove(KEY);
};
