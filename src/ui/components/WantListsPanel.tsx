import { useMemo, useRef, useState, useSyncExternalStore, type DragEvent } from 'react';

import { useCardMetadata } from '../useCardMetadata';
import { useRowSelection } from '../useRowSelection';
import { useWideLayout } from '../useWideLayout';

import { Badge } from './Badge';
import { Button } from './Button';
import { CollectionThumb } from './CollectionThumb';
import { EmptyState } from './EmptyState';
import { TextInput, SearchInput, Select } from './Field';
import { IconButton } from './IconButton';
import { SelectionBar } from './Selection';
import { ViewToggle } from './ViewToggle';
import { useCardPreview } from './cardPreview';
import {
  ArrowDownWideNarrow,
  ArrowLeft,
  ArrowUpWideNarrow,
  Check,
  ClipboardList,
  Columns2,
  ExternalLink,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from './icons';

import { previewStore } from '@/content/previewStore';
import { catalogueSearchStore } from '@/content/catalogueSearchStore';
import { imageUrlFor } from '@/lib/cardImage';
import { askForLogin, cmToken } from '@/content/session';
import { taskQueue } from '@/content/taskQueue';
import {
  cardCounts,
  dropList,
  dropWants,
  listCards,
  moveWants,
  renameList,
  setListWants,
  type ListCard,
} from '@/content/wantsIndex';
import { wantsStore } from '@/content/wantsStore';
import { cardKey } from '@/lib/cardName';
import type { CardMetadata } from '@/lib/mtg';
import {
  CONDITIONS,
  readWantDefaults,
  writeWantDefaults,
  type WantDefaults,
} from '@/sites/cardmarket/wantDefaults';
import {
  deleteWant,
  deleteWantList,
  listWantRows,
  massDeleteWants,
  massMoveWants,
  renameWantList,
  wantListName,
  WANT_LIST_NAME,
  type WantRow,
  type WantsIndexList,
} from '@/sites/cardmarket/wants';
import { taskProgress, timeAgo } from '@/ui/format';
import { holdingPick, PICK_KEY } from '@/ui/modifier';

/** The site's own page for a list, for anything we don't do ourselves yet. */
const listUrl = (id: string): string => {
  const first = location.pathname.split('/').filter(Boolean)[0] ?? '';
  const lang = /^[a-z]{2}$/.test(first) ? first : 'en';
  return `${location.origin}/${lang}/Magic/Wants/${id}`;
};

/** Rows or tiles, remembered across navigations like the other panels' modes. */
type Shape = 'list' | 'box';
const SHAPE_KEY = 'lugin:wantListsShape';
const readShape = (): Shape => {
  try {
    return localStorage.getItem(SHAPE_KEY) === 'box' ? 'box' : 'list';
  } catch {
    return 'list';
  }
};

// Comparing two lists, the interesting question is usually "what do both want?".
// Split answers it by sectioning each pane, either way up:
//   off      one alphabetical run
//   common   the cards both lists want, then the rest
//   unique   the rest, then the cards both lists want
type Split = 'off' | 'common' | 'unique';
const NEXT_SPLIT: Record<Split, Split> = { common: 'unique', off: 'common', unique: 'off' };
const SPLIT_LABEL: Record<Split, string> = {
  common: 'Doubles first',
  off: 'Split doubles',
  unique: 'Doubles last',
};

// Dragging a selection from one pane to the other. The payload rides on a type of
// our own so a pane can tell, from `dataTransfer.types` alone, whether a drag it
// can accept is passing over it — the data itself is unreadable until the drop.
const DRAG_TYPE = 'application/x-lugin-wants';
/** A ⌘-drag that sprang back, which is Chrome's doing and needs saying. */
const CMD_SNAG = `Chrome won’t drop anything while ⌘ is held — use ${PICK_KEY} to copy.`;

/** Which wants are being dragged, and the list they're currently on. */
interface DragPayload {
  idWants: string[];
  listId: string;
}

const readPayload = (raw: string): DragPayload | null => {
  try {
    const p = JSON.parse(raw) as Partial<DragPayload>;
    if (!p.listId || !Array.isArray(p.idWants) || p.idWants.length === 0) return null;
    return { idWants: p.idWants.filter(id => typeof id === 'string'), listId: p.listId };
  } catch {
    return null;
  }
};

/** Cards on their way from one list to another, while the request is out. */
interface Transfer {
  cards: ListCard[];
  copy: boolean;
  from: string;
  to: string;
}

/** What can be done to a handful of picked cards, all in one request. */
export type Bulk =
  | { kind: 'delete' }
  | { kind: 'copy'; target: WantsIndexList }
  | { kind: 'move'; target: WantsIndexList };

interface PaneProps {
  /** Progress or refusal from the last bulk action on this list. */
  bulk?: string;
  cards: ListCard[];
  /** Cards on their way in, shown as placeholders until they really arrive. */
  incoming?: ListCard[];
  /** Wants of this list that are mid-flight to another one. */
  leaving?: Set<string>;
  list: WantsIndexList;
  metaByKey: Record<string, CardMetadata>;
  onBulk: (action: Bulk, cards: ListCard[]) => void;
  onClose?: () => void;
  /** Given, this pane accepts a selection dragged over from the other one. */
  onDropWants?: (payload: DragPayload, copy: boolean) => void;
  /** Given, the pane's title becomes a picker for which list it shows. */
  onPick?: (listId: string) => void;
  onRemove: (card: ListCard) => void;
  /** The lists the picker offers (the other pane's is left out by the caller). */
  options?: WantsIndexList[];
  removing: Record<string, string>;
  shape: Shape;
  /** Card keys the other pane wants too, for the doubles split. */
  shared?: Set<string>;
  split: Split;
  /** Where a selection can be moved or copied to: every other list. */
  targets: WantsIndexList[];
}

/** One want list's cards. Two of these side by side is the comparison view. */
const ListPane = ({
  bulk,
  cards,
  incoming,
  leaving,
  list,
  metaByKey,
  onBulk,
  onClose,
  onDropWants,
  onPick,
  onRemove,
  options = [],
  removing,
  shape,
  shared,
  split,
  targets,
}: PaneProps) => {
  const preview = useCardPreview();
  /** Set while a droppable drag hovers this pane, to what the drop would do. */
  const [over, setOver] = useState<'copy' | 'move' | null>(null);
  /** The last thing the modifiers said, kept for the drop that follows. */
  const copying = useRef(false);
  /** Whether ⌘ alone was held during the drag, and what to say if it was. */
  const heldCmd = useRef(false);
  const [snag, setSnag] = useState<string | null>(null);

  const openCardSearch = (name: string) => {
    catalogueSearchStore.request(name, { exact: true });
  };

  const art = (card: ListCard): string[] => {
    const meta = metaByKey[card.key];
    const faces = meta?.faceImages ?? [];
    if (faces.length >= 2) return faces;
    if (meta?.imageUrl) return [meta.imageUrl];
    const byName = imageUrlFor(undefined, card.name);
    return byName ? [byName] : [];
  };

  // Split, when asked for, puts the cards both lists want in their own section.
  // A pane with nothing shared (or nothing else) still shows one section, so the
  // two panes stay readable side by side instead of sprouting empty headings.
  const groups = useMemo(() => {
    if (split === 'off' || !shared) return [{ cards, key: 'all', label: '' }];
    const both = { cards: cards.filter(c => shared.has(c.key)), key: 'both', label: 'In both' };
    const only = { cards: cards.filter(c => !shared.has(c.key)), key: 'only', label: 'Only here' };
    const order = split === 'common' ? [both, only] : [only, both];
    return order.filter(g => g.cards.length > 0);
  }, [cards, shared, split]);

  // Selection follows what's on screen, in the order it's drawn, so ranges and
  // the arrow keys agree with the split. Rows that vanish (deleted, moved away)
  // drop out of the selection on their own.
  const visible = useMemo(() => groups.flatMap(g => g.cards), [groups]);
  // A stand-in stops standing in the moment the real card shows up, so a landed
  // move isn't drawn twice while the list is being confirmed.
  const arriving = useMemo(() => {
    if (!incoming?.length) return [];
    const here = new Set(cards.map(c => c.key));
    return incoming.filter(c => !here.has(c.key));
  }, [cards, incoming]);
  const ids = useMemo(() => visible.map(c => c.idWant), [visible]);
  const selection = useRowSelection(ids);
  const picked = useMemo(() => {
    const byId = new Map(visible.map(c => [c.idWant, c]));
    return selection.ids.flatMap(id => {
      const card = byId.get(id);
      return card ? [card] : [];
    });
  }, [selection.ids, visible]);

  // A selected row is a handle for the whole selection: drag it to the other pane
  // to move those cards there, hold ⌥/ctrl to leave copies behind. The pickers in
  // the bar do the same thing for lists that aren't on screen.
  const pickedIds = useMemo(() => new Set(selection.ids), [selection.ids]);
  const dragProps = (card: ListCard) =>
    pickedIds.has(card.idWant)
      ? {
          draggable: true,
          onDrag: (e: DragEvent<HTMLElement>) => {
            if (e.metaKey && !e.altKey && !e.ctrlKey) heldCmd.current = true;
          },
          // Chrome swallows the drop while ⌘ is held, so the drag ends where it
          // began with nothing to show for it. Saying so beats looking broken.
          onDragEnd: (e: DragEvent<HTMLElement>) => {
            if (e.dataTransfer.dropEffect === 'none' && heldCmd.current) setSnag(CMD_SNAG);
          },
          onDragStart: (e: DragEvent<HTMLElement>) => {
            previewStore.hide();
            heldCmd.current = false;
            setSnag(null);
            e.dataTransfer.setData(
              DRAG_TYPE,
              JSON.stringify({ idWants: selection.ids, listId: list.id } satisfies DragPayload),
            );
            // So the same drag is worth something outside the overlay.
            e.dataTransfer.setData('text/plain', picked.map(c => c.name).join('\n'));
            // Every operation, though only two are meant: a browser refuses the
            // drop outright when the operation the held keys ask for isn't among
            // these, and which key asks for what is the browser's business (Safari
            // derives this attribute from the keys itself). What a drop *means* is
            // decided from the modifiers below, not from what the browser picked.
            e.dataTransfer.effectAllowed = 'all';
          },
        }
      : {};

  const dropProps = onDropWants
    ? {
        onDragLeave: () => setOver(null),
        onDragOver: (e: DragEvent<HTMLElement>) => {
          if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
          e.preventDefault();
          // The key that picks rows also copies them, held while dragging.
          const copy = holdingPick(e);
          copying.current = copy;
          e.dataTransfer.dropEffect = copy ? 'copy' : 'move';
          setOver(copy ? 'copy' : 'move');
        },
        onDrop: (e: DragEvent<HTMLElement>) => {
          setOver(null);
          const payload = readPayload(e.dataTransfer.getData(DRAG_TYPE));
          if (!payload || payload.listId === list.id) return;
          e.preventDefault();
          // What the pane said it would do while the drag was over it, so the
          // badge and the request can't disagree.
          onDropWants(payload, copying.current);
        },
      }
    : {};

  const targetPicker = (kind: 'copy' | 'move', label: string) => (
    <Select
      className="max-w-[10rem]"
      onChange={e => {
        const target = targets.find(l => l.id === e.target.value);
        if (target) onBulk({ kind, target }, picked);
      }}
      value=""
    >
      <option value="">{label}</option>
      {targets.map(l => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
    </Select>
  );

  // One remove affordance for both shapes: a spinner while the request is out,
  // and the reason kept on the tooltip if Cardmarket refused.
  const removeButton = (card: ListCard) => {
    const state = removing[`${list.id}|${card.idWant}`];
    if (leaving?.has(card.idWant))
      return (
        <span className="ml-auto flex flex-none items-center" title="On its way over">
          <Loader2 aria-hidden className="animate-spin text-ink-faint" size={12} />
        </span>
      );
    return (
      <span className="ml-auto flex flex-none items-center gap-1">
        {state && state !== 'removing' && (
          <span className="text-2xs text-neg" title={state}>
            failed
          </span>
        )}
        <IconButton
          className={state === 'removing' ? 'animate-spin' : ''}
          disabled={state === 'removing'}
          icon={state === 'removing' ? Loader2 : Trash2}
          label={`Remove ${card.name} from ${list.name}`}
          onClick={() => onRemove(card)}
          tone="danger"
        />
      </span>
    );
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-none items-center gap-1.5 border-b border-line px-2 py-1">
        {onPick ? (
          <Select
            className="min-w-0 max-w-[14rem]"
            onChange={e => onPick(e.target.value)}
            title="Compare against a different list"
            value={list.id}
          >
            {options.map(l => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        ) : (
          <span className="truncate text-xs font-medium text-ink">{list.name}</span>
        )}
        <Badge>{cards.length}</Badge>
        <a
          className="ml-auto text-ink-faint hover:text-ink"
          href={listUrl(list.id)}
          rel="noreferrer"
          target="_blank"
          title="Open on Cardmarket"
        >
          <ExternalLink aria-hidden size={12} />
        </a>
        {onClose && <IconButton icon={X} label="Close this list" onClick={onClose} />}
      </div>

      {cards.length > 0 && (
        <SelectionBar selection={selection}>
          <Button
            icon={Trash2}
            onClick={() => onBulk({ kind: 'delete' }, picked)}
            size="xs"
            variant="danger"
          >
            Delete
          </Button>
          {targets.length > 0 && (
            <>
              {targetPicker('move', 'Move to…')}
              {targetPicker('copy', 'Copy to…')}
            </>
          )}
          {onDropWants && (
            <span className="text-ink-faint">or drag them across, {PICK_KEY}-drag to copy</span>
          )}
          {bulk === 'working' ? (
            <Loader2 aria-hidden className="animate-spin text-ink-faint" size={12} />
          ) : (
            bulk && <span className="text-neg">{bulk}</span>
          )}
          {snag && <span className="text-warn">{snag}</span>}
        </SelectionBar>
      )}

      {/* `overscroll-contain`: reaching the end of a pane shouldn't hand the
          wheel to the page underneath the overlay. */}
      <div
        className={`relative min-h-0 flex-1 overflow-y-auto overscroll-contain ${
          over ? 'ring-2 ring-inset ring-accent' : ''
        }`}
        {...selection.listProps}
        {...dropProps}
      >
        {over && (
          <div className="pointer-events-none sticky top-0 z-20 flex justify-center py-1">
            <span className="rounded-full bg-accent px-2 py-0.5 text-2xs font-medium text-accent-ink shadow-pop">
              {over === 'copy' ? `Copy to ${list.name}` : `Move to ${list.name}`}
            </span>
          </div>
        )}
        {/* Cards can't be drawn properly before Cardmarket says what it made of
            them (a copy gets a new id), so they're stood in for until it does. */}
        {arriving.length > 0 && (
          <section>
            <h3 className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-line bg-panel px-2 py-0.5 text-2xs font-medium uppercase tracking-wide text-ink-muted">
              <Loader2 aria-hidden className="animate-spin" size={11} />
              Arriving
              <Badge tone="accent">{arriving.length}</Badge>
            </h3>
            <ul>
              {arriving.map(card => (
                <li
                  key={card.key}
                  className="flex items-center gap-1.5 border-b border-line/60 px-2 py-1 opacity-40"
                >
                  <span className="truncate text-xs text-ink">{card.name}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {cards.length === 0 && arriving.length === 0 ? (
          <EmptyState hint="Nothing on this list yet." icon={ClipboardList} title="Empty list" />
        ) : (
          groups.map(group => (
            <section key={group.key}>
              {group.label && (
                <h3 className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-line bg-panel px-2 py-0.5 text-2xs font-medium uppercase tracking-wide text-ink-muted">
                  {group.label}
                  <Badge tone={group.key === 'both' ? 'accent' : 'neutral'}>
                    {group.cards.length}
                  </Badge>
                </h3>
              )}
              {shape === 'box' ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-1.5 p-1.5">
                  {group.cards.map(card => {
                    const urls = art(card);
                    const { handlers } = preview(`${list.id}|${card.key}`, card.name, urls);
                    return (
                      <div
                        key={card.key}
                        {...selection.rowProps(
                          card.idWant,
                          `overflow-hidden rounded border border-line bg-panel ${
                            leaving?.has(card.idWant) ? 'opacity-40' : ''
                          }`,
                        )}
                        {...dragProps(card)}
                      >
                        {urls.length > 0 ? (
                          <img
                            alt={card.name}
                            className="block aspect-[63/88] w-full cursor-pointer"
                            decoding="async"
                            loading="lazy"
                            src={urls[0]}
                            title={`Search Cardmarket for ${card.name}`}
                            {...handlers}
                            onClick={e => {
                              e.stopPropagation();
                              openCardSearch(card.name);
                            }}
                          />
                        ) : (
                          <button
                            className="flex aspect-[63/88] w-full items-center justify-center px-1 text-center text-2xs text-ink-faint"
                            onClick={e => {
                              e.stopPropagation();
                              openCardSearch(card.name);
                            }}
                            type="button"
                          >
                            {card.name}
                          </button>
                        )}
                        <div className="flex items-center gap-1 px-1 py-0.5">
                          <button
                            className="min-w-0 flex-1 truncate text-left text-2xs text-ink-dim hover:text-accent hover:underline"
                            onClick={e => {
                              e.stopPropagation();
                              openCardSearch(card.name);
                            }}
                            title={`Search Cardmarket for ${card.name}`}
                            type="button"
                          >
                            {card.name}
                          </button>
                          {removeButton(card)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <ul>
                  {group.cards.map(card => (
                      <li
                        key={card.key}
                        {...selection.rowProps(
                          card.idWant,
                          `flex items-center gap-1.5 border-b border-line/60 px-2 py-1 hover:bg-tint ${
                            leaving?.has(card.idWant) ? 'opacity-40' : ''
                          }`,
                        )}
                        {...dragProps(card)}
                      >
                        <CollectionThumb
                          candidates={art(card)}
                          name={card.name}
                          previewKey={`${list.id}|${card.key}`}
                        />
                        <button
                          className="min-w-0 flex-1 truncate text-left text-xs text-ink hover:text-accent hover:underline"
                          onClick={e => {
                            e.stopPropagation();
                            openCardSearch(card.name);
                          }}
                          title={`Search Cardmarket for ${card.name}`}
                          type="button"
                        >
                          {card.name}
                        </button>
                        {card.alsoOn.length > 0 && (
                          <Badge title={`Also on ${card.alsoOn.join(', ')}`} tone="neutral">
                            +{card.alsoOn.length}
                          </Badge>
                        )}
                        {removeButton(card)}
                      </li>
                  ))}
                </ul>
              )}
            </section>
          ))
        )}
      </div>
    </div>
  );
};

/**
 * The want lists themselves: what there is, what's on each, and the list-level
 * actions the site's own Wants page offers. Everything is read from the local
 * index, so it costs nothing to browse; only an edit talks to Cardmarket.
 */
export const WantListsPanel = () => {
  const { error, index, status } = useSyncExternalStore(
    wantsStore.subscribe,
    wantsStore.getSnapshot,
  );
  const tasks = useSyncExternalStore(taskQueue.subscribe, taskQueue.getSnapshot);
  const syncing = tasks.find(
    t => t.type === 'syncWants' && (t.status === 'queued' || t.status === 'running'),
  );
  const working = !!syncing || status === 'syncing' || status === 'queued';

  const { ref, wide } = useWideLayout(880);
  const [shape, setShape] = useState<Shape>(readShape);
  const [openId, setOpenId] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [split, setSplit] = useState<Split>('off');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<Record<string, string>>({});
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<Transfer | null>(null);

  const counts = useMemo(() => cardCounts(index), [index]);

  // Mirrored in state so the controls re-render; localStorage is the store of
  // record, because the task queue reads it synchronously mid-run.
  const [wantDefaults, setWantDefaultsState] = useState(readWantDefaults);
  const saveWantDefaults = (next: WantDefaults) => {
    writeWantDefaults(next);
    setWantDefaultsState(next);
  };

  // Distinct cards, not the sum of the lists: a card on three lists is one card
  // you are looking for, and the larger number would only ever mislead.
  const totalWanted = index ? Object.keys(index.cards).length : 0;
  const mismatches = useMemo(
    () => (index?.lists ?? []).filter(l => l.expected >= 0 && l.extracted < l.expected),
    [index],
  );

  const lists = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = index?.lists ?? [];
    return q ? all.filter(l => l.name.toLowerCase().includes(q)) : all;
  }, [index, query]);

  const open = index?.lists.find(l => l.id === openId) ?? null;
  const compare = index?.lists.find(l => l.id === compareId) ?? null;
  /** Everything the second pane may show — anything but what the first one has. */
  const others = useMemo(
    () => (index?.lists ?? []).filter(l => l.id !== open?.id),
    [index, open?.id],
  );
  // Keyed on the ids, not on `open`/`compare`: those come from a `find` and are a
  // fresh object every render, which would rebuild these lists (and everything
  // derived from them) on any state change at all.
  const openCards = useMemo(() => (openId ? listCards(index, openId) : []), [index, openId]);
  const compareCards = useMemo(
    () => (compareId ? listCards(index, compareId) : []),
    [compareId, index],
  );
  // One lookup for both panes, so a card on each isn't asked for twice.
  const names = useMemo(
    () => [...openCards, ...compareCards].map(c => c.name),
    [compareCards, openCards],
  );
  const { metaByKey } = useCardMetadata(names);
  const shared = useMemo(() => {
    if (!compare) return undefined;
    const right = new Set(compareCards.map(c => c.key));
    return new Set(openCards.filter(c => right.has(c.key)).map(c => c.key));
  }, [compare, compareCards, openCards]);
  const sharedCount = shared?.size ?? 0;

  /** What a pane should show of a transfer in progress: leaving, or arriving. */
  const inFlight = (listId: string) => ({
    incoming: transfer?.to === listId ? transfer.cards : undefined,
    leaving: transfer?.from === listId ? new Set(transfer.cards.map(c => c.idWant)) : undefined,
  });

  const chooseShape = (next: Shape) => {
    setShape(next);
    try {
      localStorage.setItem(SHAPE_KEY, next);
    } catch {
      // ignore storage failures
    }
  };

  const sync = () => {
    wantsStore.markQueued();
    taskQueue.enqueue('syncWants', 'Sync want lists');
  };

  /**
   * Run something that writes to Cardmarket, holding the session token for it.
   * No token anywhere means the session has expired, and there's nothing to say
   * about that which is more useful than the login screen itself.
   */
  const withToken = (id: string, run: (token: string) => Promise<void>) => {
    setBusy(s => ({ ...s, [id]: 'working' }));
    void (async () => {
      const token = await cmToken();
      if (!token) {
        askForLogin();
        return;
      }
      await run(token);
    })()
      .then(() => setBusy(s => ({ ...s, [id]: '' })))
      .catch((err: unknown) =>
        setBusy(s => ({ ...s, [id]: err instanceof Error ? err.message : String(err) })),
      );
  };

  const saveName = (list: WantsIndexList, raw: string) => {
    const name = wantListName(raw);
    if (!index || !WANT_LIST_NAME.test(name) || name === list.name) {
      setEditing(null);
      return;
    }
    withToken(list.id, async token => {
      const r = await renameWantList(list.id, name, token);
      if (!r.ok) throw new Error(r.message);
      await wantsStore.applyIndex(renameList(index, list.id, name));
      setEditing(null);
    });
  };

  const remove = (list: WantsIndexList) => {
    if (!index) return;
    withToken(list.id, async token => {
      const r = await deleteWantList(list.id, token);
      if (!r.ok) throw new Error(r.message);
      await wantsStore.applyIndex(dropList(index, list.id));
      if (openId === list.id) setOpenId(null);
      if (compareId === list.id) setCompareId(null);
      setConfirmId(null);
    });
  };

  const removeWant = (list: WantsIndexList, card: ListCard) => {
    if (!index) return;
    const key = `${list.id}|${card.idWant}`;
    setRemoving(s => ({ ...s, [key]: 'removing' }));
    void (async () => {
      const token = await cmToken();
      if (!token) {
        askForLogin();
        return;
      }
      try {
        const r = await deleteWant(list.id, card.idWant, token);
        if (!r.ok) throw new Error(r.message);
        await wantsStore.applyIndex(dropWants(index, [{ idWant: card.idWant, listId: list.id }]));
        setRemoving(s => {
          const next = { ...s };
          delete next[key];
          return next;
        });
      } catch (err) {
        setRemoving(s => ({ ...s, [key]: err instanceof Error ? err.message : String(err) }));
      }
    })();
  };

  /**
   * Read a list back until it shows what was just written to it.
   *
   * A page fetched immediately after a write can arrive before the write is
   * visible — or not arrive at all, since a burst of requests is what earns a
   * Cloudflare interstitial, which parses as a list with nothing on it. Both look
   * the same from here and both pass, so the read is simply asked again, and the
   * last answer is returned either way for the caller to judge.
   */
  const readList = async (
    id: string,
    wanted: ReadonlySet<string>,
    byName: boolean,
  ): Promise<WantRow[]> => {
    let rows: WantRow[] = [];
    for (const wait of [0, 800, 2000]) {
      if (wait > 0) await new Promise(done => setTimeout(done, wait));
      rows = await listWantRows(id);
      const have = new Set(rows.map(row => (byName ? cardKey(row.name) : row.idWant)));
      if (rows.length > 0 && [...wanted].every(w => have.has(w))) return rows;
    }
    return rows;
  };

  /**
   * Delete, move or copy a handful of picked cards, in one request each way — the
   * same three the site's own want list page offers.
   *
   * A move keeps the wants' ids, so it can be shown at once and confirmed after.
   * A copy makes new ones that only Cardmarket knows, so there the receiving list
   * has to be read before there's anything to show.
   */
  const runBulk = (list: WantsIndexList, action: Bulk, cards: ListCard[]) => {
    if (!index || cards.length === 0) return;
    const idWants = cards.map(c => c.idWant);

    if (action.kind === 'delete') {
      withToken(`bulk:${list.id}`, async token => {
        const r = await massDeleteWants(list.id, idWants, token);
        if (!r.ok) throw new Error(r.message);
        await wantsStore.applyIndex(
          dropWants(
            index,
            cards.map(c => ({ idWant: c.idWant, listId: list.id })),
          ),
        );
      });
      return;
    }

    const { target } = action;
    const copy = action.kind === 'copy';
    setTransfer({ cards, copy, from: list.id, to: target.id });
    withToken(`bulk:${list.id}`, async token => {
      try {
        const r = await massMoveWants(
          { idWants, idWantsList: list.id, keepOriginals: copy, target: target.id },
          token,
        );
        if (!r.ok) throw new Error(r.message);

        // A move is knowable straight away — the wants keep their ids — so show it
        // before confirming. A copy makes new wants whose ids only the site knows,
        // so there the list has to be read before anything can be said.
        let next = copy ? index : moveWants(index, list.id, target, idWants);
        if (!copy) await wantsStore.applyIndex(next);

        // A move is recognised by the ids that came over; a copy has none of ours
        // to look for, so it goes by name — which is all the index keeps anyway.
        const wanted = copy ? new Set(cards.map(c => c.key)) : new Set(idWants);
        const rows = await readList(target.id, wanted, copy);
        const landed = copy
          ? new Set(rows.map(row => cardKey(row.name)))
          : new Set(rows.map(row => row.idWant));

        // A list that reads as empty moments after being written to is the read
        // going wrong, not the list. Better to keep the move and be a sync behind
        // on the copy than to erase a list on the word of a bad read.
        if (rows.length === 0) {
          if (copy)
            throw new Error('Copied — Cardmarket wouldn’t show the list. Sync to see them.');
          return;
        }
        next = setListWants(next, target, rows);

        const missing = [...wanted].filter(w => !landed.has(w));
        if (missing.length > 0 && copy) {
          await wantsStore.applyIndex(next);
          throw new Error(
            `Cardmarket copied ${wanted.size - missing.length} of ${wanted.size} to ${target.name}.`,
          );
        }
        // Anything that didn't arrive never left, so the list it came from is
        // re-read rather than left claiming cards it no longer has.
        if (missing.length > 0) {
          await wantsStore.applyIndex(setListWants(next, list, await listWantRows(list.id)));
          throw new Error(
            `Cardmarket left ${missing.length} of ${idWants.length} on ${list.name} — try again.`,
          );
        }
        await wantsStore.applyIndex(next);
      } finally {
        setTransfer(null);
      }
    });
  };

  /**
   * A selection dragged from the other pane and dropped on `target`. The cards
   * are looked up from the list they came from, so this is the same work the
   * bar's pickers do — a drop is just another way of saying where they go.
   */
  const dropOnto = (target: WantsIndexList, payload: DragPayload, copy: boolean) => {
    const source = index?.lists.find(l => l.id === payload.listId);
    if (!source) return;
    const dragged = new Set(payload.idWants);
    const cards = listCards(index, source.id).filter(c => dragged.has(c.idWant));
    if (cards.length > 0) runBulk(source, { kind: copy ? 'copy' : 'move', target }, cards);
  };

  const shapeToggle = <ViewToggle onChange={chooseShape} value={shape} />;

  return (
    // `h-full`, not `flex-1`: the tab wrapper is a plain block, so a flex child
    // would size itself to its content and scroll nothing.
    <div ref={ref} className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none flex-wrap items-center gap-1.5 border-b border-line px-2 py-1.5">
        {open ? (
          <>
            <IconButton icon={ArrowLeft} label="All want lists" onClick={() => setOpenId(null)} />
            <span className="truncate text-xs font-semibold text-ink">{open.name}</span>
            {/* Starting the comparison lives here; changing or ending it lives on
                the second pane itself, next to the list it's showing. */}
            {wide && !compare && others.length > 0 && (
              <>
                <Columns2 aria-hidden className="text-ink-faint" size={12} />
                <Select
                  className="max-w-[12rem]"
                  onChange={e => setCompareId(e.target.value || null)}
                  title="Open a second list beside this one"
                  value=""
                >
                  <option value="">Compare with…</option>
                  {others.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </>
            )}
            <span className="ml-auto flex items-center gap-1">
              {compare && (
                <Button
                  active={split !== 'off'}
                  icon={split === 'unique' ? ArrowDownWideNarrow : ArrowUpWideNarrow}
                  onClick={() => setSplit(NEXT_SPLIT[split])}
                  size="xs"
                  title={
                    split === 'off'
                      ? 'Group the cards both lists want together'
                      : `${sharedCount} card${sharedCount === 1 ? '' : 's'} in both — click to ${
                          split === 'common' ? 'move them to the bottom' : 'stop splitting'
                        }`
                  }
                  variant="subtle"
                >
                  {SPLIT_LABEL[split]}
                  {split !== 'off' && <Badge tone="accent">{sharedCount}</Badge>}
                </Button>
              )}
              {shapeToggle}
            </span>
          </>
        ) : (
          <>
            <SearchInput
              onChange={e => setQuery(e.target.value)}
              onClear={() => setQuery('')}
              placeholder="Find a want list…"
              value={query}
            />
            <span className="ml-auto flex items-center gap-1">
              {syncing && (
                <span className="text-2xs text-ink-faint">
                  {syncing.progress ? taskProgress(syncing.progress) : 'Starting…'}
                </span>
              )}
              <IconButton
                className={working ? 'animate-spin' : ''}
                disabled={working}
                icon={RefreshCw}
                label="Re-read the want lists from Cardmarket"
                onClick={sync}
              />
            </span>
          </>
        )}
      </div>

      {/* What the sync knows, and the two fields every new want is created with.
          Both used to live under "Tools" in the Search tab, which is where you
          would look for neither of them. */}
      {!open && (
        <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-2 py-1 text-2xs text-ink-muted">
          {index ? (
            <span>
              {index.lists.length} list{index.lists.length === 1 ? '' : 's'} · {totalWanted} card
              {totalWanted === 1 ? '' : 's'} · read {timeAgo(index.syncedAt)}
            </span>
          ) : (
            <span>Not read yet.</span>
          )}

          <label
            className="flex items-center gap-1"
            title="Condition floor for every want Lugin adds"
          >
            <span className="text-ink-faint">New wants at least</span>
            <Select
              onChange={e =>
                saveWantDefaults({ ...wantDefaults, minCondition: Number(e.target.value) })
              }
              value={wantDefaults.minCondition}
            >
              {CONDITIONS.map(c => (
                <option key={c.id} value={c.id}>
                  {c.short}
                </option>
              ))}
            </Select>
          </label>

          <label
            className="flex items-center gap-1"
            title="Maximum price for every want Lugin adds"
          >
            <span className="text-ink-faint">up to</span>
            <input
              className="h-6 w-14 rounded border border-line-strong bg-raised px-1.5 text-2xs text-ink outline-none focus:border-accent"
              min="0"
              onChange={e => {
                const value = Number(e.target.value);
                saveWantDefaults({
                  ...wantDefaults,
                  ...(e.target.value === '' || !(value > 0)
                    ? { wishPrice: undefined }
                    : { wishPrice: value }),
                });
              }}
              placeholder="any"
              step="0.25"
              type="number"
              value={wantDefaults.wishPrice ?? ''}
            />
          </label>

          {index && (
            <Button
              className="ml-auto"
              onClick={() => void wantsStore.clear()}
              size="xs"
              variant="subtle"
            >
              Clear
            </Button>
          )}
        </div>
      )}

      {/* A list that came up short against its own card count means the parser
          missed rows — worth saying, since the difference is silent otherwise. */}
      {!open && mismatches.length > 0 && (
        <p className="px-2 py-1 text-2xs text-warn">
          {mismatches.length} list{mismatches.length === 1 ? '' : 's'} came up short against
          Cardmarket’s own count — some may paginate differently.
        </p>
      )}

      {error && !open && <p className="px-2 py-1 text-2xs text-neg">{error}</p>}

      {open ? (
        /* A flex row, not a grid: a grid's auto row takes its height from its
           content, so a long list grew past the overlay instead of scrolling
           inside it — and the wheel then reached the site behind us. */
        <div className={`flex min-h-0 flex-1 ${compare ? 'divide-x divide-line' : ''}`}>
          <ListPane
            bulk={busy[`bulk:${open.id}`]}
            cards={openCards}
            list={open}
            {...inFlight(open.id)}
            metaByKey={metaByKey}
            onBulk={(action, cards) => runBulk(open, action, cards)}
            onDropWants={compare ? (payload, copy) => dropOnto(open, payload, copy) : undefined}
            onRemove={card => removeWant(open, card)}
            removing={removing}
            shape={shape}
            shared={shared}
            split={split}
            targets={others}
          />
          {compare && (
            <ListPane
              bulk={busy[`bulk:${compare.id}`]}
              cards={compareCards}
              list={compare}
              {...inFlight(compare.id)}
              metaByKey={metaByKey}
              onBulk={(action, cards) => runBulk(compare, action, cards)}
              onClose={() => setCompareId(null)}
              onDropWants={(payload, copy) => dropOnto(compare, payload, copy)}
              onPick={setCompareId}
              onRemove={card => removeWant(compare, card)}
              options={others}
              removing={removing}
              shape={shape}
              shared={shared}
              split={split}
              targets={(index?.lists ?? []).filter(l => l.id !== compare.id)}
            />
          )}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {lists.length === 0 ? (
            <EmptyState
              action={<Button onClick={sync}>Sync want lists</Button>}
              hint={
                index
                  ? 'No want list matches that.'
                  : 'Read your want lists from Cardmarket to browse them here.'
              }
              icon={ClipboardList}
              title={index ? 'Nothing found' : 'No want lists yet'}
            />
          ) : (
            <ul>
              {lists.map(list => {
                const state = busy[list.id];
                return (
                  <li key={list.id} className="border-b border-line/60">
                    <div className="flex items-center gap-1.5 px-2 py-1 hover:bg-tint">
                      {editing?.id === list.id ? (
                        <>
                          <TextInput
                            autoFocus
                            className="min-w-[8rem] flex-1"
                            maxLength={30}
                            onChange={e => setEditing({ id: list.id, name: e.target.value })}
                            onKeyDown={e => {
                              if (e.key === 'Enter') saveName(list, editing.name);
                              if (e.key === 'Escape') setEditing(null);
                            }}
                            value={editing.name}
                          />
                          <IconButton
                            className={state === 'working' ? 'animate-spin' : ''}
                            disabled={state === 'working'}
                            icon={state === 'working' ? Loader2 : Check}
                            label="Save the new name"
                            onClick={() => saveName(list, editing.name)}
                            tone="accent"
                          />
                          <IconButton
                            icon={X}
                            label="Keep the old name"
                            onClick={() => setEditing(null)}
                          />
                        </>
                      ) : (
                        <>
                          <button
                            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                            onClick={() => setOpenId(list.id)}
                            title="Open this list"
                            type="button"
                          >
                            <span className="truncate text-xs text-ink">{list.name}</span>
                            <Badge>{counts.get(list.id) ?? list.extracted}</Badge>
                          </button>
                          <IconButton
                            icon={Pencil}
                            label="Rename this list"
                            onClick={() => setEditing({ id: list.id, name: list.name })}
                          />
                          <a
                            className="px-1 text-ink-faint hover:text-ink"
                            href={listUrl(list.id)}
                            rel="noreferrer"
                            target="_blank"
                            title="Open on Cardmarket"
                          >
                            <ExternalLink aria-hidden size={12} />
                          </a>
                          {confirmId === list.id ? (
                            <>
                              <Button
                                disabled={state === 'working'}
                                icon={state === 'working' ? Loader2 : Trash2}
                                onClick={() => remove(list)}
                                size="xs"
                                variant="danger"
                              >
                                Delete
                              </Button>
                              <IconButton
                                icon={X}
                                label="Keep this list"
                                onClick={() => setConfirmId(null)}
                              />
                            </>
                          ) : (
                            <IconButton
                              icon={Trash2}
                              label="Delete this list"
                              onClick={() => setConfirmId(list.id)}
                            />
                          )}
                        </>
                      )}
                    </div>
                    {state && state !== 'working' && (
                      <p className="px-2 pb-1 text-2xs text-neg">{state}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
