import { useEffect, useMemo, useState } from 'react';

import { syncStore } from './syncStore';

import { cardImageCandidates } from '@/lib/cardImage';
import type { CollectionCard } from '@/lib/collection';
import {
  cardPrintArtKey,
  cardPrintSupportsFoil,
  cardPrintSupportsNonfoil,
  collectionCardFromPrint,
  ownedCardPrintScore,
} from '@/lib/collectionPrintPicker';
import { fetchCardPrints, type CardPrint } from '@/lib/prints';
import { CollectionThumb } from '@/ui/components/CollectionThumb';

const printImages = (print: CardPrint): string[] =>
  cardImageCandidates({
    collectorNumber: print.collectorNumber,
    imageUrl: print.imageUrl,
    productId: print.cardmarketId != null ? String(print.cardmarketId) : undefined,
    scryfallId: print.id,
    setCode: print.setCode,
  });

export const CollectionAddDialog = ({
  cards,
  name,
  onClose,
}: {
  cards: readonly CollectionCard[];
  name: string;
  onClose: (added: boolean) => void;
}) => {
  const owned = useMemo(
    () =>
      cards.filter(card => card.name.localeCompare(name, undefined, { sensitivity: 'base' }) === 0),
    [cards, name],
  );
  const [prints, setPrints] = useState<CardPrint[]>([]);
  const [art, setArt] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [foil, setFoil] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchCardPrints(name).then(
      found => {
        if (cancelled) return;
        const ordered = [...found].sort(
          (a, b) => ownedCardPrintScore(b, owned) - ownedCardPrintScore(a, owned),
        );
        const first = ordered[0] ?? null;
        setPrints(ordered);
        setArt(first ? cardPrintArtKey(first) : null);
        setSelectedId(first?.id ?? null);
        setFoil(first ? !cardPrintSupportsNonfoil(first) && cardPrintSupportsFoil(first) : false);
        setLoading(false);
      },
      reason => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [name, owned]);

  const arts = useMemo(() => {
    const unique = new Map<string, CardPrint>();
    for (const print of prints) {
      const key = cardPrintArtKey(print);
      if (!unique.has(key)) unique.set(key, print);
    }
    return [...unique.entries()];
  }, [prints]);
  const editions = useMemo(
    () => prints.filter(print => !art || cardPrintArtKey(print) === art),
    [art, prints],
  );
  const selected = editions.find(print => print.id === selectedId) ?? null;

  const chooseArt = (key: string) => {
    const print = prints.find(candidate => cardPrintArtKey(candidate) === key) ?? null;
    setArt(key);
    setSelectedId(print?.id ?? null);
    setFoil(print ? !cardPrintSupportsNonfoil(print) && cardPrintSupportsFoil(print) : false);
  };

  const add = async () => {
    if (!selected || saving) return;
    setSaving(true);
    setError(null);
    try {
      await syncStore.addCards([collectionCardFromPrint(name, selected, foil)], 'manual');
      onClose(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setSaving(false);
    }
  };

  return (
    <div
      aria-label={`Add ${name}`}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end bg-black/75 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      onClick={() => onClose(false)}
      role="dialog"
    >
      <div
        className="mx-auto flex max-h-[88dvh] w-full max-w-lg flex-col rounded-2xl border border-line-strong bg-panel p-4 shadow-pop"
        onClick={event => event.stopPropagation()}
      >
        <h2 className="truncate text-base font-semibold text-ink">{name}</h2>
        <p className="text-xs text-ink-muted">Choose the art and edition you own.</p>

        {loading ? (
          <p className="py-10 text-center text-sm text-ink-muted">Loading printings…</p>
        ) : null}
        {error ? <p className="mt-3 rounded-lg bg-neg-soft p-3 text-xs text-neg">{error}</p> : null}
        {!loading && !error && prints.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-muted">
            No exact card or editions found.
          </p>
        ) : null}

        {!loading && prints.length > 0 ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {arts.length > 1 ? (
              <>
                <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                  Art
                </p>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {arts.map(([key, print]) => {
                    const isOwned = prints.some(
                      candidate =>
                        cardPrintArtKey(candidate) === key &&
                        ownedCardPrintScore(candidate, owned) > 0,
                    );
                    return (
                      <button
                        key={key}
                        aria-label={`Choose artwork from ${print.setName}`}
                        className={`relative w-24 shrink-0 overflow-hidden rounded-lg border-2 ${
                          key === art ? 'border-accent' : 'border-transparent'
                        }`}
                        onClick={() => chooseArt(key)}
                        type="button"
                      >
                        <CollectionThumb
                          candidates={printImages(print)}
                          className="aspect-[488/680] w-full"
                          name={name}
                          previewKey={`add-art|${print.id}`}
                        />
                        {isOwned ? (
                          <span className="absolute bottom-1 left-1 rounded bg-black/75 px-1.5 py-0.5 text-[9px] text-white">
                            Owned
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : null}

            <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              Edition
            </p>
            <div className="space-y-1">
              {editions.map(print => (
                <button
                  key={print.id}
                  className={`flex w-full items-center rounded-lg border px-3 py-2 text-left ${
                    print.id === selectedId
                      ? 'border-accent bg-accent-soft'
                      : 'border-line bg-raised'
                  }`}
                  onClick={() => {
                    setSelectedId(print.id);
                    if (foil && !cardPrintSupportsFoil(print)) setFoil(false);
                    if (!foil && !cardPrintSupportsNonfoil(print)) setFoil(true);
                  }}
                  type="button"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{print.setName}</span>
                    <span className="text-[10px] text-ink-faint">
                      {print.setCode.toUpperCase()} · #{print.collectorNumber}
                      {print.releasedAt ? ` · ${print.releasedAt.slice(0, 4)}` : ''}
                    </span>
                  </span>
                  {print.id === selectedId ? <span className="text-accent">✓</span> : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {selected ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              className={`rounded-lg border py-2 text-sm ${
                !foil ? 'border-accent bg-accent-soft text-ink' : 'border-line text-ink-muted'
              } disabled:opacity-35`}
              disabled={!cardPrintSupportsNonfoil(selected)}
              onClick={() => setFoil(false)}
              type="button"
            >
              ☆ Nonfoil
            </button>
            <button
              className={`rounded-lg border py-2 text-sm ${
                foil ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink-muted'
              } disabled:opacity-35`}
              disabled={!cardPrintSupportsFoil(selected)}
              onClick={() => setFoil(true)}
              type="button"
            >
              ★ Foil
            </button>
          </div>
        ) : null}

        <div className="mt-3 flex gap-2">
          <button
            className="flex-1 rounded-lg bg-raised py-3 text-sm font-medium text-ink-muted"
            onClick={() => onClose(false)}
            type="button"
          >
            Cancel
          </button>
          <button
            className="flex-1 rounded-lg bg-accent py-3 text-sm font-semibold text-accent-ink disabled:opacity-35"
            disabled={!selected || saving}
            onClick={() => void add()}
            type="button"
          >
            {saving ? 'Adding…' : 'Add card'}
          </button>
        </div>
      </div>
    </div>
  );
};
