// Persistent, single-runner task queue.
//
// Long user actions — sync want lists, sync purchases, and "clean a purchase
// out of every want list" — are enqueued and run ONE AT A TIME. The queue lives
// in chrome.storage.local, so it survives navigation: whichever Cardmarket page
// is open picks the queue up and keeps going. Enqueue more while one is running
// and they line up behind it.
//
// Only one tab may run tasks at a time, enforced by a heartbeat lock in storage.
// If the running tab navigates away mid-task, its heartbeat goes stale and the
// next page reclaims the lock and retries the interrupted task — safe because
// every task type is idempotent (re-sync rebuilds; cleanup re-removes harmlessly).

import { collectionStore, shouldAddPurchasesToCollection } from './collectionStore';
import { purchaseStore, PURCHASES_STORAGE_KEY } from './purchaseStore';
import { cmToken } from './session';
import { askForVerification, needsVerification, VERIFY_HELP } from './verify';
import { wantsStore } from './wantsStore';

import { cardKey } from '@/lib/cardName';
import { readWantDefaults } from '@/sites/cardmarket/wantDefaults';
import {
  addWant,
  createWantList,
  fetchAllWantLists,
  findProductForCard,
  listWantKeys,
  pace,
  removeShipmentFromWantList,
  syncPurchases,
  syncWants,
  wantKey,
  type PurchaseIndex,
} from '@/sites/cardmarket/wants';

export type TaskType = 'syncWants' | 'syncPurchases' | 'cleanupWants' | 'deckWants';
export type TaskStatus = 'queued' | 'running' | 'done' | 'error';

export interface TaskProgress {
  /**
   * deckWants: cards that actually landed on the list, which is fewer than
   * `current` whenever one was refused or couldn't be found. Reported separately
   * because `current` counts attempts, and "how many did I get" is the question.
   */
  added?: number;
  current: number;
  label?: string;
  total: number;
}

export interface Task {
  createdAt: number;
  error?: string;
  finishedAt?: number;
  id: string;
  label: string;
  params?: {
    /**
     * deckWants: the cards to add, snapshotted when the task was created — the
     * user asked for these, so a collection edit mid-run can't change the job.
     */
    cards?: Array<{ name: string; need: number }>;
    /** deckWants: an existing list to fill; absent means create `listName`. */
    listId?: string;
    listName?: string;
    /** deckWants: Cardmarket's 1–7 condition scale (2 = Near Mint). */
    minCondition?: number;
    shipmentId?: string;
    /** CSRF token captured at enqueue time so cleanup survives navigation. */
    token?: string;
  };
  progress?: TaskProgress | null;
  /**
   * Resumable checkpoint, so navigating away doesn't start the job again from
   * the top. Persisted after each unit of work.
   */
  resume?: {
    /** deckWants: cards added so far. */
    added?: number;
    /** deckWants: card keys already handled (added or given up on). */
    doneCards?: string[];
    /** cleanupWants: want lists already handled. */
    doneListIds?: string[];
    /** deckWants: cards we couldn't add, with the reason, for the user to see. */
    failed?: string[];
    /** deckWants: the list being filled, so a resumed run makes no second one. */
    listId?: string;
    /** deckWants: the list's name, for the summary after a resume. */
    listName?: string;
    removed?: number;
  };
  startedAt?: number;
  status: TaskStatus;
  summary?: string;
  type: TaskType;
}

const QUEUE_KEY = 'lugin:taskQueue';
const LOCK_KEY = 'lugin:taskLock';
/** A lock older than this is considered abandoned (tab closed/navigated). */
const STALE_MS = 8_000;
const HEARTBEAT_MS = 3_000;
/** How often a non-running page re-checks whether it should take over. */
const WATCHDOG_MS = 3_000;
/** Keep the most recent finished tasks around for visibility, drop older. */
const KEEP_FINISHED = 8;

interface Lock {
  runnerId: string;
  ts: number;
}

const runnerId = Math.random().toString(36).slice(2);

/**
 * One runner per page, even if this module is evaluated twice.
 *
 * The storage lock is what keeps two tabs apart. Two copies of this module in the
 * *same* page are a different problem: each has its own timers, its own listeners
 * and its own id, so both read the queue, both claim to run it, and every request
 * goes out twice — which is how a want list ended up with two of every card. The
 * page is the one thing both copies can see, and the newest is the one to trust.
 */
