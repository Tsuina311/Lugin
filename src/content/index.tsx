import React from 'react';

import { createRoot, type Root } from 'react-dom/client';

import { callStore } from './callStore';
import { cartStore } from './cartStore';
import { isSecurityChallenge } from './challenge';
import { startExtraction } from './extractionRunner';
import { startSync } from './syncStore';
import { verificationCleared } from './verify';

import { isInterceptorEnvelope } from '@/lib/messaging';
import { adoptRenamedPageKeys } from '@/lib/renamedKeys';
import { watchLocalChanges } from '@/platform/chrome/localRepository';
import { App } from '@/ui/App';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
// `?inline` gives us the compiled CSS as a string so we can inject it into the
// shadow root instead of the host page's <head>. This keeps the overlay's
// styles fully isolated from the site (and the site's styles away from us).
import overlayCss from '@/ui/index.css?inline';

// Before anything renders: the overlay decides its theme, side and width from
// these while it first paints, so the copy has to already be done by then.
adoptRenamedPageKeys();

const HOST_ID = 'lugin-overlay-host';

/**
 * Sample the host page's typography and theme tokens (Cardmarket is Bootstrap-
 * based, so it exposes `--bs-*` variables) and expose them as `--lugin-*` custom
 * properties on the overlay root. The font is applied to both themes; the color
 * tokens are only consumed by the "site" theme (see index.css). Reading the
 * live page's computed styles is something only a content script can do.
 */
const adoptSiteStyles = (root: HTMLElement) => {
  try {
    const body = getComputedStyle(document.body);
    const doc = getComputedStyle(document.documentElement);
    const bs = (name: string) => doc.getPropertyValue(name).trim();

    // Typography — matched in every theme so text feels native.
    if (body.fontFamily) root.style.setProperty('--lugin-font', body.fontFamily);
    root.style.fontFamily = body.fontFamily || 'inherit';

    const set = (cssVar: string, value: string) => {
      if (value) root.style.setProperty(cssVar, value);
    };
    // A see-through background would let the page bleed through the panel.
    const opaque = (c: string) =>
      c && !/^transparent$/i.test(c) && !/rgba?\(\s*0,\s*0,\s*0,\s*0\s*\)/i.test(c) ? c : '';

    // Surfaces & text (prefer Bootstrap vars, fall back to computed body).
    set('--lugin-bg', bs('--bs-body-bg') || opaque(body.backgroundColor) || '#ffffff');
    set('--lugin-surface-2', bs('--bs-tertiary-bg') || bs('--bs-secondary-bg') || '#f1f3f5');
    set('--lugin-surface-3', bs('--bs-secondary-bg') || '#ced4da');
    set('--lugin-text', bs('--bs-body-color') || body.color);
    set('--lugin-muted', bs('--bs-secondary-color') || '#6c757d');
    set('--lugin-border', bs('--bs-border-color') || '#dee2e6');
    set('--lugin-radius', bs('--bs-border-radius') || '0.375rem');
    // Named apart from the semantic `--lugin-accent` token (ui/index.css): the
    // "site" theme points that at this one, the dark theme keeps its own blue.
    set('--lugin-site-accent', bs('--bs-link-color') || bs('--bs-primary') || '#0d6efd');
  } catch {
    // Reading computed styles can't really fail, but never block mount on it.
  }
};

// Kept so the overlay can be torn down again (see `unmountOverlay`).
let root: Root | null = null;

const mountOverlay = () => {
  if (document.getElementById(HOST_ID)) return;

  // A single host element on the page; everything else lives in its shadow DOM.
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.all = 'initial';
  host.style.position = 'fixed';
  host.style.zIndex = '2147483647'; // max — sit above the site's own UI.
  host.style.top = '0';
  host.style.right = '0';
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = overlayCss;
  shadow.appendChild(style);

  const mountPoint = document.createElement('div');
  mountPoint.className = 'lugin-root';
  shadow.appendChild(mountPoint);

  // Borrow the host site's typography (and accent color, if it exposes one) so
  // the overlay feels native. We keep our own dark palette for legibility, but
  // matching the typeface + accent goes a long way. Read from the live page —
  // something only an extension content script can do.
  adoptSiteStyles(mountPoint);

  try {
    root = createRoot(mountPoint);
    root.render(
      <React.StrictMode>
        <ErrorBoundary label="Lugin overlay">
          <App />
        </ErrorBoundary>
      </React.StrictMode>,
    );
  } catch (err) {
    // A hard failure at mount shouldn't leave a dead host lingering — drop it so
    // the remount watcher can try again on the next DOM change.
    console.error('[Lugin] overlay mount failed:', err);
    root = null;
    host.remove();
  }
};

