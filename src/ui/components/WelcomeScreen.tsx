import { useEffect, useState, useSyncExternalStore } from 'react';

import { Button } from './Button';
import { LuginMark } from './LuginMark';
import { Check, ClipboardList, Library, Loader2, ReceiptEuro } from './icons';

import {
  setAddPurchasesToCollection,
  shouldAddPurchasesToCollection,
} from '@/content/collectionStore';
import { purchaseStore } from '@/content/purchaseStore';
import { taskQueue } from '@/content/taskQueue';
import { wantsStore } from '@/content/wantsStore';

// The first thing a new user sees, in place of the tabs.
//
// Every panel in Lugin is a view *over* two things it reads from Cardmarket: your
// want lists and your order history. Until those are read, every tab is an empty
// box with a button in it, and the buttons that would fill them were behind a
// "Tools" disclosure in the Search tab — so the app's first impression was a set of
// empty rooms, with the light switch in a cupboard.
//
// So this screen exists to do one thing: ask for the two syncs, say plainly why
// each is worth the wait, and get out of the way. It is not a tour, and it does
// not gate anything — Skip leads straight to the app.

/** Roughly how long a first sync takes, so "a while" isn't a mystery. */
const SHAPE = {
  purchases: 'a minute or two, depending on how much you have bought',
  wants: 'usually a few seconds',
};

interface WelcomeScreenProps {
  /** Leave the welcome screen for good — the user skipped, or the syncs finished. */
  onDone: () => void;
}

const Choice = ({
  busy,
  checked,
  children,
  done,
  icon: Icon,
  onChange,
  takes,
  title,
}: {
  busy?: boolean;
  checked: boolean;
  children: React.ReactNode;
  done?: boolean;
  icon: typeof Library;
  onChange: (on: boolean) => void;
  takes: string;
  title: string;
}) => (
  <label
    className={`flex cursor-pointer gap-2.5 rounded-md border p-2.5 transition-colors ${
      checked ? 'border-accent bg-accent-soft' : 'border-line hover:bg-tint'
    }`}
  >
    <input
      checked={checked}
      className="mt-0.5 flex-none"
      disabled={busy || done}
      onChange={e => onChange(e.target.checked)}
      type="checkbox"
    />
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-xs font-medium text-ink">
        <Icon aria-hidden size={13} />
        {title}
        {done && <Check aria-hidden className="text-pos" size={13} />}
        {busy && <Loader2 aria-hidden className="animate-spin text-accent" size={13} />}
      </div>
      <p className="mt-1 text-2xs leading-relaxed text-ink-muted">{children}</p>
      <p className="mt-1 text-2xs text-ink-faint">Takes {takes}.</p>
    </div>
  </label>
);