const host = globalThis as typeof globalThis & { __luginTaskRunner?: string };
host.__luginTaskRunner = runnerId;
const isPageRunner = (): boolean => host.__luginTaskRunner === runnerId;

/**
 * A change here reloads the page rather than hot-swapping.
 *
 * This module is a singleton: an interval, a storage listener, a claim on the
 * cross-tab lock, and a task half-finished. Vite can only replace the module, not
 * retire the copy already running — and since the components that import it
 * accept updates, a swap left the old copy live and pumping alongside the new
 * one. A reload costs a few seconds of dev time and leaves exactly one runner,
 * which then resumes the interrupted task from its checkpoint.
 */
if (import.meta.hot) import.meta.hot.accept(() => location.reload());

let tasks: Task[] = [];
const listeners = new Set<() => void>();
let pumping = false;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let currentAbort: AbortController | null = null;
let currentTaskId: string | null = null;

const emit = () => {
  for (const l of listeners) l();
};

const persist = async () => {
  await chrome.storage.local.set({ [QUEUE_KEY]: tasks });
};

const setTasks = (next: Task[], save = true) => {
  tasks = next;
  emit();
  if (save) void persist();
};

const updateTask = (id: string, patch: Partial<Task>) => {
  setTasks(tasks.map(t => (t.id === id ? { ...t, ...patch } : t)));
};

const pruneFinished = () => {
  const finished = tasks.filter(t => t.status === 'done' || t.status === 'error');
  if (finished.length <= KEEP_FINISHED) return;
  const drop = new Set(
    finished
      .slice()
      .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0))
      .slice(0, finished.length - KEEP_FINISHED)
      .map(t => t.id),
  );
  setTasks(tasks.filter(t => !drop.has(t.id)));
};

// --- lock helpers ----------------------------------------------------------
const readLock = async (): Promise<Lock | undefined> =>
  (await chrome.storage.local.get(LOCK_KEY))[LOCK_KEY] as Lock | undefined;

const ownsLock = async (): Promise<boolean> => {
  const lock = await readLock();
  return !!lock && lock.runnerId === runnerId && Date.now() - lock.ts < STALE_MS;
};
/**
 * Is the work still ours — whoever else may have wanted it?
 *
 * Two ways to lose it: another tab takes the lock, or another copy of this module
 * takes the page. Age is deliberately not part of the question. It's what tells
 * *another* tab that we've gone away, but from in here a lock that has gone stale
 * while a slow request finished is still ours, and stopping over it would strand
 * the task. Only somebody else's name on it, or no lock at all, means we've been
 * replaced.
 */
const holdsLock = async (): Promise<boolean> =>
  isPageRunner() && (await readLock())?.runnerId === runnerId;
const tryClaimLock = async (): Promise<boolean> => {
  const lock = await readLock();
  if (lock && lock.runnerId !== runnerId && Date.now() - lock.ts < STALE_MS) return false;
  await chrome.storage.local.set({ [LOCK_KEY]: { runnerId, ts: Date.now() } });
  // Re-read after a beat to resolve races (last writer wins).
  await new Promise(r => setTimeout(r, 120));
  const confirmed = await readLock();
  return !!confirmed && confirmed.runnerId === runnerId;
};
const refreshLock = async () => {
  await chrome.storage.local.set({ [LOCK_KEY]: { runnerId, ts: Date.now() } });
};
const releaseLock = async () => {
  const lock = await readLock();
  if (lock && lock.runnerId === runnerId) await chrome.storage.local.remove(LOCK_KEY);
};

/**
 * Thrown when another page has taken the runner's lock out from under us.
 *
 * The lock is refreshed as each unit of work completes, so one slow request —
 * a card page that takes longer than {@link STALE_MS} — is enough for another
 * tab to declare us abandoned and start the same task. Both would then work the
 * same checkpoint, which is every request sent twice and every card added twice.
 * The loser stops on the spot and leaves the task, still `running`, to the tab
 * that now owns it.
 */
class LostLock extends Error {}

const startHeartbeat = () => {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => void refreshLock(), HEARTBEAT_MS);
};
const stopHeartbeat = () => {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
};

const loadFromStorage = async () => {
  const stored = (await chrome.storage.local.get(QUEUE_KEY))[QUEUE_KEY] as Task[] | undefined;
  tasks = Array.isArray(stored) ? stored : [];
  emit();
};

