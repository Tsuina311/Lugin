import { useEffect, useState } from 'react';

import { PRODUCT_NAMES } from '@/core/mobile/capabilities';

const INSTALL_DISMISS_KEY = 'lugin:webInstallDismissedAt';
const INSTALL_DISMISS_MS = 30 * 24 * 60 * 60 * 1000;

export const WEB_UPDATE_EVENT = 'lugin:web-update-ready';

const standalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches ||
  Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

const iosSafari = (): boolean => {
  const ua = navigator.userAgent;
  const ios =
    /iPhone|iPad|iPod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const safari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/i.test(ua);
  return ios && safari;
};

const installDismissed = (): boolean => {
  try {
    const at = Number(localStorage.getItem(INSTALL_DISMISS_KEY));
    return Number.isFinite(at) && Date.now() - at < INSTALL_DISMISS_MS;
  } catch {
    return false;
  }
};

export const InstallLugin = () => {
  const [visible, setVisible] = useState(() => iosSafari() && !standalone() && !installDismissed());
  const [instructions, setInstructions] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(display-mode: standalone)');
    const hideInstalled = () => {
      if (standalone()) setVisible(false);
    };
    media.addEventListener?.('change', hideInstalled);
    return () => media.removeEventListener?.('change', hideInstalled);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
    } catch {
      // A private tab may not persist dismissal; closing still works now.
    }
    setInstructions(false);
    setVisible(false);
  };

  return (
    <>
      <aside className="border-b border-accent/30 bg-accent-soft px-4 py-2.5 text-xs text-ink">
        <div className="mx-auto flex max-w-lg items-center gap-3">
          <span className="min-w-0 flex-1">
            <strong className="block text-[11px] uppercase tracking-wide text-accent">
              Install {PRODUCT_NAMES.web}
            </strong>
            <span className="text-ink-muted">
              Add Lugin to your Home Screen for an app-like experience.
            </span>
          </span>
          <button
            className="shrink-0 rounded-md bg-accent px-3 py-2 font-semibold text-accent-ink"
            onClick={() => setInstructions(true)}
            type="button"
          >
            How to install
          </button>
          <button
            aria-label="Dismiss install message"
            className="h-8 w-8 shrink-0 rounded-md text-lg text-ink-faint"
            onClick={dismiss}
            type="button"
          >
            ×
          </button>
        </div>
      </aside>
      {instructions ? (
        <div
          aria-label={`Install ${PRODUCT_NAMES.web}`}
          aria-modal="true"
          className="fixed inset-0 z-[100] flex items-end bg-black/70 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          role="dialog"
        >
          <div className="mx-auto w-full max-w-md rounded-2xl border border-line-strong bg-panel p-5 shadow-pop">
            <h2 className="text-base font-semibold text-ink">Install {PRODUCT_NAMES.web}</h2>
            <ol className="mt-4 space-y-3 text-sm text-ink-muted">
              <li>
                <strong className="text-ink">1.</strong> Open this page in Safari.
              </li>
              <li>
                <strong className="text-ink">2.</strong> Tap Safari’s Share button.
              </li>
              <li>
                <strong className="text-ink">3.</strong> Choose “Add to Home Screen”.
              </li>
              <li>
                <strong className="text-ink">4.</strong> Tap “Add”.
              </li>
            </ol>
            <p className="mt-4 text-xs leading-relaxed text-ink-faint">
              Apple does not allow websites to open this install dialog automatically.
            </p>
            <button
              className="mt-5 w-full rounded-lg bg-accent py-3 text-sm font-semibold text-accent-ink"
              onClick={dismiss}
              type="button"
            >
              Got it
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
};

export const WebUpdateNotice = () => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const show = () => setReady(true);
    window.addEventListener(WEB_UPDATE_EVENT, show);
    return () => window.removeEventListener(WEB_UPDATE_EVENT, show);
  }, []);

  if (!ready) return null;
  return (
    <aside className="flex items-center gap-3 border-b border-line bg-pos-soft px-4 py-2 text-xs text-pos">
      <span className="min-w-0 flex-1">Lugin Web has been updated.</span>
      <button
        className="rounded-md bg-raised px-3 py-1.5 font-semibold text-ink"
        onClick={() => window.location.reload()}
        type="button"
      >
        Reload
      </button>
    </aside>
  );
};
