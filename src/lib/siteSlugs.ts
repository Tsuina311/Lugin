// URL slugs for outbound deck links.
//
// Same rules as edhrecSlug / the Goldfish slugify. Kept here so native screens
// can build a link without loading the browser fetchers those modules own.

import { frontFaceName } from './cardName';

const fold = (name: string): string =>
  frontFaceName(name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** EDHREC commander page slug. Partner names are joined in the given order. */
export const commanderSlug = (names: string[]): string =>
  names
    .map(name =>
      fold(name)
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .filter(Boolean)
    .join('-');

/** MTGGoldfish commander archetype slug, including the commander- prefix. */
export const goldfishArchetypeSlug = (commanderNames: string[]): string => {
  const cmd = commanderNames
    .map(name =>
      fold(name)
        .replace(/['’]s\b/g, '-s')
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    )
    .filter(Boolean)
    .join('-');
  return cmd ? `commander-${cmd}` : '';
};
