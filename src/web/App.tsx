// The phone app's shell.
//
// Mobile-first and deliberately not the overlay. The extension's panel is a
// dense desktop instrument sitting in a shadow root beside a Cardmarket page;
// this is a small screen with a thumb on it, so it gets its own layout and
// reuses the parts that carry no presentation — the sync core, the collection and
// deck models, and the import review.
//
// It renders the *local* copy, not a fetch. So the collection is there before any
// network call, an import can be made in a shop with no signal, and "synced" is a
// separate claim from "loaded" — which is why the header states the two
// separately rather than conflating them into a spinner.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { CollectionView } from './CollectionView';
import { DeckList } from './DeckList';
import { ImportScreen } from './ImportScreen';
import { ScanScreen } from './ScanScreen';
import { takeSharedImport, type SharedImport } from './sharedImport';
import { syncStore } from './syncStore';

import type { DomainKey } from '@/core/sync/model';
import { buildCollection } from '@/lib/collection';

type Tab = 'collection' | 'decks' | 'import' | 'scan';

const asset = (path: string): string => `${import.meta.env.BASE_URL}${path}`;

/** "3 minutes ago" beats an ISO stamp for answering "did my desktop push yet". */
const ago = (iso: string): string => {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 90) return 'just now';
  const scales = [
    { label: 'minute', size: 60 },
    { label: 'hour', size: 3600 },
    { label: 'day', size: 86_400 },
  ];
  let chosen = scales[0];
  for (const scale of scales) if (seconds >= scale.size) chosen = scale;
  const count = Math.round(seconds / chosen.size);
  return `${count} ${chosen.label}${count === 1 ? '' : 's'} ago`;
};

/** The domains, said in the words the app uses elsewhere rather than its own. */
const DOMAIN_NAMES: Record<DomainKey, string> = {
  collection: 'collection',
  decks: 'decks',
  preferences: 'settings',
  printings: 'card images',
};

const list = (items: string[]): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/**
 * Which build this is, shown rather than hidden behind a gesture.
 *
 * The service worker serves the page network-first, so a reload after a deploy
 * *usually* brings the new code — but "usually" is no good when the next question
 * is whether a fix is live. This is the version and the commit, on screen, so that
 * question is answered by looking.
 */
const BUILD: string = import.meta.env.VITE_LUGIN_BUILD ?? 'dev';

const Splash = ({
  action,
  children,
  title,
}: {
  action?: { label: string; onClick: () => void };
  children: React.ReactNode;
  title: string;
}) => (
  <div className="flex min-h-full flex-col items-center justify-center gap-5 px-8 text-center">
    <img alt="Lugin" className="h-9 w-auto opacity-90" src={asset('icons/logo-dark.png')} />
    <h1 className="text-lg font-semibold text-ink">{title}</h1>
    <p className="max-w-xs text-sm leading-relaxed text-ink-muted">{children}</p>
    {action ? (
      <button
        className="mt-1 rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-accent-ink active:bg-accent-strong"
        onClick={action.onClick}
        type="button"
      >
        {action.label}
      </button>
    ) : null}
    <span className="text-[10px] text-ink-faint opacity-70">{BUILD}</span>
  </div>
);

