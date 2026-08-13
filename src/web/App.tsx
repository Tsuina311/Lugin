// The phone app's shell: sign in, then read.
//
// Mobile-first and deliberately not the overlay. The extension's panel is a
// dense desktop instrument sitting in a shadow root beside a Cardmarket page;
// this is a small screen with a thumb on it, so it gets its own layout and
// reuses the parts that carry no presentation — the sync core and the collection
// and deck models.
//
// Read-only, and it says so. Nothing here can write to Drive.

import { useMemo, useState } from 'react';


import { CollectionView } from './CollectionView';
import { DeckList } from './DeckList';
import { useSyncedData } from './useSyncedData';

import { buildCollection } from '@/lib/collection';

type Tab = 'collection' | 'decks';

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
  </div>
);

export const App = () => {
  const { connect, data, disconnect, error, refresh, status, updatedAt } = useSyncedData();
  const [tab, setTab] = useState<Tab>('collection');

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

  if (status === 'disconnected') {
    return (
      <Splash action={{ label: 'Connect Google', onClick: connect }} title="Lugin on your phone">
        Sign in to read the collection and decks your desktop extension synced. Lugin only ever sees
        its own hidden folder in your Drive — nothing else there.
      </Splash>
    );
  }

  if (status === 'error') {
    return (
      <Splash action={{ label: 'Try again', onClick: refresh }} title="That didn’t work">
        {error}
      </Splash>
    );
  }

  if (status === 'empty') {
    return (
      <Splash action={{ label: 'Check again', onClick: refresh }} title="Nothing synced yet">
        Your Drive folder is empty. Open the extension on your desktop and press sync, then check
        again here.
      </Splash>
    );
  }

  if (status === 'busy' && !data) {
    return <Splash title="Loading">Reading your Drive folder…</Splash>;
  }

  const decks = data?.decks.value ?? [];

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-panel px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <img alt="Lugin" className="h-5 w-auto" src={asset('icons/logo-dark.png')} />
        <div className="ml-auto flex items-center gap-3">
          {updatedAt ? (
            <span className="text-[11px] text-ink-faint">synced {ago(updatedAt)}</span>
          ) : null}
          <button
            className="rounded-md bg-raised px-3 py-1.5 text-xs font-medium text-ink-muted disabled:opacity-50"
            disabled={status === 'busy'}
            onClick={refresh}
            type="button"
          >
            {status === 'busy' ? '…' : 'Refresh'}
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {tab === 'collection' ? (
          <CollectionView collection={collection} />
        ) : (
          <DeckList collection={collection} decks={decks} />
        )}
      </main>

      <nav className="flex border-t border-line bg-panel pb-[env(safe-area-inset-bottom)]">
        {(
          [
            ['collection', 'Collection', collection?.uniqueCards ?? 0],
            ['decks', 'Decks', decks.length],
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
            <span className="ml-1.5 text-[11px] tabular-nums opacity-70">{count}</span>
          </button>
        ))}
        <button
          className="px-4 py-3 text-xs font-medium text-ink-faint"
          onClick={disconnect}
          type="button"
        >
          Sign out
        </button>
      </nav>
    </div>
  );
};
