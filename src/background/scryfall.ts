import { cardKey, frontFaceName, looseKey } from '@/lib/cardName';
import type { CardMetadata, CommanderInfo, CommanderPairing } from '@/lib/mtg';

// Scryfall client (background worker). Looks up Magic card metadata by name via
// the batch "collection" endpoint, caching results in chrome.storage.local so
// repeat lookups are free and we stay a good API citizen.
//
// Scryfall asks callers to keep request volume reasonable; lookups here are
// user-initiated (opening a list), batched 75/at-a-time, cached, and spaced out.

const COLLECTION_URL = 'https://api.scryfall.com/cards/collection';
const BATCH_SIZE = 75; // Scryfall's max identifiers per request.
const BATCH_DELAY_MS = 100; // polite spacing between batches.
const CACHE_PREFIX = 'sf:';
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days.
// "Scryfall doesn't know this name" is worth remembering too, or every pass over
// a list containing one asks again — and a want list full of Cardmarket-only
// spellings turns into a request per repaint. Kept short: the answer can change
// when a set is released, or when we get better at spelling the name.
const MISS_TTL_MS = 24 * 60 * 60 * 1000; // 1 day.

/**
 * Shape of what we store per card. Bump it whenever `CardMetadata` gains a field
 * derived at fetch time — entries written before it exist would otherwise keep
 * answering "no idea" for a month, and callers can't tell that apart from a
 * genuine no. Old entries are simply treated as misses and refetched (the same
 * keys get overwritten, so nothing is left behind).
 *   2 — added `commander` (partner rules), derived from oracle text.
 *   3 — added `cardmarketId`, so cards can be named to Cardmarket exactly.
 */
const CACHE_SCHEMA = 3;

const SUPERTYPES = new Set([
  'Legendary',
  'Basic',
  'Snow',
  'World',
  'Ongoing',
  'Host',
  'Elite',
  'Token',
]);