export const App = () => {
  const { conflicted, data, error, pending, persistent, status, syncedAt } = useSyncExternalStore(
    syncStore.subscribe,
    syncStore.getSnapshot,
    syncStore.getSnapshot,
  );
  const [tab, setTab] = useState<Tab>('collection');
  const [shared, setShared] = useState<SharedImport | null>(null);

  // Was this launch a ManaBox export being shared to us? Held in state rather
  // than left where it was found, because the inbox is emptied on reading — so a
  // share that arrives on a phone which still has to sign in waits here, in
  // memory, and opens as soon as the app is past that.
  useEffect(() => {
    void takeSharedImport().then(file => {
      if (!file) return;
      setShared(file);
      setTab('import');
    });
  }, []);

  // `byKey` isn't stored — the desktop rebuilds it on load and so do we. It's
  // what turns 20,000 rows into "how many of this card do I own".
  const collection = useMemo(() => {
    const stored = data?.collection.value;
    return stored ? buildCollection(stored.cards, stored.source, stored.format, stored.importedAt) : null;
  }, [data]);

  if (status === 'not-configured') {
    return (
      <Splash title="Not configured">
        This build has no Google client id, so it can’t reach your Drive. See
        <code className="px-1 text-ink-faint">.env.example</code>.
      </Splash>
    );
  }

  const decks = data?.decks.value ?? [];
  const empty = !collection && decks.length === 0;

  // Only a device holding nothing of its own is stopped at the door, and only
  // while it can't sync. Once there is local data the app is fully usable signed
  // out — being in a shop with no signal mustn't put the cards behind a login.
  //
  // The gate is doing real work in the empty case, though, and not just tidiness:
  // a brand-new phone that imported before it had ever pulled would hold a
  // collection stamped later than the desktop's, with no shared base to tell them
  // apart — so its scan would win, and the desktop's collection would only survive
  // as a conflict copy. One successful sync first makes that a proper per-domain
  // merge instead.
  if (empty) {
    if (status === 'busy') return <Splash title="Loading">Reading your Drive folder…</Splash>;
    if (status === 'error') {
      return (
        <Splash action={{ label: 'Try again', onClick: syncStore.syncNow }} title="That didn’t work">
          {error}
        </Splash>
      );
    }
    if (status === 'disconnected') {
      return (
        <Splash
          action={{ label: 'Connect Google', onClick: syncStore.connect }}
          title="Lugin on your phone"
        >
          {shared
            ? `${shared.name} is ready to import — sign in first, so this phone starts from what
               your desktop already has rather than replacing it.`
            : `Sign in to pick up the collection and decks from your desktop — and to import ManaBox
               scans from here. Lugin only ever sees its own hidden folder in your Drive, nothing
               else there.`}
        </Splash>
      );
    }
    // Signed in, synced, and genuinely empty: that's a first import waiting to
    // happen, so fall through to the app rather than to a dead end.
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-panel px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <img alt="Lugin" className="h-5 w-auto" src={asset('icons/logo-dark.png')} />
        <div className="ml-auto flex items-center gap-3">
          <span className="flex flex-col items-end leading-tight">
            <span className="text-[11px] text-ink-faint">
              {status === 'busy'
                ? 'syncing…'
                : status === 'disconnected'
                  ? 'not signed in'
                  : pending
                    ? 'changes to upload'
                    : syncedAt
                      ? `synced ${ago(syncedAt)}`
                      : 'on this phone'}
            </span>
            <span className="text-[10px] text-ink-faint opacity-70">{BUILD}</span>
          </span>
          <button
            className="rounded-md bg-raised px-3 py-1.5 text-xs font-medium text-ink-muted disabled:opacity-50"
            disabled={status === 'busy'}
            onClick={status === 'disconnected' ? syncStore.connect : syncStore.syncNow}
            type="button"
          >
            {status === 'busy' ? '…' : status === 'disconnected' ? 'Sign in' : 'Sync'}
          </button>
        </div>
      </header>

      {/* Failures are a strip, not a screen: they must not hide the cards, and on
          a phone they're usually "no signal" rather than anything to act on. */}
      {status === 'error' && error ? (
        <p className="border-b border-line bg-neg-soft px-4 py-2 text-xs text-neg">{error}</p>
      ) : null}

      {conflicted.length > 0 ? (
        <p className="border-b border-line bg-warn-soft px-4 py-2 text-xs text-warn">
          Your {list(conflicted.map(d => DOMAIN_NAMES[d]))} changed on both devices. The newer
          version is showing, and a copy of the other is kept in the Drive folder.
        </p>
      ) : null}

      {!persistent ? (
        <p className="border-b border-line bg-warn-soft px-4 py-2 text-xs text-warn">
          This browser won’t let the app store anything, so what you import will only last until you
          close the tab. Sync before you do.
        </p>
      ) : null}

      <main
        className={`min-h-0 flex-1 ${
          tab === 'scan'
            ? 'flex flex-col overflow-hidden'
            : 'overflow-y-auto overscroll-contain'
        }`}
      >
        {tab === 'collection' ? <CollectionView collection={collection} /> : null}
        {tab === 'decks' ? <DeckList collection={collection} decks={decks} /> : null}
        {tab === 'scan' ? (
          <ScanScreen
            onAdd={async card => {
              await syncStore.addCards([card]);
            }}
          />
        ) : null}
        {tab === 'import' ? (
          <ImportScreen
            // Remount for each new share, so its file becomes the screen's
            // starting state without an effect reaching in to replace it.
            key={shared ? `shared-${shared.at}` : 'picker'}
            existing={collection?.cards ?? []}
            incoming={shared}
            onImport={async (decisions, file) => {
              await syncStore.importDecisions(decisions, file);
              setShared(null);
              // Land on what changed. "Choose a file" reappearing is the one
              // outcome that leaves someone unsure whether it worked.
              setTab(decisions.every(d => d.kind === 'deck') ? 'decks' : 'collection');
            }}
          />
        ) : null}
      </main>

      <nav className="flex border-t border-line bg-panel pb-[env(safe-area-inset-bottom)]">
        {(
          [
            ['collection', 'Collection', collection?.uniqueCards ?? 0],
            ['decks', 'Decks', decks.length],
            ['scan', 'Scan', null],
            ['import', 'Import', null],
          ] as const
        ).map(([id, label, count]) => (
          <button
            key={id}
            className={`flex-1 py-3 text-sm font-medium ${
              tab === id ? 'text-accent' : 'text-ink-faint'
            }`}
            onClick={() => setTab(id)}
            type="button"
          >
            {label}
            {count === null ? null : (
              <span className="ml-1.5 text-[11px] tabular-nums opacity-70">{count}</span>
            )}
          </button>
        ))}
        <button
          className="px-4 py-3 text-xs font-medium text-ink-faint"
          onClick={syncStore.disconnect}
          type="button"
        >
          Sign out
        </button>
      </nav>
    </div>
  );
};
