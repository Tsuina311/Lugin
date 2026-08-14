// Resolve a scan to a Scryfall printing, then to a CollectionCard.

import type { FoilHint } from './foil';

import type { CollectionCard } from '@/lib/collection';


export interface ScryfallPrinting {
  collectorNumber: string;
  finishes: string[];
  id: string;
  imageUrl?: string;
  name: string;
  rarity?: string;
  setCode: string;
  setName: string;
}

interface ScryfallCard {
  card_faces?: Array<{ image_uris?: { normal?: string; small?: string } }>;
  collector_number: string;
  finishes?: string[];
  id: string;
  image_uris?: { normal?: string; small?: string };
  name: string;
  rarity?: string;
  set: string;
  set_name: string;
}

/** Exact printing lookup — the point of reading set + number off the card. */
export const fetchPrinting = async (
  setCode: string,
  collectorNumber: string,
): Promise<ScryfallPrinting | null> => {
  const url =
    `https://api.scryfall.com/cards/${encodeURIComponent(setCode.toLowerCase())}/` +
    `${encodeURIComponent(collectorNumber)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Scryfall responded ${res.status}`);
  return toPrinting((await res.json()) as ScryfallCard);
};

const toPrinting = (card: ScryfallCard): ScryfallPrinting => {
  const images = card.image_uris ?? card.card_faces?.[0]?.image_uris;
  return {
    collectorNumber: card.collector_number,
    finishes: card.finishes ?? ['nonfoil'],
    id: card.id,
    imageUrl: images?.normal ?? images?.small,
    name: card.name,
    rarity: card.rarity,
    setCode: card.set,
    setName: card.set_name,
  };
};

/**
 * Fuzzy name lookup — turns messy OCR ("Liesa Shroud of Dusk") into Scryfall's
 * canonical name before we list printings.
 */
export const fetchNamedFuzzy = async (name: string): Promise<ScryfallPrinting | null> => {
  const url = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name.trim())}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Scryfall responded ${res.status}`);
  return toPrinting((await res.json()) as ScryfallCard);
};

/** Every printing of an exact card name — used once OCR locks the name. */
export const fetchPrintingsByName = async (name: string): Promise<ScryfallPrinting[]> => {
  const exact = name.trim();
  if (!exact) return [];
  const query = `!"${exact.replace(/"/g, '')}"`;
  const url =
    `https://api.scryfall.com/cards/search?order=released&dir=desc&unique=prints&q=` +
    encodeURIComponent(query);
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Scryfall responded ${res.status}`);
  const json = (await res.json()) as { data?: ScryfallCard[] };
  return (json.data ?? []).map(toPrinting);
};

/**
 * Pick a printing from a name-narrowed list using whatever set/number we have.
 * Returns null when more than one candidate still fits (user must scan more).
 */
export const pickPrinting = (
  printings: readonly ScryfallPrinting[],
  parts: { collectorNumber?: string; setCode?: string },
): ScryfallPrinting | null => {
  let pool = [...printings];
  if (parts.setCode) {
    const set = parts.setCode.toLowerCase();
    pool = pool.filter(p => p.setCode.toLowerCase() === set);
  }
  if (parts.collectorNumber) {
    const num = parts.collectorNumber.toLowerCase();
    const stripped = num.replace(/^0+/, '') || '0';
    pool = pool.filter(p => {
      const c = p.collectorNumber.toLowerCase();
      return c === num || c.replace(/^0+/, '') === stripped || c === stripped.padStart(c.length, '0');
    });
  }
  return pool.length === 1 ? pool[0] : null;
};

/** Build the collection row a successful scan should add. */
export const cardFromScan = (
  printing: ScryfallPrinting,
  foil: FoilHint,
  opts?: { nameOcr?: string; quantity?: number },
): CollectionCard => {
  const canFoil = printing.finishes.includes('foil');
  const finish = foil.foil && canFoil;
  return {
    collectorNumber: printing.collectorNumber,
    foil: finish,
    imageUrl: printing.imageUrl,
    name: printing.name,
    quantity: opts?.quantity ?? 1,
    rarity: printing.rarity,
    scryfallId: printing.id,
    setCode: printing.setCode,
    setName: printing.setName,
    source: 'import',
  };
};

/** Did the name OCR roughly agree with Scryfall? Soft check — OCR of titles drifts. */
export const namesAgree = (ocr: string | undefined, scryfall: string): boolean => {
  if (!ocr) return true;
  const a = ocr.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const b = scryfall.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!a || !b) return true;
  return a.includes(b.slice(0, Math.min(8, b.length))) || b.includes(a.slice(0, Math.min(8, a.length)));
};

