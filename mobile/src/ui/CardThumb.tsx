import { useEffect, useState } from 'react';

import { Image, View, type ImageStyle, type StyleProp } from 'react-native';

import { cachedCardImage, peekCardImageCandidates } from './cardImageCache';

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
  const initial = peekCardImageCandidates(candidates);
  const [index, setIndex] = useState(0);
  const [local, setLocal] = useState<{ url: string; uri: string } | null>(initial);
  const key = candidates.join('\0');
  const count = candidates.length;
  const remote = candidates[index];

  useEffect(() => {
    const cached = peekCardImageCandidates(candidates);
    // A cached name fallback may paint immediately, but always start at the
    // highest-priority exact printing so it can replace that fallback.
    setIndex(0);
    setLocal(cached);
  }, [key]);

  useEffect(() => {
    if (!remote) return;
    let cancelled = false;
    const fail = () => {
      if (cancelled) return;
      setIndex(current => (current === index && current + 1 < count ? current + 1 : current));
    };
    try {
      cachedCardImage(remote).then(
        uri => {
          if (!cancelled && uri) setLocal({ url: remote, uri });
          else fail();
        },
        fail,
      );
    } catch {
      fail();
    }
    return () => {
      cancelled = true;
    };
  }, [count, index, remote]);

  // `null?.url === undefined` is true. An exhausted candidate list must not
  // read `local.uri` — that is "Cannot read property 'uri' of null".
  const uri = local && candidates.includes(local.url) ? local.uri : null;
  if (!uri) return <View style={style} />;
  return (
    <Image
      onError={() => {
        setIndex(current => (current === index && current + 1 < count ? current + 1 : current));
      }}
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