// --- task handlers ---------------------------------------------------------
const handleSyncWants = async (
  onProgress: (p: TaskProgress) => void,
  signal: AbortSignal,
): Promise<string> => {
  wantsStore.beginSync();
  const index = await syncWants(p => {
    wantsStore.setProgress(p);
    onProgress({ current: p.current, label: p.listName, total: p.total });
  }, signal);
  await wantsStore.finishSync(index);
  const cards = Object.keys(index.cards).length;
  return `${cards} card${cards === 1 ? '' : 's'} · ${index.lists.length} list${index.lists.length === 1 ? '' : 's'}`;
};

const handleSyncPurchases = async (
  onProgress: (p: TaskProgress) => void,
  signal: AbortSignal,
): Promise<string> => {
  purchaseStore.beginSync();
  // Read the persisted index directly so an incremental re-sync works even on a
  // freshly-loaded page (before the store's async startup load resolves).
  const prev = (await chrome.storage.local.get(PURCHASES_STORAGE_KEY))[PURCHASES_STORAGE_KEY] as
    PurchaseIndex | undefined;
  const index = await syncPurchases(
    p => {
      purchaseStore.setProgress(p);
      onProgress({ current: p.current, label: p.listName, total: p.total });
    },
    signal,
    prev,
  );
  await purchaseStore.finishSync(index);
  // Optionally fold the purchases into the collection (idempotent; replaces the
  // previous purchases contribution). Never let this fail the sync task.
  if (shouldAddPurchasesToCollection()) {
    try {
      await collectionStore.syncFromPurchases(index);
    } catch {
      // ignore — the purchase sync itself still succeeded
    }
  }
  const cards = Object.keys(index.cards).length;
  return `${cards} card${cards === 1 ? '' : 's'} · ${index.orderIds.length} orders`;
};