interface CachedEntry {
  cachedAt: number;
  meta: CardMetadata;
  /** `CACHE_SCHEMA` at write time; absent on entries from before versioning. */
  v?: number;
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Split a Scryfall type_line ("Legendary Creature — Elf Druid") into parts. */
const parseTypeLine = (
  typeLine: string,
): Pick<CardMetadata, 'supertypes' | 'types' | 'subtypes'> => {
  const supertypes = new Set<string>();
  const types = new Set<string>();
  const subtypes = new Set<string>();

  // Multi-face cards join faces with " // "; process each face.
  for (const face of typeLine.split('//')) {
    const [left, right] = face.split('—'); // em dash separates types / subtypes.
    left
      ?.trim()
      .split(/\s+/)
      .filter(Boolean)
      .forEach(word => (SUPERTYPES.has(word) ? supertypes.add(word) : types.add(word)));
    right
      ?.trim()
      .split(/\s+/)
      .filter(Boolean)
      .forEach(word => subtypes.add(word));
  }

  return {
    subtypes: [...subtypes],
    supertypes: [...supertypes],
    types: [...types],
  };
};

/**
 * Named partner variants Scryfall words as "Partner—<variant>" even though they
 * aren't grouped Partner abilities ("Partner—Survivors" is; "Partner—Friends
 * forever" isn't, and pairs only with other Friends forever cards). Matched
 * lowercase against the text after the dash.
 */
const PARTNER_VARIANT = /^(?:friends forever|doctor's companion|choose a background)$/;

/**
 * Derive Commander-format info (can it be a commander, and how does it partner)
 * from the oracle text + type line. We compute this once at fetch time and store
 * only the compact result, so the on-disk cache stays small (no oracle text).
 */
const detectCommander = (
  oracle: string,
  parts: Pick<CardMetadata, 'subtypes' | 'supertypes' | 'types'>,
): CommanderInfo | undefined => {
  const text = oracle.toLowerCase().replace(/[’']/g, '\'');
  const isLegendary = parts.supertypes.includes('Legendary');
  const isCreature = parts.types.includes('Creature');
  const canBeCommander = (isLegendary && isCreature) || /can be your commander/.test(text);

  const pairings: CommanderPairing[] = [];
  let partnerWith: string | undefined;
  let partnerGroup: string | undefined;

  const withMatch = text.match(/partner with ([^\n(.]+)/);
  const groupMatch = text.match(/partner\s*[—-]\s*([^\n(.]+)/);
  if (withMatch) {
    partnerWith = withMatch[1].trim();
    pairings.push('partnerWith');
  }
  if (groupMatch && !PARTNER_VARIANT.test(groupMatch[1].trim())) {
    partnerGroup = groupMatch[1].trim();
    pairings.push('partner');
  }
  // Plain "Partner" (not "Partner with" / grouped "Partner —").
  if (!withMatch && !groupMatch && /(^|\n|\.)\s*partner\b/.test(text)) pairings.push('partner');
  if (/friends forever/.test(text)) pairings.push('friendsForever');
  if (/choose a background/.test(text)) pairings.push('chooseBackground');
  if (/doctor's companion/.test(text)) pairings.push('doctorsCompanion');

  // A "Time Lord Doctor" (exactly those subtypes) is the Doctor half.
  const sub = new Set(parts.subtypes);
  if (sub.has('Doctor') && sub.has('Time') && sub.has('Lord') && parts.subtypes.length === 3) {
    pairings.push('doctor');
  }
  // A legendary Background enchantment is the "choose a Background" half.
  if (parts.subtypes.includes('Background')) pairings.push('background');

  if (!isLegendary && pairings.length === 0 && !canBeCommander) return undefined;
  return { canBeCommander, pairings, partnerGroup, partnerWith };
};

/** Map a raw Scryfall card object into our CardMetadata. */
const toMetadata = (card: Record<string, unknown>): CardMetadata => {
  const typeLine = typeof card.type_line === 'string' ? card.type_line : '';
  const images = card.image_uris as Record<string, string> | undefined;
  const faces = card.card_faces as Array<Record<string, unknown>> | undefined;
  const faceImage = faces?.[0]?.image_uris as Record<string, string> | undefined;

  // Physically two-sided cards expose per-face image_uris (transform, modal DFC,
  // reversible…). Split/adventure/aftermath share one image on `card.image_uris`
  // and their faces carry no image_uris, so this naturally excludes them.
  const faceImages = (faces ?? [])
    .map(f => {
      const fi = f.image_uris as Record<string, string> | undefined;
      return fi?.normal ?? fi?.large ?? fi?.small;
    })
    .filter((u): u is string => typeof u === 'string');

  // Combine oracle text across faces so partner abilities on either face are
  // seen (used only to derive `commander`; not stored).
  const oracle = [
    typeof card.oracle_text === 'string' ? card.oracle_text : '',
    ...(faces ?? []).map(f => (typeof f.oracle_text === 'string' ? f.oracle_text : '')),
  ].join('\n');
  const parts = parseTypeLine(typeLine);

  return {
    found: true,
    name: typeof card.name === 'string' ? card.name : '',
    typeLine,
    ...parts,
    cardmarketId: typeof card.cardmarket_id === 'number' ? card.cardmarket_id : undefined,
    cmc: typeof card.cmc === 'number' ? card.cmc : undefined,
    colorIdentity: Array.isArray(card.color_identity) ? (card.color_identity as string[]) : [],
    colors: Array.isArray(card.colors) ? (card.colors as string[]) : [],
    commander: detectCommander(oracle, parts),
    faceImages: faceImages.length >= 2 ? faceImages : undefined,
    imageUrl: images?.normal ?? images?.small ?? faceImage?.normal ?? faceImage?.small,
    keywords: Array.isArray(card.keywords) ? (card.keywords as string[]) : [],
    manaCost: typeof card.mana_cost === 'string' ? card.mana_cost : undefined,
    rarity: typeof card.rarity === 'string' ? card.rarity : undefined,
    scryfallUri: typeof card.scryfall_uri === 'string' ? card.scryfall_uri : undefined,
    // NOTE: we deliberately don't keep `oracle_text` — it's by far the heaviest
    // field and nothing in the UI uses it, so dropping it keeps the on-disk cache
    // small (a few hundred bytes/card) and fast to read back.
  };
};

const notFound = (name: string): CardMetadata => ({
  colorIdentity: [],
  colors: [],
  found: false,
  keywords: [],
  name,
  subtypes: [],
  supertypes: [],
  types: [],
});

const readCache = async (keys: string[]): Promise<Map<string, CardMetadata>> => {
  const found = new Map<string, CardMetadata>();
  const stored = await chrome.storage.local.get(keys);
  const now = Date.now();
  for (const [key, value] of Object.entries(stored)) {
    const entry = value as CachedEntry | undefined;
    if (!entry?.meta || entry.v !== CACHE_SCHEMA) continue;
    const ttl = entry.meta.found ? CACHE_TTL_MS : MISS_TTL_MS;
    if (now - entry.cachedAt < ttl) found.set(key.slice(CACHE_PREFIX.length), entry.meta);
  }
  return found;
};

/**
 * Store metadata under the given keys. The key is passed rather than derived,
 * because a card also has to be findable under the name we were asked for: look
 * "Lim-Dûl's Vault" up under Scryfall's spelling only and the next lookup misses
 * the cache and fetches it again, every time, forever.
 */
const writeCache = async (entries: readonly [string, CardMetadata][]): Promise<void> => {
  const payload: Record<string, CachedEntry> = {};
  const now = Date.now();
  for (const [key, meta] of entries) {
    if (key) payload[CACHE_PREFIX + key] = { cachedAt: now, meta, v: CACHE_SCHEMA };
  }
  if (Object.keys(payload).length) await chrome.storage.local.set(payload);
};

/**
 * Cache-only lookup: return metadata for the given names that's already in
 * chrome.storage (fresh within the TTL), WITHOUT any network request. Lets the
 * UI preload previously-seen cards instantly and offline; unknown cards are
 * simply omitted (fetch them later with getCardMetadata).
 */
export const getCachedMetadata = async (rawNames: string[]): Promise<CardMetadata[]> => {
  const uniqueKeys = new Set<string>();
  for (const raw of rawNames) {
    const key = cardKey(raw);
    if (key) uniqueKeys.add(key);
  }
  if (uniqueKeys.size === 0) return [];
  const cached = await readCache([...uniqueKeys].map(n => CACHE_PREFIX + n));
  return [...cached.values()];
};

/**
 * Resolve metadata for a list of card names. Order of the returned array is not
 * guaranteed to match the input; callers should index by normalized name.
 */
export const getCardMetadata = async (rawNames: string[]): Promise<CardMetadata[]> => {
  // Dedupe by front-face key; keep the front-face name to query Scryfall with.
  const uniqueNames = new Map<string, string>(); // cardKey -> front-face name
  for (const raw of rawNames) {
    const key = cardKey(raw);
    if (key) uniqueNames.set(key, frontFaceName(raw));
  }

  const results = new Map<string, CardMetadata>();

  // 1) Serve what we can from cache.
  const cacheKeys = [...uniqueNames.keys()].map(n => CACHE_PREFIX + n);
  const cached = await readCache(cacheKeys);
  for (const [norm, meta] of cached) results.set(norm, meta);

  // 2) Fetch the misses in batches.
  const misses = [...uniqueNames.entries()].filter(([norm]) => !results.has(norm));
  const toCache: [string, CardMetadata][] = [];

  for (let i = 0; i < misses.length; i += BATCH_SIZE) {
    const chunk = misses.slice(i, i + BATCH_SIZE);
    const identifiers = chunk.map(([, frontFace]) => ({ name: frontFace }));

    const response = await fetch(COLLECTION_URL, {
      body: JSON.stringify({ identifiers }),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(`Scryfall responded ${response.status} ${response.statusText}`);
    }
    const json = (await response.json()) as { data?: Array<Record<string, unknown>> };
    for (const card of json.data ?? []) {
      const meta = toMetadata(card);
      toCache.push([cardKey(meta.name), meta]);
      results.set(cardKey(meta.name), meta);
    }

    if (i + BATCH_SIZE < misses.length) await sleep(BATCH_DELAY_MS);
  }

  // 3) Fill in anything Scryfall didn't recognize so callers get one entry each.
  // Scryfall answers with its own spelling, which can differ from what we asked
  // for in punctuation or accents ("Rider’s" vs "Rider's"). Those answers are
  // keyed under the canonical name, so before calling a name unrecognized we
  // look for it ignoring anything but letters and digits — otherwise we'd hand
  // back a bogus "not found" alongside the card we actually got.
  const looseKeys = new Map([...results].map(([key, meta]) => [looseKey(key), meta]));
  for (const [key, frontFace] of uniqueNames) {
    if (results.has(key)) continue;
    const meta = looseKeys.get(looseKey(key)) ?? notFound(frontFace);
    results.set(key, meta);
    toCache.push([key, meta]);
  }

  await writeCache(toCache);

  return [...results.values()];
};
