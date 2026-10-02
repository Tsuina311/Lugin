import { compileTwoCardIndex } from './compile';
import { parseComboBundle } from './parse';
import type { ComboBundle } from './types';

const API = 'https://backend.commanderspellbook.com';
const PAGE = 100;

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export type ComboJsonGet = (url: string) => Promise<unknown>;

const fetchJson: ComboJsonGet = async url => {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Spellbook ${res.status}`);
  return res.json() as Promise<unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Download every two-card variant and compact it. One bad page throws, so the
 * caller can keep the previous cache instead of storing a partial index.
 */
export const downloadTwoCardIndex = async (getJson: ComboJsonGet = fetchJson): Promise<ComboBundle> => {
  const info = await getJson(`${API}/schema/?format=json`);
  const version = isRecord(info) && isRecord(info.info) ? info.info.version : undefined;
  if (typeof version !== 'string') throw new Error('Spellbook schema has no version');

  const variants: unknown[] = [];
  let url = `${API}/variants/?limit=${PAGE}&q=${encodeURIComponent('cards=2')}`;
  for (let guard = 0; url; guard += 1) {
    if (guard > 80) throw new Error('Spellbook pagination did not end');
    const body = await getJson(url);
    if (!isRecord(body) || !Array.isArray(body.results)) throw new Error('Spellbook page has no results');
    variants.push(...body.results);
    url = typeof body.next === 'string' ? body.next : '';
    if (url) await sleep(40);
  }
  return parseComboBundle(compileTwoCardIndex(variants, version));
};
