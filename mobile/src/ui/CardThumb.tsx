import { useEffect, useState } from 'react';

import { Image, View, type ImageStyle, type StyleProp } from 'react-native';

import { cardImageCandidates, deckCardCandidates } from '@/lib/cardImage';
import type { CollectionCard } from '@/lib/collection';
import type { DeckCard } from '@/lib/deck';
import type { CardImageOverride } from '@/lib/printing';

/**
 * Walk the same image list the extension uses. The first URL that loads is
 * the one shown; a miss tries the next (CDN, then the printing, then the name).
 */
export function CardThumb({
  candidates,
  style,
}: {
  candidates: readonly string[];
  style: StyleProp<ImageStyle>;
}) {
  const [index, setIndex] = useState(0);
  const key = candidates.join('\0');

  useEffect(() => {
    setIndex(0);
  }, [key]);

  const uri = candidates[index];
  if (!uri) return <View style={style} />;

  return (
    <Image
      onError={() => setIndex(current => current + 1)}
      source={{ uri }}
      style={style}
    />
  );
}

/** Collection row art, preferring a printing chosen on another Lugin surface. */
export const collectionImageCandidates = (
  card: CollectionCard,
  override?: CardImageOverride,
): string[] =>
  cardImageCandidates({
    collectorNumber: override?.collectorNumber ?? card.collectorNumber,
    imageUrl: override?.imageUrl ?? card.imageUrl,
    name: card.name,
    productId: card.productId,
    scryfallId: override?.scryfallId ?? card.scryfallId,
    setCode: override?.setCode ?? card.setCode,
  });

/** Deck row art: the chosen printing, then the copy in the collection, then the name. */
export const deckImageCandidates = (
  card: DeckCard,
  owned: Map<string, readonly string[]>,
): readonly string[] => {
  const printing = card.printing;
  const picked = printing
    ? cardImageCandidates({
        collectorNumber: printing.collectorNumber,
        imageUrl: printing.imageUrl,
        name: card.name,
        productId:
          printing.cardmarketId != null ? String(printing.cardmarketId) : undefined,
        scryfallId: printing.scryfallId,
        setCode: printing.setCode,
      })
    : [];
  const rest = deckCardCandidates(card.name, owned);
  if (picked.length === 0) return rest;
  const out = [...picked];
  for (const url of rest) if (!out.includes(url)) out.push(url);
  return out;
};