export const WelcomeScreen = ({ onDone }: WelcomeScreenProps) => {
  const wants = useSyncExternalStore(wantsStore.subscribe, wantsStore.getSnapshot);
  const purchases = useSyncExternalStore(purchaseStore.subscribe, purchaseStore.getSnapshot);

  const [doWants, setDoWants] = useState(true);
  const [doPurchases, setDoPurchases] = useState(true);
  const [toCollection, setToCollection] = useState(shouldAddPurchasesToCollection);
  const [started, setStarted] = useState(false);

  const wantsBusy = wants.status === 'queued' || wants.status === 'syncing';
  const purchasesBusy = purchases.status === 'queued' || purchases.status === 'syncing';
  const busy = wantsBusy || purchasesBusy;

  // A sync we asked for has delivered. Errors count as settled too: a failed sync
  // reports itself in the tab that owns it, and holding someone on a welcome
  // screen to re-read the same message would be a worse place to say it.
  const wantsSettled = !doWants || (!wantsBusy && wants.status !== 'idle');
  const purchasesSettled = !doPurchases || (!purchasesBusy && purchases.status !== 'idle');

  // Hand over once the work we started has settled. The pause is only so the
  // ticks are visible — vanishing the instant the last one lands reads as a crash.
  useEffect(() => {
    if (!started || !wantsSettled || !purchasesSettled) return;
    const t = setTimeout(onDone, 900);
    return () => clearTimeout(t);
  }, [started, wantsSettled, purchasesSettled, onDone]);

  const proceed = () => {
    // Recorded before the purchase sync starts, so the very first pass folds the
    // cards in. Ticking it afterwards would leave the box ticked and the
    // collection empty until another sync ran.
    setAddPurchasesToCollection(toCollection);
    if (doWants) {
      wantsStore.markQueued();
      taskQueue.enqueue('syncWants', 'Sync want lists');
    }
    if (doPurchases) {
      purchaseStore.markQueued();
      taskQueue.enqueue('syncPurchases', 'Sync purchases');
    }
    setStarted(true);
  };

  const progressLine = (): string => {
    if (wantsBusy) {
      return wants.status === 'queued'
        ? 'Want lists — queued…'
        : `Reading want lists… ${wants.progress?.listName ?? ''}`;
    }
    if (purchasesBusy) {
      if (purchases.status === 'queued') return 'Purchases — waiting its turn…';
      const p = purchases.progress;
      return p?.phase === 'orders'
        ? `Reading order ${p.current} of ${p.total}…`
        : 'Looking up your orders…';
    }
    return 'Done.';
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto flex max-w-md flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <LuginMark size={26} variant="color" />
          <div>
            <div className="text-sm font-semibold text-ink">Welcome to Lugin</div>
            <div className="text-2xs text-ink-muted">
              A buying companion for Cardmarket. Let’s get your own data in.
            </div>
          </div>
        </div>

        <p className="text-2xs leading-relaxed text-ink-muted">
          Lugin works from two things Cardmarket already knows about you. Reading them once is what
          turns the panels from empty lists into your want lists, your prices and your history.
          Everything stays on this device — it is your own account, read with your own session.
        </p>

        <Choice
          busy={wantsBusy}
          checked={doWants}
          done={started && !wantsBusy && wants.status === 'done'}
          icon={ClipboardList}
          onChange={setDoWants}
          takes={SHAPE.wants}
          title="My want lists"
        >
          Lets Lugin mark the cards you are looking for while you browse, filter a seller’s stock
          down to just those cards, and tell you which sellers carry the most of your list — so one
          order covers more of it.
        </Choice>

        <Choice
          busy={purchasesBusy}
          checked={doPurchases}
          done={started && !purchasesBusy && purchases.status === 'done'}
          icon={ReceiptEuro}
          onChange={setDoPurchases}
          takes={SHAPE.purchases}
          title="My past purchases"
        >
          Reads your completed orders, so Lugin can warn you when you already own a card, show what
          you paid for it last time, and total up what you have actually spent — postage included.
        </Choice>

        {doPurchases && (
          <label
            className={`ml-6 flex cursor-pointer gap-2 text-2xs ${started ? 'opacity-60' : ''}`}
          >
            <input
              checked={toCollection}
              className="mt-0.5 flex-none"
              disabled={started}
              onChange={e => setToCollection(e.target.checked)}
              type="checkbox"
            />
            <span className="text-ink-muted">
              <span className="inline-flex items-center gap-1 font-medium text-ink">
                <Library aria-hidden size={12} />
                Also add what I bought to my collection
              </span>
              <span className="mt-0.5 block text-ink-faint">
                Worth it if you keep what you buy. If you resell or buy for other people, leave it
                off — you can turn it on later in the Collection tab.
              </span>
            </span>
          </label>
        )}

        {started ? (
          <div className="rounded-md border border-line bg-panel p-2.5">
            <div className="flex items-center gap-2 text-xs text-ink">
              {busy ? (
                <Loader2 aria-hidden className="animate-spin text-accent" size={14} />
              ) : (
                <Check aria-hidden className="text-pos" size={14} />
              )}
              {progressLine()}
            </div>
            <p className="mt-1.5 text-2xs text-ink-faint">
              This keeps going if you browse elsewhere — the queue survives page changes, so you do
              not have to sit here.
            </p>
            <Button className="mt-2" onClick={onDone} size="xs" variant="subtle">
              Go to Lugin
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              disabled={!doWants && !doPurchases}
              onClick={proceed}
              size="md"
              variant="primary"
            >
              {doWants && doPurchases ? 'Sync both' : 'Sync'}
            </Button>
            <Button onClick={onDone} size="md" variant="subtle">
              Skip for now
            </Button>
          </div>
        )}

        <p className="text-2xs text-ink-faint">
          Nothing here is permanent: you can re-sync, or clear any of it, whenever you like.
        </p>
      </div>
    </div>
  );
};
