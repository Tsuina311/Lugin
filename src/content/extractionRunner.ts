import { expansionIconStore } from './expansionIconStore';
import { pageDataStore } from './pageDataStore';

import { adapterForHost } from '@/sites/registry';

// Drives site extraction against the LIVE, already-rendered DOM. This is the
// SSR-friendly path: the data is in the DOM no matter how the server/AJAX
// delivered it. We re-run when the DOM mutates (AJAX filters/pagination) or the
// URL changes (SPA-style navigation), debounced so chatty pages stay cheap.

const DEBOUNCE_MS = 300;

let scheduled: number | undefined;
let lastUrl = location.href;

const runNow = () => {
  const adapter = adapterForHost(location.host);
  if (!adapter) return;
  try {
    const ctx = adapter.detect(location.href, document);
    const result = adapter.extract(ctx, document);
    pageDataStore.set(result);
    // Opportunistically harvest set icons from any page that shows them (the
    // Expansions catalogue, product / offer / order pages) for the collection.
    expansionIconStore.captureFrom(document);
  } catch (err) {
    console.error('[Lugin] extraction failed', err);
  }
};

const schedule = () => {
  if (scheduled != null) clearTimeout(scheduled);
  scheduled = window.setTimeout(runNow, DEBOUNCE_MS);
};

/** Begin observing the page and populate the store. Safe to call once. */
export const startExtraction = () => {
  if (!adapterForHost(location.host)) return;

  runNow();

  const observer = new MutationObserver(() => {
    // Detect SPA/history URL changes cheaply off the mutation stream.
    if (location.href !== lastUrl) lastUrl = location.href;
    schedule();
  });
  observer.observe(document.documentElement, {
    characterData: true,
    childList: true,
    subtree: true,
  });

  // Belt-and-suspenders for history navigations that don't mutate immediately.
  window.addEventListener('popstate', schedule);
};
