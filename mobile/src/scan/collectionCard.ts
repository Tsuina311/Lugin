// Turn the printing the scanner already published into a collection row.
// Recognition is not consulted again here.

import { cardFromScan, type ScryfallPrinting } from './sharedCore';

import type { CollectionCard } from '@/lib/collection';
import type { FoilHint } from '@/lib/scan/foil';


type PublishedPrinting = {
  collectorNumber: string;
  finishes: string[];
  id?: string;
  name: string;
  scryfallId?: string;
  setCode: string;
  setName?: string;
};

export const collectionCardFromPrinting = (
  printing: PublishedPrinting,
  foil: FoilHint,
): CollectionCard | null => {
  const id = printing.id ?? printing.scryfallId;
  if (!id) return null;
  const resolved: ScryfallPrinting = {
    collectorNumber: printing.collectorNumber,
    finishes: printing.finishes,
    id,
    name: printing.name,
    setCode: printing.setCode,
    setName: printing.setName ?? '',
  };
  return cardFromScan(resolved, foil);
};
