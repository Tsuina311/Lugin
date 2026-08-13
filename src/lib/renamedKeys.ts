// Carrying stored data across the rename from CME to Lugin.
//
// Every stored key was prefixed `cme:` and is now `lugin:`. Without this, an
// existing install would come back up looking factory-fresh: no collection, no
// decks, no want-list index — all still on disk, just under names nothing reads
// any more.
//
// It copies rather than moves. Leaving the old keys in place costs a little
// space and means that if any of this goes wrong, or a page is mid-load while
// it runs, the original data is still exactly where it was. Deleting them can
// happen in some later version, once it's clearly unnecessary.

const OLD = 'cme:';
const NEW = 'lugin:';

/** Set once the copy has been done, so the scan happens exactly one time. */
const DONE_KEY = 'lugin:renamed';

const renamed = (key: string): string => NEW + key.slice(OLD.length);

/**
 * Copy the extension's stored data to its new names.
 *
 * Reading every key is expensive when the collection is large, so the flag is
 * checked first: on all but one startup in this install's life, this is a
 * single tiny read.
 */
export const adoptRenamedKeys = async (): Promise<number> => {
  const flag = await chrome.storage.local.get(DONE_KEY);
  if (flag[DONE_KEY] === true) return 0;

  const all = await chrome.storage.local.get(null);
  const carry: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(all)) {
    // An already-present new key means this device has moved on: never let a
    // stale copy overwrite data written since.
    if (key.startsWith(OLD) && !(renamed(key) in all)) carry[renamed(key)] = value;
  }

  if (Object.keys(carry).length > 0) await chrome.storage.local.set(carry);
  await chrome.storage.local.set({ [DONE_KEY]: true });
  return Object.keys(carry).length;
};

/**
 * The same, for the preferences kept in the page's own storage.
 *
 * Synchronous on purpose: the overlay reads these while deciding how to render
 * itself, so this has to be finished before the first paint, not merely started.
 */
export const adoptRenamedPageKeys = (): void => {
  try {
    if (localStorage.getItem(DONE_KEY) === '1') return;
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key === null || !key.startsWith(OLD)) continue;
      const value = localStorage.getItem(key);
      if (value !== null && localStorage.getItem(renamed(key)) === null) {
        localStorage.setItem(renamed(key), value);
      }
    }
    localStorage.setItem(DONE_KEY, '1');
  } catch {
    // A page that denies storage has no preferences to carry over anyway.
  }
};
