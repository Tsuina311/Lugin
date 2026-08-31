// Telling "Cloudflare wants a human" apart from "the site answered fine".
//
// It matters which one it is, because a challenge is handed to the user as
// "clear the check on the page, then retry" (see content/verify.ts). Say that
// about a page that loaded normally and the advice is nonsense — there's no check
// on screen to clear.
//
// The trap is `/cdn-cgi/challenge-platform/…`: Cloudflare injects that script
// into *ordinary* 200 pages as bot management, so its presence means the site
// sits behind Cloudflare, not that we were stopped by it. Only the interstitial's
// own markers, or a body carrying nothing of the site at all, mean stopped.

/** Markers that only ever appear on Cloudflare's own interstitial or block page. */
const CHALLENGE_ONLY =
  /just a moment|attention required|checking if the site connection is secure|cf-chl-|_cf_chl_opt|challenge-error-text/i;

/** Cloudflare's bot-management script, which pages that loaded fine carry too. */
const CHALLENGE_PLATFORM = /cdn-cgi\/challenge-platform/i;

/** Something only Cardmarket's own markup carries. */
const SITE_CONTENT = /__cmtkn|data-component-name|\/Magic\/(Users|Products|Cards|Wants|Expansions)/i;

/**
 * Whether a response body is the check rather than the page.
 *
 * The interstitial replaces the reply it stands in for, so it has none of the
 * site's markup — that absence is what makes the weaker marker trustworthy.
 */
export const looksLikeChallenge = (body: string): boolean =>
  CHALLENGE_ONLY.test(body) || (CHALLENGE_PLATFORM.test(body) && !SITE_CONTENT.test(body));

/**
 * HTTP 403, or a body that is Cloudflare's check rather than the site.
 *
 * A 200 that carries the site's markup is the site, whatever scripts Cloudflare
 * added to it.
 */
export const isChallengeResponse = (status: number, body: string): boolean =>
  status === 403 || looksLikeChallenge(body);