/** Take the overlay off the page entirely, React tree and host element both. */
const unmountOverlay = () => {
  const host = document.getElementById(HOST_ID);
  if (!host && !root) return;
  root?.unmount();
  root = null;
  host?.remove();
};

let extractionStarted = false;

// Note when the user's own data changes, from the moment the page loads. This
// only keeps timestamps — it sends nothing anywhere — but it has to be running
// before the account is connected, or the first sync would have no idea which
// side's edits are the newer ones.
watchLocalChanges();

// Catch up with the user's other devices, if they've connected one. Inert until
// then: no account, no network, no timers.
startSync();

/**
 * Keep the overlay in step with the page: present on the site, and gone while
 * Cloudflare's bot check is up so it can't cover the checkbox (nor keep scanning
 * a site that's currently refusing us). Passing the check loads a fresh page,
 * which brings the overlay back on its own.
 */
const syncOverlay = () => {
  if (isSecurityChallenge()) {
    unmountOverlay();
    return;
  }
  mountOverlay();
  if (!extractionStarted) {
    extractionStarted = true;
    // Begin scraping structured data from the rendered DOM (SSR-friendly path).
    startExtraction();
    // We're on the site, so whatever check stood in the way is behind us.
    void verificationCleared();
  }
};

// Bridge: MAIN-world interceptor -> content script store.
window.addEventListener('message', event => {
  if (event.source !== window) return;
  if (!isInterceptorEnvelope(event.data)) return;
  const { payload } = event.data;
  if (payload.kind === 'call:start') callStore.start(payload.call);
  else if (payload.kind === 'call:end') {
    callStore.end(payload.call);
    // Keep the cart mirror in sync when the site (or a replayed add) mutates the
    // cart — runs here in the content script, so it works even while hidden.
    cartStore.noteCall(payload.call);
  }
});

// Toolbar icon toggles the overlay's visibility via the background worker.
// Guard the listener registration — after the extension is reloaded/updated the
// old content script is orphaned and `chrome.runtime` throws when touched.
try {
  chrome.runtime.onMessage.addListener((message: { kind?: string }) => {
    if (message?.kind === 'overlay:toggle') {
      window.dispatchEvent(new CustomEvent('lugin:toggle'));
    }
  });
} catch {
  // Orphaned content script (context invalidated) — nothing to bind to.
}

// When the extension is reloaded/updated, an already-loaded content script is
// orphaned and every chrome.* call rejects with "Extension context
// invalidated". Swallow that specific noise so it doesn't surface as an uncaught
// error (a page refresh reconnects); let everything else propagate normally.
const isContextInvalidated = (v: unknown) =>
  /Extension context invalidated|message port closed|context invalidated/i.test(
    (v as { message?: string })?.message ?? String(v ?? ''),
  );
window.addEventListener('unhandledrejection', e => {
  if (isContextInvalidated(e.reason)) e.preventDefault();
});

syncOverlay();

// Safety net: if a navigation or a page script ever removes our host, put it
// back — and if the page turns into a bot check, stand down. Watching <html>'s
// direct children is cheap (it fires only on head/body level changes), and
// syncOverlay no-ops while the overlay already matches the page.
try {
  new MutationObserver(syncOverlay).observe(document.documentElement, { childList: true });
} catch {
  // MutationObserver is always available in-page; ignore if somehow not.
}

// Cloudflare injects its checkbox a moment after the document is ready, so give
// the bot check a second look once everything has loaded.
window.addEventListener('load', syncOverlay);
