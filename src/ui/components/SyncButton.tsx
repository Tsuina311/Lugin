import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { Button } from './Button';
import { IconButton } from './IconButton';
import { Cloud, CloudOff, Loader2, RefreshCw } from './icons';

import { syncStore } from '@/content/syncStore';

// The whole of the sync UI: one header icon that says whether anything is
// syncing, and a small panel behind it.
//
// It's deliberately this small. Syncing is either working or it isn't, and the
// only thing a person ever needs from it is the answer to "is my stuff safe on
// my other device" — plus, before they agree to any of it, a plain sentence
// about what leaves the browser.

const ago = (at: number): string => {
  const seconds = Math.round((Date.now() - at) / 1000);
  if (seconds < 90) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
};

export const SyncButton = () => {
  const state = useSyncExternalStore(syncStore.subscribe, syncStore.getSnapshot);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      // `contains` can't be used here: the overlay is in a shadow root, so by
      // the time the event reaches the document its target has been retargeted
      // to the host element — every click, including one on this very panel,
      // would look like an outside click and close it before it landed.
      const inside = box.current !== null && e.composedPath().includes(box.current);
      if (!inside) setOpen(false);
    };
    document.addEventListener('mousedown', close, true);
    return () => document.removeEventListener('mousedown', close, true);
  }, [open]);

  const label = state.error
    ? `Sync problem — ${state.error}`
    : !state.connected
      ? 'Sync your collection and decks with your Google account'
      : state.busy
        ? 'Syncing…'
        : state.lastSyncedAt
          ? `Synced ${ago(state.lastSyncedAt)}`
          : 'Connected to Google';

  return (
    <div ref={box} className="relative">
      <IconButton
        active={open}
        className={state.busy ? '[&>svg]:animate-spin' : ''}
        icon={state.busy ? Loader2 : state.connected ? Cloud : CloudOff}
        label={label}
        onClick={() => setOpen(o => !o)}
        tone={state.error ? 'danger' : state.connected ? 'accent' : 'default'}
      />

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-64 rounded-md border border-line-strong bg-panel p-2 text-xs shadow-pop">
          {state.connected ? (
            <>
              <div className="font-medium text-ink">Syncing with your Google account</div>
              <p className="mt-1 text-ink-muted">
                {state.busy
                  ? 'Syncing…'
                  : (state.summary ??
                    (state.lastSyncedAt ? `Last synced ${ago(state.lastSyncedAt)}.` : 'Not synced yet.'))}
              </p>
              <div className="mt-2 flex items-center gap-1">
                <Button
                  disabled={state.busy}
                  icon={RefreshCw}
                  onClick={() => void syncStore.syncNow()}
                  size="xs"
                  variant="neutral"
                >
                  Sync now
                </Button>
                <Button
                  className="ml-auto"
                  onClick={() => void syncStore.disconnect()}
                  size="xs"
                  variant="subtle"
                >
                  Disconnect
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="font-medium text-ink">Keep your data on your other devices</div>
              <p className="mt-1 text-ink-muted">
                Your collection, decks, chosen printings and settings are kept in a private folder in
                your Google Drive that only this extension can open. Nothing else is read, and your
                Cardmarket sign-in never leaves this browser.
              </p>
              <Button
                className="mt-2"
                disabled={state.busy}
                icon={Cloud}
                onClick={() => void syncStore.connect()}
                size="xs"
                variant="primary"
              >
                Connect Google account
              </Button>
            </>
          )}

          {state.error && <p className="mt-2 text-2xs text-neg">{state.error}</p>}
        </div>
      )}
    </div>
  );
};
