// Entry point for Lugin Web.
//
// The stylesheet is the overlay's, reused: its `:host` rule is inert outside a
// shadow root, and every design token it defines hangs off `.lugin-root` — so
// wrapping the app in that class is all it takes to get the same dark palette
// here. One theme, one place to change it.

import { createRoot } from 'react-dom/client';

import { App } from './App';
import { WEB_UPDATE_EVENT } from './pwa';

import { loadBracketLists } from '@/lib/bracket';
import { ensureComboIndex } from '@/lib/combos/load';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
// As a stylesheet, where the extension imports this same file with `?inline`: a
// shadow root needs the text to inject, a page just needs the <style> tag.
import '@/ui/index.css';

const mount = document.getElementById('root');
if (!mount) throw new Error('index.html is missing #root');

mount.classList.add('lugin-root');
loadBracketLists();
void ensureComboIndex();

createRoot(mount).render(
  <ErrorBoundary label="Lugin">
    <App />
  </ErrorBoundary>,
);

// The worker earns installability — "Add to Home Screen" gives a real standalone
// app rather than a bookmark once one is registered — but it also owns updates and
// the share sheet's inbox, so what it caches it caches as a fallback for no
// signal, never as the thing it serves first.
//
// `updateViaCache: 'none'` for the same reason the worker revalidates the page:
// GitHub Pages sends max-age=600 on sw.js too, and the browser would honour that
// when checking for a new worker. A ten-minute-old copy deciding whether there is
// a new version is the update check answering from the thing it is checking.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, {
        updateViaCache: 'none',
      })
      .then(registration => {
        const hadController = Boolean(navigator.serviceWorker.controller);
        let announced = false;
        const announce = () => {
          if (announced) return;
          announced = true;
          window.dispatchEvent(new Event(WEB_UPDATE_EVENT));
        };
        const watch = (worker: ServiceWorker | null) => {
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'activated' && hadController) announce();
          });
        };
        registration.addEventListener('updatefound', () => watch(registration.installing));

        // iOS may suspend the page for days. Re-check when it becomes visible
        // instead of waiting for Safari's next periodic worker check.
        const recheck = () => {
          if (document.visibilityState === 'visible') void registration.update();
        };
        document.addEventListener('visibilitychange', recheck);
        window.addEventListener('focus', recheck);
      });
  });
}
