// The question the purchase fold-in couldn't answer on its own.
//
// Cardmarket knows you bought a card; it cannot know whether the copy in your
// collection is that one or a different one you also own. Adding regardless
// inflates the count, and an inflated count is indistinguishable from a correct
// one without recounting a binder — so these are withheld and asked about here.
//
// Ticked means "already in my collection", matching the file-import review: the
// default errs towards not growing the collection behind your back. Answers are
// remembered, so the next purchase sync doesn't ask again.

import { useState } from 'react';

import { Button } from './Button';

import type { CollectionCard } from '@/lib/collection';
import type { HeldPurchase, PurchaseVerdict } from '@/lib/purchaseDuplicates';
import { STRENGTH_CLASS, STRENGTH_LABEL } from '@/ui/matchStrength';

interface PurchaseDuplicatesProps {
  busy?: boolean;
  held: readonly HeldPurchase[];
  onCancel: () => void;
  onConfirm: (answers: Record<string, PurchaseVerdict>) => void;
}

const printing = (card: CollectionCard): string =>
  [card.setName ?? card.setCode?.toUpperCase(), card.collectorNumber, card.foil ? 'foil' : null]
    .filter(Boolean)
    .join(' · ');

export const PurchaseDuplicates = ({
  busy = false,
  held,
  onCancel,
  onConfirm,
}: PurchaseDuplicatesProps) => {
  const [owned, setOwned] = useState<Set<string>>(() => new Set(held.map(h => h.key)));

  const toggle = (key: string) =>
    setOwned(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const setAll = (on: boolean) => setOwned(on ? new Set(held.map(h => h.key)) : new Set());

  const confirm = () =>
    onConfirm(
      Object.fromEntries(held.map(h => [h.key, owned.has(h.key) ? 'own' : 'separate'] as const)),
    );

  const adding = held
    .filter(h => !owned.has(h.key))
    .reduce((n, h) => n + h.incoming.quantity, 0);

  return (
    <div className="mt-1.5 rounded border border-warn-soft">
      <div className="flex items-center gap-2 border-b border-line px-2 py-1">
        <span className="flex-1 text-2xs text-ink-muted">
          Ticked ones are already in your collection and won&apos;t be added again.
        </span>
        <Button disabled={busy} onClick={() => setAll(true)} size="xs" variant="subtle">
          All
        </Button>
        <Button disabled={busy} onClick={() => setAll(false)} size="xs" variant="subtle">
          None
        </Button>
      </div>

      <div className="max-h-64 divide-y divide-line overflow-y-auto">
        {held.map(h => (
          <label
            key={h.key}
            className="flex cursor-pointer items-start gap-2 px-2 py-1.5 hover:bg-tint"
            title={h.reason}
          >
            <input
              checked={owned.has(h.key)}
              className="mt-0.5 accent-current"
              disabled={busy}
              onChange={() => toggle(h.key)}
              type="checkbox"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs text-ink">
                {h.incoming.quantity}× {h.incoming.name}
              </span>
              <span className="block truncate text-2xs text-ink-faint">
                bought: {printing(h.incoming) || 'no printing given'} — you have:{' '}
                {h.existing.quantity}× {printing(h.existing) || 'no printing given'}
              </span>
            </span>
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-2xs font-medium ${
                STRENGTH_CLASS[h.strength]
              }`}
            >
              {STRENGTH_LABEL[h.strength]}
            </span>
          </label>
        ))}
      </div>

      <div className="flex items-center gap-2 border-t border-line px-2 py-1.5">
        <span className="flex-1 text-2xs text-ink-faint">
          {adding > 0 ? `${adding} will be added as separate copies` : 'Nothing will be added'}
        </span>
        <Button disabled={busy} onClick={onCancel} size="xs" variant="subtle">
          Later
        </Button>
        <Button disabled={busy} onClick={confirm} size="xs" variant="primary">
          {busy ? 'Saving…' : 'Save answers'}
        </Button>
      </div>
    </div>
  );
};