const handleCleanupWants = async (
  task: Task,
  onProgress: (p: TaskProgress) => void,
  signal: AbortSignal,
  checkpoint: (resume: NonNullable<Task['resume']>) => void,
): Promise<string> => {
  const shipmentId = task.params?.shipmentId;
  if (!shipmentId) throw new Error('Missing order id.');
  // Prefer the token captured when the task was created (the order page always
  // has one); only go looking for one if it wasn't captured.
  const token = task.params?.token ?? (await cmToken());
  if (!token) throw new Error('Not signed in to Cardmarket any more — log in and retry.');

  const lists = await fetchAllWantLists(signal);
  // Resume: skip lists already handled in a previous (interrupted) run.
  const done = new Set(task.resume?.doneListIds ?? []);
  let removed = task.resume?.removed ?? 0;
  const errors: string[] = [];
  for (let i = 0; i < lists.length; i++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const list = lists[i];
    if (done.has(list.id)) {
      onProgress({ current: done.size, label: list.name, total: lists.length });
      continue;
    }
    onProgress({ current: done.size, label: list.name, total: lists.length });
    try {
      const r = await removeShipmentFromWantList(shipmentId, list.id, token);
      if (r.ok) removed++;
      else errors.push(`${list.name}: ${r.message}`);
    } catch (err) {
      errors.push(`${list.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    done.add(list.id);
    // Persist the checkpoint before pacing, so an interruption mid-pause still
    // remembers this list as handled.
    checkpoint({ doneListIds: [...done], removed });
    onProgress({ current: done.size, label: list.name, total: lists.length });
    if (done.size < lists.length) {
      await new Promise(r => setTimeout(r, 700 + Math.random() * 800));
    }
  }
  // The want lists just changed, so refresh our index. Queue it behind this task
  // (it'll run next) rather than mutating the index by hand.
  if (removed > 0) {
    wantsStore.markQueued();
    taskQueue.enqueue('syncWants', 'Sync want lists');
  }
  return errors.length
    ? `Removed from ${removed}/${lists.length} lists · ${errors.length} issue(s)`
    : `Removed from ${removed}/${lists.length} lists`;
};

/**
 * Fill a want list with the cards a deck is missing, one card at a time.
 *
 * Each card costs a page read (to find its product) and a POST, spaced by the
 * same human-ish pause the rest of the app uses — this is a person working
 * through a list, and it should look like one. Every card is checkpointed, so
 * navigating away mid-run resumes at the next card instead of adding the first
 * forty again, and the list we create is checkpointed before any card is added
 * so a resume never creates a second list.
 */
const handleDeckWants = async (
  task: Task,
  onProgress: (p: TaskProgress) => void,
  signal: AbortSignal,
  checkpoint: (resume: NonNullable<Task['resume']>) => void,
): Promise<string> => {
  const wanted = task.params?.cards ?? [];
  if (wanted.length === 0) throw new Error('No missing cards to add.');
  const token = task.params?.token ?? (await cmToken());
  if (!token) throw new Error('Not signed in to Cardmarket any more — log in and retry.');

  const done = new Set(task.resume?.doneCards ?? []);
  const errors: string[] = [...(task.resume?.failed ?? [])];
  /** What the site said about a card, kept by name for the closing report. */
  const notes = new Map<string, string>(
    errors.map(e => {
      const at = e.indexOf(': ');
      return at < 0 ? [e, ''] : [e.slice(0, at), e.slice(at + 2)];
    }),
  );
  const note = (name: string, what: string) => {
    notes.set(name, what);
    errors.push(`${name}: ${what}`);
  };
  let added = task.resume?.added ?? 0;
  let listId = task.resume?.listId ?? task.params?.listId;
  let listName = task.resume?.listName ?? task.params?.listName ?? 'want list';
  const save = () => checkpoint({ added, doneCards: [...done], failed: errors, listId, listName });

  if (!listId) {
    onProgress({ added, current: 0, label: `creating “${listName}”`, total: wanted.length });
    const made = await createWantList(listName, token, signal);
    listId = made.id;
    listName = made.name;
    save();
    await pace(signal);
  }

  // What the list holds right now. Adding a card a list already has doesn't
  // fail — Cardmarket raises the existing want's amount instead — so without
  // this a second run over the same deck asks for two of everything. Read from
  // the list rather than the local index, which is only as fresh as the last
  // sync, and re-read on a resume so a half-finished run doesn't repeat itself.
  const present = await listWantKeys(listId, signal);
  const cards = wanted.filter(c => !present.has(wantKey(c.name)));
  const onList = wanted.length - cards.length;
  const summary = (missed = errors.length): string => {
    const parts = [`${added} card${added === 1 ? '' : 's'} → ${listName}`];
    if (onList > 0) parts.push(`${onList} already there`);
    if (missed > 0) parts.push(`${missed} skipped`);
    return parts.join(' · ');
  };
  if (cards.length === 0) return summary();

  const report = (label: string) =>
    onProgress({ added, current: done.size, label, total: cards.length });

  /**
   * Which card each `idMetacard` was asked for, so no two names ask for the same
   * one. Two deck lines can resolve to a single Cardmarket card — a name it
   * doesn't know resolved to the nearest one it does, a face of a two-faced card
   * named as its own card — and the second ask wouldn't be refused, it would
   * raise the first one's amount to two.
   */
  const askedFor = new Map<string, string>();

  // Read once for the whole run, and shared with the single-add button in
  // WantsPanel — the two used to hardcode different condition floors, so the same
  // card landed on the list differently depending on which one put it there.
  const wantDefaults = readWantDefaults();

  for (const card of cards) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!(await holdsLock())) throw new LostLock();
    const key = cardKey(card.name);
    if (done.has(key)) continue;
    report(card.name);
    try {
      const ids = await findProductForCard(card.name, signal);
      const clash = ids && askedFor.get(ids.idMetacard);
      if (!ids) {
        note(card.name, 'no single by that name on Cardmarket');
      } else if (clash) {
        note(card.name, `Cardmarket has this as the same card as “${clash}”`);
      } else {
        askedFor.set(ids.idMetacard, card.name);
        await pace(signal);
        const r = await addWant(
          {
            amount: card.need,
            idMetacard: ids.idMetacard,
            idWantsList: listId,
            ...wantDefaults,
            // An explicit per-task condition still wins over the stored default.
            ...(task.params?.minCondition == null
              ? {}
              : { minCondition: task.params.minCondition }),
          },
          token,
        );
        if (r.ok) added++;
        else note(card.name, r.message);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      const message = err instanceof Error ? err.message : String(err);
      // A challenge won't clear itself, and grinding on would just log a miss
      // against every remaining card. Keep the checkpoint and hand it up: the
      // runner puts the check in front of the user and resumes here afterwards.
      if (needsVerification(message)) {
        save();
        throw err;
      }
      note(card.name, message);
    }
    done.add(key);
    save();
    report(card.name);
    if (done.size < cards.length) await pace(signal);
  }

  // What actually landed, asked of the list rather than inferred from the
  // replies. Cardmarket answers an add in more than one shape — a card added
  // "successfully, but some information might have been lost" reads like a
  // refusal, and a shape we don't recognise reads like nothing at all — so the
  // list itself is the only honest source for the count and for which cards to
  // report as missed.
  const landed = await listWantKeys(listId, signal);
  const missed = cards.filter(c => !landed.has(wantKey(c.name)));
  added = cards.length - missed.length;
  errors.length = 0;
  for (const card of missed) {
    errors.push(`${card.name}: ${notes.get(card.name) || 'didn’t make it onto the list'}`);
  }
  save();

  // The list just changed, so refresh the index rather than patching it by hand.
  if (added > 0) {
    wantsStore.markQueued();
    taskQueue.enqueue('syncWants', 'Sync want lists');
  }
  return summary(missed.length);
};

// --- the runner ------------------------------------------------------------
/**
 * Work the queue until it's empty. At most one of these runs at a time.
 *
 * `pumping` is claimed before the first `await` and not a line later, because the
 * queue is kicked from several places at once — a click enqueues, the storage
 * listener sees that write, the watchdog ticks — and `tryClaimLock` waits 120ms
 * to settle. Claiming after that wait let every caller in the window through, and
 * since they all share this page's `runnerId`, each confirmed the lock as its
 * own: two loops down the same card list, one lock, two of every card on the want
 * list.
 */
const pump = async () => {
  if (pumping) return;
  if (!isPageRunner()) return; // an older copy of this module owns the page
  pumping = true;
  try {
    if (!(await tryClaimLock())) return; // another tab is the runner
    startHeartbeat();
    for (;;) {
      if (!isPageRunner()) break; // superseded by a newer copy of this module
      if (!(await ownsLock())) break;
      await loadFromStorage(); // pick up newly enqueued tasks (any tab)
      // A leftover 'running' task means a previous runner was interrupted; retry.
      const next = tasks.find(t => t.status === 'queued' || t.status === 'running');
      if (!next) break;

      currentAbort = new AbortController();
      currentTaskId = next.id;
      updateTask(next.id, {
        error: undefined,
        startedAt: next.startedAt ?? Date.now(),
        status: 'running',
      });
      await refreshLock();

      const onProgress = (p: TaskProgress) => {
        updateTask(next.id, { progress: p });
        void refreshLock();
      };
      const checkpoint = (resume: NonNullable<Task['resume']>) => {
        // Persist onto the freshest copy of the task so a checkpoint survives
        // navigation (the reclaiming page reads it back from storage).
        next.resume = resume;
        updateTask(next.id, { resume });
      };

      try {
        let summary = '';
        if (next.type === 'syncWants')
          summary = await handleSyncWants(onProgress, currentAbort.signal);
        else if (next.type === 'syncPurchases')
          summary = await handleSyncPurchases(onProgress, currentAbort.signal);
        else if (next.type === 'cleanupWants')
          summary = await handleCleanupWants(next, onProgress, currentAbort.signal, checkpoint);
        else if (next.type === 'deckWants')
          summary = await handleDeckWants(next, onProgress, currentAbort.signal, checkpoint);
        updateTask(next.id, { finishedAt: Date.now(), progress: null, status: 'done', summary });
      } catch (err) {
        // Handed over mid-task: the task keeps its status and checkpoint, and
        // the tab that took the lock carries on from there.
        if (err instanceof LostLock) break;
        const aborted = err instanceof DOMException && err.name === 'AbortError';
        const message = errorMessage(err);

        // Cloudflare wants a human. There's nothing to fix and nothing to retry
        // from here, so the task keeps its place and its checkpoint while the
        // page reloads into the check — which is the one thing that gets the user
        // somewhere. It resumes when the site comes back.
        if (needsVerification(message)) {
          if (next.type === 'syncWants') wantsStore.abortSync();
          if (next.type === 'syncPurchases') purchaseStore.abortSync();
          updateTask(next.id, { progress: null, status: 'queued' });
          if (!(await askForVerification(message))) {
            updateTask(next.id, {
              error: VERIFY_HELP,
              finishedAt: Date.now(),
              progress: null,
              status: 'error',
            });
          }
          // Either the page is on its way out, or the site is still refusing us:
          // no sense working the rest of the queue against it.
          break;
        }

        // Let the data stores settle their display status back.
        if (next.type === 'syncWants') {
          if (aborted) wantsStore.abortSync();
          else wantsStore.failSync(message);
        }
        if (next.type === 'syncPurchases') {
          if (aborted) purchaseStore.abortSync();
          else purchaseStore.failSync(message);
        }
        if (aborted) {
          // User cancelled → drop it from the queue.
          setTasks(tasks.filter(t => t.id !== next.id));
        } else {
          updateTask(next.id, {
            error: message,
            finishedAt: Date.now(),
            progress: null,
            status: 'error',
          });
        }
      } finally {
        currentAbort = null;
        currentTaskId = null;
      }
      pruneFinished();
    }
  } finally {
    stopHeartbeat();
    pumping = false;
    await releaseLock();
  }
};

const errorMessage = (err: unknown): string => {
  // If the extension was reloaded/updated, this page's script lost its context
  // and every fetch/chrome call fails — a page reload is the only fix.
  if (!chrome.runtime?.id) return 'Extension was reloaded — refresh the page and retry.';
  const raw = err instanceof Error ? err.message : String(err);
  if (err instanceof TypeError && /failed to fetch/i.test(raw)) {
    return 'Network request failed — check your connection and retry.';
  }
  return raw;
};

let initialized = false;

export const taskQueue = {
  /** Cancel a task: abort it if running, else drop it from the queue. */
  cancel(id: string) {
    if (currentTaskId === id && currentAbort) {
      currentAbort.abort();
      return;
    }
    setTasks(tasks.filter(t => t.id !== id));
  },

  /** Remove all finished (done/error) tasks from the list. */
  clearFinished() {
    setTasks(tasks.filter(t => t.status === 'queued' || t.status === 'running'));
  },

  /** Add a task and kick the runner. Returns the new task id. */
  enqueue(type: TaskType, label: string, params?: Task['params']): string {
    // Collapse duplicate pending requests so a double-click can't stack them
    // (and, for deck → want list, can't create the same list twice): syncs
    // dedupe by type, cleanup by the order, want-list fills by the target list.
    const sameTarget = (t: Task): boolean => {
      if (type === 'cleanupWants') return t.params?.shipmentId === params?.shipmentId;
      if (type === 'deckWants') {
        return (t.params?.listId ?? t.params?.listName) === (params?.listId ?? params?.listName);
      }
      return true;
    };
    const existing = tasks.find(
      t => t.type === type && (t.status === 'queued' || t.status === 'running') && sameTarget(t),
    );
    if (existing) {
      void pump();
      return existing.id;
    }
    const id = `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    setTasks([
      ...tasks,
      { createdAt: Date.now(), id, label, params, progress: null, status: 'queued', type },
    ]);
    void pump();
    return id;
  },

  getSnapshot(): Task[] {
    return tasks;
  },

  /** Wire up storage sync + start processing. Safe to call multiple times. */
  init() {
    if (initialized) return;
    initialized = true;

    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes[QUEUE_KEY]) return;
        // Only mirror external changes when we're not the active runner (the
        // runner is the source of truth and writes on every step).
        if (!pumping) {
          const next = changes[QUEUE_KEY].newValue as Task[] | undefined;
          tasks = Array.isArray(next) ? next : [];
          emit();
          if (tasks.some(t => t.status === 'queued' || t.status === 'running')) void pump();
        }
      });
    } catch {
      // Orphaned content script (context invalidated) — a refresh reconnects.
    }

    window.addEventListener('pagehide', () => {
      // Best-effort: free the lock so the next page can start immediately.
      // (If this doesn't flush, the stale-lock timeout + watchdog cover it.)
      stopHeartbeat();
      void releaseLock();
    });

    // Watchdog: if there's pending work and we're not the active runner, keep
    // trying to take over. This is what recovers a task whose runner tab
    // navigated away (its lock goes stale and a live page reclaims it). Bail out
    // if the extension context was invalidated (every chrome.* call would throw).
    setInterval(() => {
      if (!chrome.runtime?.id || !isPageRunner()) return;
      if (!pumping && tasks.some(t => t.status === 'queued' || t.status === 'running')) {
        void pump();
      }
    }, WATCHDOG_MS);

    void loadFromStorage().then(() => {
      if (tasks.some(t => t.status === 'queued' || t.status === 'running')) void pump();
    });
  },

  /**
   * Put a failed task back in the queue, keeping its checkpoint — so a run that
   * stopped on a verification page carries on from the card it stopped at,
   * rather than making a second want list and re-adding what it already added.
   */
  retry(id: string) {
    const task = tasks.find(t => t.id === id);
    if (!task || task.status !== 'error') return;
    updateTask(id, { error: undefined, finishedAt: undefined, status: 'queued' });
    void pump();
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
