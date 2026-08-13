// The user's card collection, imported from a ManaBox (or similar) CSV export.
//
// We keep it in a ManaBox-shaped row model so re-export / interop stays easy,
// plus a derived `byKey` index (keyed by the same `cardKey` used everywhere) so
// we can answer "do I already own this card?" instantly while browsing
// Cardmarket — by name, and (later) by exact printing + foil.

import { cardKey, stripVersion } from './cardName';

/** One collection line — mirrors a ManaBox CSV row (fields optional/tolerant). */
export interface CollectionCard {
  collectorNumber?: string;
  condition?: string;
  foil: boolean;
  /** Cardmarket image URL of the exact printing (captured from a purchase row). */
  imageUrl?: string;
  language?: string;
  name: string;
  /**
   * Cardmarket product id of the exact printing (from purchase history). Pins
   * the printing even when we have no set code / collector number, so its image
   * resolves via Scryfall's `/cards/cardmarket/:id` instead of the default one.
   */
  productId?: string;
  quantity: number;
  rarity?: string;
  scryfallId?: string;
  setCode?: string;
  setName?: string;
  /**
   * Where this row came from: an uploaded file ('import', the default) or the
   * user's Cardmarket purchase history ('purchases'). Lets us re-sync one source
   * without disturbing or double-counting the other.
   */
  source?: 'import' | 'purchases';
}

/** Per-card rollup for quick "owned?" lookups. */
export interface CollectionSummary {
  foil: number;
  /** Display name (version suffix stripped). */
  name: string;
  nonfoil: number;
  /** Distinct printings (set + number + finish) owned. */
  printings: number;
  total: number;
}

/** What we persist + expose to the UI. */
export interface Collection {
  /** cardKey -> rollup. Rebuilt from `cards` on load (not persisted). */
  byKey: Record<string, CollectionSummary>;
  cards: CollectionCard[];
  format: 'manabox' | 'list';
  importedAt: number;
  /** Original filename, for display. */
  source: string;
  totalCards: number;
  uniqueCards: number;
}

/** The subset we actually store; `byKey` etc. are derived on load. */
export type StoredCollection = Pick<Collection, 'importedAt' | 'source' | 'format' | 'cards'>;

/** Split one CSV line, honoring double-quoted fields and escaped quotes. */
const splitCsvLine = (line: string): string[] => {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
};

const truthyFoil = new Set(['foil', 'etched', 'true', 'yes', '1']);

/**
 * Parse a collection file. Detects a ManaBox-style CSV (header row containing a
 * "Name" column) and maps columns by header name (order-independent). Falls back
 * to a plain deck list ("2 Lightning Bolt" / "2x …" / bare names).
 */
export const parseCollection = (
  text: string,
): { cards: CollectionCard[]; format: 'manabox' | 'list' } => {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length === 0) return { cards: [], format: 'list' };

  const header = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  const isCsv = lines[0].includes(',') && header.includes('name');

  if (isCsv) {
    const col = (...names: string[]) => {
      for (const n of names) {
        const i = header.indexOf(n);
        if (i >= 0) return i;
      }
      return -1;
    };
    const iName = col('name');
    const iSet = col('set code', 'set', 'setcode');
    const iSetName = col('set name', 'setname');
    const iNum = col('collector number', 'card number', 'number', 'collectornumber');
    const iFoil = col('foil', 'finish', 'printing');
    const iRarity = col('rarity');
    const iQty = col('quantity', 'count', 'qty');
    const iScry = col('scryfall id', 'scryfall_id', 'scryfallid');
    const iCond = col('condition');
    const iLang = col('language', 'lang');

    const at = (fields: string[], i: number) =>
      i >= 0 ? fields[i]?.trim() || undefined : undefined;

    const cards: CollectionCard[] = [];
    for (let r = 1; r < lines.length; r++) {
      const f = splitCsvLine(lines[r]);
      const name = at(f, iName);
      if (!name) continue;
      const foilRaw = (at(f, iFoil) ?? '').toLowerCase();
      const qty = iQty >= 0 ? parseInt(f[iQty] ?? '', 10) : 1;
      cards.push({
        collectorNumber: at(f, iNum),
        condition: at(f, iCond),
        foil: truthyFoil.has(foilRaw),
        language: at(f, iLang),
        name,
        quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
        rarity: at(f, iRarity),
        scryfallId: at(f, iScry),
        setCode: at(f, iSet),
        setName: at(f, iSetName),
      });
    }
    return { cards, format: 'manabox' };
  }

  // Fallback: simple deck list.
  const cards: CollectionCard[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*(\d+)\s*[xX]?\s+(.+?)\s*$/);
    if (m) cards.push({ foil: false, name: m[2].trim(), quantity: parseInt(m[1], 10) || 1 });
    else cards.push({ foil: false, name: line.trim(), quantity: 1 });
  }
  return { cards, format: 'list' };
};

/** Build the derived index (byKey rollup + totals) from parsed rows. */
export const buildCollection = (
  cards: CollectionCard[],
  source: string,
  format: 'manabox' | 'list',
  importedAt = Date.now(),
): Collection => {
  const byKey: Record<string, CollectionSummary> = {};
  const printings: Record<string, Set<string>> = {};
  let totalCards = 0;

  for (const c of cards) {
    const key = cardKey(c.name);
    if (!key) continue;
    totalCards += c.quantity;
    const s =
      byKey[key] ??
      (byKey[key] = { foil: 0, name: stripVersion(c.name), nonfoil: 0, printings: 0, total: 0 });
    s.total += c.quantity;
    if (c.foil) s.foil += c.quantity;
    else s.nonfoil += c.quantity;
    const pk = `${c.setCode ?? ''}|${c.collectorNumber ?? ''}|${c.productId ?? ''}|${c.foil ? 'f' : 'n'}`;
    (printings[key] ??= new Set()).add(pk);
  }
  for (const key of Object.keys(byKey)) byKey[key].printings = printings[key]?.size ?? 0;

  return {
    byKey,
    cards,
    format,
    importedAt,
    source,
    totalCards,
    uniqueCards: Object.keys(byKey).length,
  };
};
