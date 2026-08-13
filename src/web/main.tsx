// Entry point for the phone build.
//
// The stylesheet is the overlay's, reused: its `:host` rule is inert outside a
// shadow root, and every design token it defines hangs off `.lugin-root` — so
// wrapping the app in that class is all it takes to get the same dark palette
// here. One theme, one place to change it.

import { createRoot } from 'react-dom/client';

import { App } from './App';

import { ErrorBoundary } from '@/ui/ErrorBoundary';
// As a stylesheet, where the extension imports this same file with `?inline`: a
// shadow root needs the text to inject, a page just needs the <style> tag.
import '@/ui/index.css';

const mount = document.getElementById('root');
if (!mount) throw new Error('index.html is missing #root');

mount.classList.add('lugin-root');

createRoot(mount).render(
  <ErrorBoundary label="Lugin">
    <App />
  </ErrorBoundary>,
);

// Only for installability — "Add to Home Screen" gives a real standalone app
// rather than a bookmark once a service worker is in play. It deliberately does
// not cache the app shell: a stale build during testing is a worse problem than
// a blank screen with no signal.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  });
}
