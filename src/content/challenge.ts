// Cloudflare's bot check. When Cardmarket puts one up, the document we're
// injected into isn't the site at all — it's Cloudflare's interstitial
// ("Performing security verification") with a Turnstile checkbox. There's
// nothing to scrape and nothing we can automate, so the overlay takes itself off
// the page while it's there: it can't cover the checkbox, and it can't run
// anything (queued scans included) against a site that's currently refusing us.
//
// Passing the check loads the real page, which re-injects the content script — so
// the overlay comes back on its own.

/**
 * Ids from Cloudflare's older challenge markup. Present server-side when they're
 * there at all.
 *
 * Note `challenge-error-text` is NOT among them: it only exists inside the
 * page's <noscript>, and a browser with scripting on keeps that as raw text, so
 * it can never be found by a query.
 */
const CHALLENGE_IDS = ['challenge-form', 'challenge-running', 'challenge-stage'];

/**
 * The interstitial's own orchestrator script, in the page's HTML from the start.
 * The path matters: ordinary Cloudflare-protected pages also pull a script from
 * /cdn-cgi/challenge-platform/ (bot telemetry, under /scripts/jsd/), and keying
 * off that alone would hide the overlay across the whole site.
 */
const CHALLENGE_SCRIPT = 'script[src*="/cdn-cgi/challenge-platform/"][src*="chl_page"]';

/**
 * The Turnstile widget. Injected by script a moment after load, and a site can
 * also embed Turnstile in its own forms — so this only counts alongside the stub
 * check below.
 */
const TURNSTILE = 'input[name="cf-turnstile-response"], [id^="cf-chl-widget-"]';

/**
 * Cloudflare's page is a stub: a heading, a checkbox and a spinner. Real
 * Cardmarket pages run into the hundreds of elements, so pairing this with a
 * Turnstile sighting tells an interstitial apart from, say, a login form that
 * happens to use a captcha.
 */
const STUB_ELEMENT_LIMIT = 80;

const isStubDocument = (): boolean =>
  (document.body?.querySelectorAll('*').length ?? 0) < STUB_ELEMENT_LIMIT;

/** Whether the page we're on is a Cloudflare bot check rather than the site. */
export const isSecurityChallenge = (): boolean => {
  // Cheap checks first: on a normal page none of these match and we never pay
  // for counting the document's elements.
  const marked =
    CHALLENGE_IDS.some(id => document.getElementById(id) != null) ||
    document.querySelector(CHALLENGE_SCRIPT) != null ||
    document.querySelector(TURNSTILE) != null;
  return marked && isStubDocument();
};
