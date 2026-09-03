// Collection add/edit command seam.
//
// Recognition produces a printing. Persistence is behind LocalRepository.
// Full Collection UI is out of scope until the scanner works.

import { cardFromScan, type ScryfallPrinting } from './sharedCore';
import type { FoilHint } from '@/lib/scan/foil';
import type { CollectionCard } from '@/lib/collection';

export interface CollectionAddCommand {
  card: CollectionCard;
  source: 'scan';
}

const NO_FOIL: FoilHint = { confidence: 0, foil: false, reason: 'unset' };

export const collectionAddFromPrinting = (
  printing: ScryfallPrinting,
  foil: FoilHint = NO_FOIL,
  quantity = 1,
): CollectionAddCommand => ({
  card: cardFromScan(printing, foil, { quantity }),
  source: 'scan',
});
