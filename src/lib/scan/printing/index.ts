// Build + query the offline PrintingIndex.

import type { CollectorParts } from '../parseCollector';
import { normalizeSetCode } from '../parseCollector';

import { collectorLookupKeys, printingKey } from './normalize';
import type {
  PrintingIndex,
  PrintingIndexData,
  PrintingIndexEntry,
  PrintingLookupHit,
} from './types';
import { PRINTING_INDEX_VERSION } from './types';

export type {
  PrintingIndex,
  PrintingIndexData,
  PrintingIndexEntry,
  PrintingLookupHit,
} from './types';
export { PRINTING_INDEX_VERSION } from './types';
export {
  collectorLookupForms,
  collectorLookupKeys,
  normalizeCollectorNumberOcr,
  printingKey,
} from './normalize';

export const PRINTING_INDEX_MIN_PRODUCTION_ENTRIES = 10_000;

export const buildPrintingIndex = (data: PrintingIndexData): PrintingIndex => {
  const byKey = new Map<string, number[]>();
  data.entries.forEach((e, i) => {
    const key = printingKey(e.setCode, e.collectorNumber);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(i);
    else byKey.set(key, [i]);
    // Also index stripped leading-zero form when different.
    const stripped = e.collectorNumber.replace(/^0+/, '') || '0';
    if (stripped.toLowerCase() !== e.collectorNumber.toLowerCase()) {
      const k2 = printingKey(e.setCode, stripped);
      const b2 = byKey.get(k2);
      if (b2) {
        if (!b2.includes(i)) b2.push(i);
      } else byKey.set(k2, [i]);
    }
  });
  return {
    byKey,
    entries: data.entries,
    generated: data.generated ?? null,
    recordCount: data.entries.length,
    version: data.version,
  };
};

export const lookupPrinting = (
  index: PrintingIndex | null | undefined,
  parts: CollectorParts,
): PrintingLookupHit | null => {
  if (!index || !parts.setCode || !parts.collectorNumber) return null;
  const keys = collectorLookupKeys(parts);
  if (!keys.length) return null;
  const seen = new Set<number>();
  const candidates: PrintingIndexEntry[] = [];
  for (const key of keys) {
    const ids = index.byKey.get(key);
    if (!ids) continue;
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      candidates.push(index.entries[id]);
    }
  }
  if (!candidates.length) return null;
  return { candidates, key: keys[0], variantsTried: keys.length };
};

/** Unique oracle among candidates? */
export const uniqueOracle = (
  hit: PrintingLookupHit,
): PrintingIndexEntry | null => {
  const oracles = new Set(hit.candidates.map(c => c.oracleId));
  if (oracles.size !== 1) return null;
  // Prefer English when multiple langs share the oracle.
  return (
    hit.candidates.find(c => c.lang === 'en') ??
    hit.candidates[0] ??
    null
  );
};

/** Unique scryfall id (exact printing) among candidates. */
export const uniquePrinting = (
  hit: PrintingLookupHit,
): PrintingIndexEntry | null => {
  const ids = new Set(hit.candidates.map(c => c.scryfallId));
  if (ids.size !== 1) return null;
  return hit.candidates[0] ?? null;
};

/** Map index entry → resolve.ts-compatible shape. */
export const entryToScryfallPrinting = (e: PrintingIndexEntry) => ({
  collectorNumber: e.collectorNumber,
  finishes: e.finishes.length ? e.finishes : ['nonfoil'],
  id: e.scryfallId,
  name: e.name,
  setCode: e.setCode,
  setName: e.setName ?? e.setCode.toUpperCase(),
});

export const validatePrintingIndexData = (
  raw: unknown,
  opts: { minEntries?: number } = {},
): { data: PrintingIndexData; reason?: undefined } | { data?: undefined; reason: string } => {
  if (!raw || typeof raw !== 'object') return { reason: 'printing index is not an object' };
  const body = raw as Partial<PrintingIndexData>;
  if (!Array.isArray(body.entries) || !body.entries.length) {
    return { reason: 'printing index has no entries' };
  }
  if (typeof body.version !== 'number' || body.version < PRINTING_INDEX_VERSION) {
    return { reason: `printing index version ${String(body.version)} unsupported` };
  }
  const min = opts.minEntries ?? PRINTING_INDEX_MIN_PRODUCTION_ENTRIES;
  if (body.entries.length < min) {
    return {
      reason: `printing index has only ${body.entries.length} entries (min ${min})`,
    };
  }
  const sample = body.entries[0];
  if (
    !sample ||
    typeof sample.setCode !== 'string' ||
    typeof sample.collectorNumber !== 'string' ||
    typeof sample.scryfallId !== 'string' ||
    typeof sample.oracleId !== 'string' ||
    typeof sample.name !== 'string'
  ) {
    return { reason: 'printing index entries missing required fields' };
  }
  return { data: body as PrintingIndexData };
};

/** Soft set-code OCR fix from known index keys (optional). */
export const suggestSetFromIndex = (
  _index: PrintingIndex,
  rawSet: string | undefined,
): string | undefined => {
  const set = normalizeSetCode(rawSet) ?? rawSet?.toUpperCase();
  if (!set) return undefined;
  return set.toLowerCase();
};

/** Local substitute for fetchPrintingsByName when the PrintingIndex is loaded. */
export const listPrintingsByName = (
  index: PrintingIndex | null | undefined,
  name: string,
): PrintingIndexEntry[] => {
  if (!index || !name.trim()) return [];
  const needle = name.trim().toLowerCase();
  return index.entries.filter(e => e.name.toLowerCase() === needle);
};
