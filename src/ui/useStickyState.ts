// React state that survives a Cardmarket page navigation.
//
// Cardmarket renders every page on the server, so following a link tears down the
// content script and mounts a fresh one. Any filter held in plain `useState` is
// therefore gone the moment you click a card — which is precisely the complaint
// people make about Cardmarket's own filter panel, faithfully reproduced by ours.
//
// `localStorage` of the page origin, not `chrome.storage`: reads have to be
// synchronous. An async read would render the unfiltered list for a frame and then
// snap, and on the "apply to page" path it would briefly show the very rows the
// user asked to hide. The overlay already keeps theme, dock side and panel width
// here for the same reason.
//
// Everything expires. A filter is a statement about what you are shopping for
// right now, and restoring last week's on a fresh page would hide most of it with
// no visible cause — the user sees an empty list and concludes the page is broken.
// Surviving a navigation is the goal; surviving a night's sleep is a trap.

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

/**
 * How long a remembered filter stays valid.
 *
 * Long enough to cover an evening of browsing a seller's stock, short enough that
 * tomorrow starts clean.
 */
export const STICKY_TTL_MS = 6 * 60 * 60 * 1000;

interface Stored<T> {
  /** When it was written, so it can go stale. */
  at: number;
  value: T;
}

const read = <T>(key: string, ttlMs: number): T | undefined => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const held = JSON.parse(raw) as Partial<Stored<T>>;
    if (typeof held?.at !== 'number' || held.value === undefined) return undefined;
    if (Date.now() - held.at > ttlMs) {
      localStorage.removeItem(key);
      return undefined;
    }
    return held.value;
  } catch {
    // Unparseable or unavailable storage costs the preference, not the panel.
    return undefined;
  }
};

const write = <T>(key: string, value: T): void => {
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), value } satisfies Stored<T>));
  } catch {
    // Quota or a privacy mode that denies storage. Not worth telling anyone about.
  }
};

const clear = (key: string): void => {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
};

/**
 * Widen the literal TypeScript infers from a default.
 *
 * `useStickyValue('k', '')` should be a `string` cell, not a cell that can only
 * ever hold `''` — which is what a generic constrained to a primitive union
 * infers on its own.
 */
type Widen<T> = T extends boolean ? boolean : T extends number ? number : T extends string ? string : T;

/**
 * `useState` that remembers a JSON-serializable value across page loads.
 *
 * Writing a value equal to `fallback` clears the entry instead of storing it, so
 * an untouched or reset filter leaves nothing behind to resurrect.
 */
export const useStickyValue = <T extends boolean | number | string>(
  key: string,
  fallback: T,
  ttlMs = STICKY_TTL_MS,
): [Widen<T>, Dispatch<SetStateAction<Widen<T>>>] => {
  type Value = Widen<T>;
  const [value, setValue] = useState<Value>(
    () => read<Value>(key, ttlMs) ?? (fallback as Value),
  );

  useEffect(() => {
    if ((value as unknown) === (fallback as unknown)) clear(key);
    else write(key, value);
  }, [key, value, fallback]);

  return [value, setValue];
};

/**
 * The same, for the `Set`s the filter panels use for multi-select.
 *
 * A `Set` is stored as a sorted array so an unchanged selection produces
 * unchanged bytes, which keeps the write a no-op in practice.
 */
export const useStickySet = <T extends number | string>(
  key: string,
  ttlMs = STICKY_TTL_MS,
): [Set<T>, Dispatch<SetStateAction<Set<T>>>] => {
  const [value, setValue] = useState<Set<T>>(() => {
    const held = read<T[]>(key, ttlMs);
    return new Set(Array.isArray(held) ? held : []);
  });

  useEffect(() => {
    if (value.size === 0) clear(key);
    else write(key, [...value].sort());
  }, [key, value]);

  return [value, setValue];
};
