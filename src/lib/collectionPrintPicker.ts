import type { CollectionCard } from './collection';
import type { CardPrint } from './prints';

/** Stable artwork identity shared by Lugin Native and Lugin Web print pickers. */
export const cardPrintArtKey = (print: CardPrint): string => print.illustrationId ?? print.id;

export const cardPrintSupportsNonfoil = (print: CardPrint): boolean =>
  !print.finishes?.length || print.finishes.includes('nonfoil');

export const cardPrintSupportsFoil = (print: CardPrint): boolean =>
  !print.finishes?.length || print.finishes.includes('foil') || print.finishes.includes('etched');

/** Put the exact print a user already owns ahead of unrelated new editions. */
export const ownedCardPrintScore = (print: CardPrint, cards: readonly CollectionCard[]): number => {
  let score = 0;
  for (const card of cards) {
    if (card.scryfallId === print.id) score = Math.max(score, 5);
    if (
      card.productId &&
      print.cardmarketId != null &&
      card.productId === String(print.cardmarketId)
    ) {
      score = Math.max(score, 4);
    }
    if (
      card.setCode?.toLowerCase() === print.setCode.toLowerCase() &&
      card.collectorNumber === print.collectorNumber
    ) {
      score = Math.max(score, 3);
    } else if (
      card.setName?.toLowerCase() === print.setName.toLowerCase() &&
      (!card.collectorNumber || card.collectorNumber === print.collectorNumber)
    ) {
      score = Math.max(score, card.collectorNumber ? 3 : 2);
    }
  }
  return score;
};

export const collectionCardFromPrint = (
  name: string,
  print: CardPrint,
  foil: boolean,
): CollectionCard => ({
  collectorNumber: print.collectorNumber,
  foil,
  imageUrl: print.imageUrl,
  name,
  productId: print.cardmarketId != null ? String(print.cardmarketId) : undefined,
  quantity: 1,
  scryfallId: print.id,
  setCode: print.setCode,
  setName: print.setName,
  source: 'import',
});
