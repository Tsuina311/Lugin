// Offline artwork (+ optional text) index for the continuous scanner.
//
// Same Cache-API bargain as cardIndexStore: load on first scan, keep for weeks,
// never ship full card images — only compact descriptors.

import {
  createArtworkMatcher,
  type ArtworkMatcher,
} from '@/lib/scan/artwork/match';
import type { ArtworkIndexData } from '@/lib/scan/artwork/types';
import type { TextIndexData } from '@/lib/scan/text/evidence';

export const ART_INDEX_CACHE = 'lugin-art-index';
const URL_PATH = 'art-index.json';
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const url = (): string => `${import.meta.env.BASE_URL}${URL_PATH}`;

interface Held {
  art: ArtworkIndexData;
  fetchedAt: number;
  text?: TextIndexData;
}

let memo: Promise<{
  art: ArtworkIndexData | null;
  matcher: ArtworkMatcher;
  text: TextIndexData | null;
}> | null = null;

const held = async (): Promise<Held | null> => {
  if (typeof caches === 'undefined') return null;
  try {
    const hit = await (await caches.open(ART_INDEX_CACHE)).match(url());
    if (!hit) return null;
    const body = (await hit.json()) as Partial<Held>;
    if (!body.art?.entries?.length || !body.fetchedAt) return null;
    if (body.art.entries.length < 500) return null;
    return { art: body.art, fetchedAt: body.fetchedAt, text: body.text };
  } catch {
    return null;
  }
};

const keep = async (payload: Held): Promise<void> => {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(ART_INDEX_CACHE);
    await cache.put(
      url(),
      new Response(JSON.stringify(payload), {
        headers: { 'content-type': 'application/json' },
      }),
    );
  } catch {
    // offline copy is best-effort
  }
};

const download = async (): Promise<Held | null> => {
  const res = await fetch(url(), { cache: 'no-cache' });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    art?: ArtworkIndexData;
    text?: TextIndexData;
    entries?: ArtworkIndexData['entries'];
    version?: number;
  };
  // Accept either wrapped { art, text } or a bare ArtworkIndexData.
  const art: ArtworkIndexData | null = body.art?.entries
    ? body.art
    : body.entries
      ? { entries: body.entries, version: body.version ?? 1 }
      : null;
  // Fixture indexes (~20) must not ship as production — they invent wrong IDs.
  if (!art?.entries?.length || art.entries.length < 500) {
    console.warn(
      `[lugin] refusing art-index.json with ${art?.entries?.length ?? 0} entries (need ≥500)`,
    );
    return null;
  }
  return { art, fetchedAt: Date.now(), text: body.text };
};

export const loadArtworkIndex = () => {
  if (!memo) {
    memo = (async () => {
      const cached = await held();
      if (cached && Date.now() - cached.fetchedAt < MAX_AGE_MS) {
        return {
          art: cached.art,
          matcher: createArtworkMatcher(cached.art),
          text: cached.text ?? null,
        };
      }
      const fresh = await download();
      if (fresh) {
        void keep(fresh);
        return {
          art: fresh.art,
          matcher: createArtworkMatcher(fresh.art),
          text: fresh.text ?? null,
        };
      }
      if (cached) {
        return {
          art: cached.art,
          matcher: createArtworkMatcher(cached.art),
          text: cached.text ?? null,
        };
      }
      return {
        art: null,
        matcher: createArtworkMatcher(null),
        text: null,
      };
    })();
  }
  return memo;
};
