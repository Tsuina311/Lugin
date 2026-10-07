// Tags a person wrote themselves, kept across sessions.
//
// The extension stores them in chrome.storage so they survive a Cardmarket
// reload. The phone has no extension storage, so it uses localStorage. A tag
// that was only typed for one search is never written here.

import { useSyncExternalStore } from 'react';

export interface CustomDeckTag {
  id: string;
  label: string;
  query: string;
}

const STORAGE_KEY = 'lugin:customDeckTags';
const EMPTY: readonly CustomDeckTag[] = [];

let tags: readonly CustomDeckTag[] = EMPTY;
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) listener();
};

const parse = (raw: unknown): CustomDeckTag[] => {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id : '';
    const label = typeof row.label === 'string' ? row.label.trim() : '';
    const query = typeof row.query === 'string' ? row.query.trim() : '';
    if (!id || !label || !query) return [];
    return [{ id, label, query }];
  });
};

const chromeStore = (): chrome.storage.StorageArea | null => {
  if (typeof chrome === 'undefined') return null;
  return chrome.storage?.local ?? null;
};

const readLocal = (): CustomDeckTag[] => {
  try {
    return parse(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return [];
  }
};

let started = false;
/** A save landed before the stored list came back, so that late read must not replace it. */
let wrote = false;

const ensureLoaded = (): void => {
  if (started || typeof window === 'undefined') return;
  started = true;
  const store = chromeStore();
  if (store) {
    void store.get(STORAGE_KEY).then(stored => {
      if (wrote) return;
      tags = parse(stored[STORAGE_KEY]);
      emit();
    });
    return;
  }
  tags = readLocal();
  emit();
};

const persist = (next: readonly CustomDeckTag[]): void => {
  wrote = true;
  tags = next;
  emit();
  const store = chromeStore();
  if (store) {
    void store.set({ [STORAGE_KEY]: next });
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // The tag still works for this session.
  }
};

export const saveCustomDeckTag = (label: string, query: string): CustomDeckTag | null => {
  const trimmed = label.trim().replace(/\s+/g, ' ');
  const q = query.trim();
  if (!trimmed || !q) return null;
  const existing = tags.find(tag => tag.query === q);
  if (existing) return existing;
  const tag: CustomDeckTag = { id: `custom-${Date.now().toString(36)}`, label: trimmed, query: q };
  persist([...tags, tag]);
  return tag;
};

export const forgetCustomDeckTag = (id: string): void => {
  persist(tags.filter(tag => tag.id !== id));
};

const subscribe = (listener: () => void): (() => void) => {
  ensureLoaded();
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const snapshot = (): readonly CustomDeckTag[] => tags;

export const useCustomDeckTags = (): readonly CustomDeckTag[] =>
  useSyncExternalStore(subscribe, snapshot, () => EMPTY);
