import { useEffect, useState } from 'react';

import { Button } from './Button';
import { Loader2 } from './icons';

import { cdnImageFromId } from '@/lib/cardImage';
import { fetchCardPrints, type CardPrint } from '@/lib/prints';

/**
 * Every printing of one card, as art. Picking one is the caller's job — a deck
 * remembers it, and so does the collection when the card is already owned.
 */
export const EditionPicker = ({
  currentId,
  name,
  onClose,
  onPick,
}: {
  currentId?: string;
  name: string;
  onClose: () => void;
  onPick: (print: CardPrint) => void;
}) => {
  const [prints, setPrints] = useState<CardPrint[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let live = true;
    setState('loading');
    setPrints([]);
    fetchCardPrints(name)
      .then(list => {
        if (!live) return;
        setPrints(list);
        setState('ready');
      })
      .catch(() => live && setState('error'));
    return () => {
      live = false;
    };
  }, [name]);

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-canvas">
      <div className="flex flex-none items-center gap-2 border-b border-line bg-panel px-2 py-1.5">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-ink">{name}</div>
          <div className="text-2xs text-ink-faint">Pick the printing — click a card.</div>
        </div>
        <Button className="ml-auto flex-none" onClick={onClose} size="xs" variant="subtle">
          Close
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {state === 'loading' ? (
          <div className="flex h-full items-center justify-center gap-1.5 text-xs text-ink-faint">
            <Loader2 aria-hidden className="animate-spin" size={14} />
            Loading printings…
          </div>
        ) : state === 'error' ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-neg">
            Could not load printings.
            <Button
              onClick={() => {
                setState('loading');
                fetchCardPrints(name)
                  .then(list => {
                    setPrints(list);
                    setState('ready');
                  })
                  .catch(() => setState('error'));
              }}
              size="xs"
              variant="neutral"
            >
              Retry
            </Button>
          </div>
        ) : prints.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-ink-faint">
            No printings found for this card.
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
            {prints.map(print => {
              const current = print.id === currentId;
              const art = cdnImageFromId(print.id) ?? print.imageUrl;
              return (
                <button
                  key={print.id}
                  className={`flex flex-col overflow-hidden rounded border text-left ${
                    current
                      ? 'border-accent ring-1 ring-accent'
                      : 'border-line-strong hover:border-accent'
                  }`}
                  onClick={() => onPick(print)}
                  type="button"
                >
                  {art ? (
                    <img
                      alt={`${print.setName} #${print.collectorNumber}`}
                      className="card-frame aspect-[488/680] w-full bg-raised object-cover"
                      loading="lazy"
                      src={art}
                    />
                  ) : (
                    <div className="flex aspect-[488/680] w-full items-center justify-center bg-raised text-2xs text-ink-faint">
                      No image
                    </div>
                  )}
                  <span className="truncate px-1 pt-1 text-2xs font-medium text-ink">
                    {print.setName}
                  </span>
                  <span className="truncate px-1 pb-1 text-2xs uppercase text-ink-faint">
                    {print.setCode} #{print.collectorNumber}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
