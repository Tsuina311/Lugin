import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { Badge } from './Badge';
import { Button } from './Button';
import { Select, TextInput } from './Field';
import { IconButton } from './IconButton';
import { CircleAlert, Loader2, X } from './icons';

import { taskQueue } from '@/content/taskQueue';
import { wantsStore } from '@/content/wantsStore';
import { cardKey } from '@/lib/cardName';
import type { Deck, DeckShortfall } from '@/lib/deck';
import { findCmToken } from '@/sites/cardmarket/cart';
import {
  fetchAllWantLists,
  wantListName,
  WANT_LIST_NAME,
  type WantListMeta,
} from '@/sites/cardmarket/wants';
import { taskProgress } from '@/ui/format';

// Turning a deck into a shopping list: make a want list on Cardmarket (or pick
// one you already have) and fill it with everything the deck is short of.
//
// The work happens in the task queue, a card at a time with a pause between
// each, so it reads as somebody working through their list rather than a script
// hammering the site. It survives navigation, so you can carry on browsing —
// and picking up where it left off is why the queue owns it rather than this
// component, which is free to be closed.

/** Cardmarket's condition scale, as the want-list form offers it. */
const CONDITIONS: Array<[value: number, label: string]> = [
  [1, 'Mint'],
  [2, 'Near Mint'],
  [3, 'Excellent'],
  [4, 'Good'],
  [5, 'Light Played'],
  [6, 'Played'],
  [7, 'Poor'],
];

const NEW_LIST = 'new';

export const DeckWantList = ({
  deck,
  missing,
  onClose,
}: {
  deck: Deck;
  /** What the deck is short of, in deck order. */
  missing: DeckShortfall[];
  onClose: () => void;
}) => {
  const [lists, setLists] = useState<WantListMeta[] | null>(null);
  const [listsError, setListsError] = useState<string | null>(null);
  const [target, setTarget] = useState(NEW_LIST);
  const [typedName, setTypedName] = useState<string | null>(null);
  const [minCondition, setMinCondition] = useState(2);

  // A name you shouldn't have to think about. The commander is what you'd call
  // the deck anyway, and the shared prefix keeps every deck's list together in
  // Cardmarket's alphabetical list of them. Until you type something it keeps
  // following the deck, so naming a commander after opening this still lands.
  //
  // Run through `wantListName` because Cardmarket only takes letters, digits,
  // spaces and hyphens: a commander's comma would otherwise be refused, and the
  // refusal costs a round trip to find out.
  const suggestedName = useMemo(() => {
    const commanders = deck.cards.filter(c => c.section === 'commander');
    const what = commanders.length > 0 ? commanders.map(c => c.name).join(' - ') : deck.name;
    return wantListName(`deck ${what}`) || 'deck';
  }, [deck.cards, deck.name]);
  const name = typedName ?? suggestedName;
  const nameOk = WANT_LIST_NAME.test(name.trim());

  const tasks = useSyncExternalStore(taskQueue.subscribe, taskQueue.getSnapshot);
  const { index } = useSyncExternalStore(wantsStore.subscribe, wantsStore.getSnapshot);

  // The fill in flight, or the last one to finish, whichever there is.
  const task =
    tasks.find(t => t.type === 'deckWants' && (t.status === 'running' || t.status === 'queued')) ??
    [...tasks].reverse().find(t => t.type === 'deckWants');
  const running = task?.status === 'running' || task?.status === 'queued';

  // Which lists exist, so an existing one can be filled instead of a new one.
  // Re-read once a fill finishes: the list it just made belongs in this picker,
  // and a second run of the same deck should then recognize it by name rather
  // than leaving you with two lists of the same name.
  const finished = task?.status === 'done' ? task.id : null;
  useEffect(() => {
    let live = true;
    fetchAllWantLists()
      .then(found => {
        if (!live) return;
        setLists(found);
        setListsError(null);
      })
      .catch(err => live && setListsError(err instanceof Error ? err.message : String(err)));
    return () => {
      live = false;
    };
  }, [finished]);

  // A list you already have by that name is the list you meant — filling it
  // beats leaving you with two lists called "Wolves".
  const sameName = lists?.find(
    l => target === NEW_LIST && l.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  const chosen = lists?.find(l => l.id === target) ?? sameName;

  // Cards the last sync saw on the chosen list already. Adding them again would
  // just be noise — Cardmarket would reject them, one wasted request each.
  const already = useMemo(() => {
    if (!chosen || !index) return new Set<string>();
    const on = missing.filter(m => index.cards[cardKey(m.name)]?.lists.includes(chosen.name));
    return new Set(on.map(m => cardKey(m.name)));
  }, [chosen, index, missing]);

  const cards = missing.filter(m => !already.has(cardKey(m.name)));
  const copies = cards.reduce((n, c) => n + c.need, 0);

  const listName = chosen?.name ?? name.trim();
  const start = (): void => {
    taskQueue.enqueue('deckWants', `Want list · ${deck.name}`, {
      cards: cards.map(c => ({ name: c.name, need: c.need })),
      listId: chosen?.id,
      listName,
      minCondition,
      // Grab the session token now: the task may well run after you've moved on
      // to another page, and this one is guaranteed to have it.
      token: findCmToken() ?? undefined,
    });
  };

  return (
    <div className="flex-none border-b border-line bg-panel px-2 py-1.5 text-xs">
      <div className="flex items-center gap-1.5">
        <span className="font-semibold text-ink">Add missing cards to a want list</span>
        <Badge tone={cards.length > 0 ? 'warn' : 'pos'}>
          {cards.length} card{cards.length === 1 ? '' : 's'}
        </Badge>
        {copies > cards.length && <span className="text-ink-faint">{copies} copies</span>}
        {already.size > 0 && (
          <span className="text-ink-faint">{already.size} already on that list</span>
        )}
        <IconButton className="ml-auto" icon={X} label="Close" onClick={onClose} size="xs" />
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Select onChange={e => setTarget(e.target.value)} title="Where the cards go" value={target}>
          <option value={NEW_LIST}>New list…</option>
          {(lists ?? []).map(l => (
            <option key={l.id} value={l.id}>
              {l.name}
              {l.cardCount >= 0 ? ` (${l.cardCount})` : ''}
            </option>
          ))}
        </Select>
        {target === NEW_LIST && (
          <TextInput
            className={`min-w-[10rem] flex-1 ${nameOk ? '' : 'border-neg'}`}
            maxLength={30}
            onChange={e => setTypedName(e.target.value)}
            placeholder="List name"
            title="Name for the new want list"
            value={name}
          />
        )}
        <label className="flex items-center gap-1 text-ink-muted">
          from
          <Select
            onChange={e => setMinCondition(Number(e.target.value))}
            title="Worst condition you'd accept"
            value={minCondition}
          >
            {CONDITIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </label>
        {lists === null && !listsError && (
          <Loader2 aria-hidden className="animate-spin text-ink-faint" size={12} />
        )}
        <Button
          className="ml-auto"
          disabled={running || cards.length === 0 || !listName || (!chosen && !nameOk)}
          onClick={start}
          size="md"
          variant="primary"
        >
          {running ? 'Adding…' : `Add ${cards.length} card${cards.length === 1 ? '' : 's'}`}
        </Button>
      </div>

      {target === NEW_LIST && !nameOk && (
        <p className="mt-1 flex items-center gap-1 text-2xs text-neg">
          <CircleAlert aria-hidden size={11} />
          Cardmarket only takes letters, digits, spaces and hyphens, 30 at most.
        </p>
      )}

      {sameName && (
        <p className="mt-1 text-2xs text-ink-faint">
          You already have a list called “{sameName.name}” — these go in that one.
        </p>
      )}

      {cards.length === 0 && missing.length > 0 && (
        <p className="mt-1 text-2xs text-ink-faint">
          Everything the deck is missing is already on that list.
        </p>
      )}

      {listsError && (
        <p className="mt-1 flex items-center gap-1 text-2xs text-neg">
          <CircleAlert aria-hidden size={11} />
          Couldn’t read your want lists ({listsError}) — a new list still works.
        </p>
      )}

      {task && (
        <div className="mt-1.5">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-ink-muted">
              {task.status === 'queued'
                ? 'Queued — waiting for the current task…'
                : task.status === 'running'
                  ? task.progress
                    ? taskProgress(task.progress)
                    : 'Starting…'
                  : task.status === 'error'
                    ? (task.error ?? 'Failed')
                    : (task.summary ?? 'Done')}
            </span>
            {running && (
              <Button onClick={() => taskQueue.cancel(task.id)} size="xs" variant="neutral">
                {task.status === 'queued' ? 'Cancel' : 'Stop'}
              </Button>
            )}
            {task.status === 'error' && (
              <Button
                onClick={() => taskQueue.retry(task.id)}
                size="xs"
                title="Carry on from the card it stopped at"
                variant="primary"
              >
                Retry
              </Button>
            )}
          </div>
          {task.status === 'running' && task.progress && task.progress.total > 0 && (
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-tint-strong">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-300"
                style={{ width: `${(task.progress.current / task.progress.total) * 100}%` }}
              />
            </div>
          )}
          {/* Cards it couldn't add, so they can be chased by hand. */}
          {task.resume?.failed && task.resume.failed.length > 0 && (
            <ul className="mt-1 max-h-20 list-none space-y-0.5 overflow-auto text-2xs text-ink-faint">
              {task.resume.failed.map(f => (
                <li key={f} className="truncate" title={f}>
                  {f}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="mt-1.5 text-2xs text-ink-faint">
        Added one at a time, with a pause between each, like ordinary browsing. Carry on using the
        site — it keeps going in the background and picks up where it left off.
      </p>
    </div>
  );
};
