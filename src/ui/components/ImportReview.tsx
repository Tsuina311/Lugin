import { useMemo, useState } from 'react';

import { Button } from './Button';

import type { CollectionCard } from '@/lib/collection';
import { findDuplicates, type DuplicateCandidate, type MatchStrength } from '@/lib/duplicates';
import type { ImportDecision, ImportInspection, ImportKind } from '@/lib/import';

// The screen between "I picked a file" and "my collection changed".
//
// It exists because import is the one action here that can quietly destroy
// something: a deck read as loose cards, or a second copy of a card silently
// swallowed as a repeat. Both are undetectable afterwards without counting by
// hand. So nothing is applied until this screen has said, in words, what it
// believes the file is and which rows it thinks you already own — and both are
// editable, because a guess the user can't overrule is just a bug with manners.
//
// Platform-free on purpose: no chrome.* and no store imports, so the phone build
// renders the same review as the extension.

interface ImportReviewProps {
  /** Disables the controls while the import is being written. */
  busy?: boolean;
  /** Collection rows to match against; empty for a first import. */
  existing: CollectionCard[];
  inspection: ImportInspection;
  onCancel: () => void;
  onConfirm: (decisions: ImportDecision[]) => void;
  /** Filename, so the header says which file this is about. */
  source: string;
}

const STRENGTH_LABEL: Record<MatchStrength, string> = {
  exact: 'same printing',
  likely: 'same set',
  possible: 'maybe',
};

const STRENGTH_CLASS: Record<MatchStrength, string> = {
  exact: 'bg-pos-soft text-pos',
  likely: 'bg-accent-soft text-accent',
  possible: 'bg-warn-soft text-warn',
};

const printing = (card: CollectionCard): string =>
  [card.setCode?.toUpperCase(), card.collectorNumber, card.foil ? 'foil' : null]
    .filter(Boolean)
    .join(' · ');

const countOf = (cards: { quantity: number }[]): number =>
  cards.reduce((n, c) => n + c.quantity, 0);

const CandidateRow = ({
  candidate,
  checked,
  disabled,
  onToggle,
}: {
  candidate: DuplicateCandidate;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) => (
  <label
    className="flex cursor-pointer items-start gap-2 px-2 py-1.5 hover:bg-tint"
    title={candidate.reason}
  >
    <input
      checked={checked}
      className="mt-0.5 accent-current"
      disabled={disabled}
      onChange={onToggle}
      type="checkbox"
    />
    <span className="min-w-0 flex-1">
      <span className="block truncate text-xs text-ink">
        {candidate.incoming.quantity}× {candidate.incoming.name}
      </span>
      <span className="block truncate text-2xs text-ink-faint">
        file: {printing(candidate.incoming) || 'no printing given'} — you have:{' '}
        {candidate.existing.quantity}× {printing(candidate.existing) || 'no printing given'}
        {candidate.existing.source === 'purchases' ? ', from Cardmarket purchases' : ''}
      </span>
    </span>
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-2xs font-medium ${
        STRENGTH_CLASS[candidate.strength]
      }`}
    >
      {STRENGTH_LABEL[candidate.strength]}
    </span>
  </label>
);

export const ImportReview = ({
  busy = false,
  existing,
  inspection,
  onCancel,
  onConfirm,
  source,
}: ImportReviewProps) => {
  // One diff per part, against the collection as it stands.
  const diffs = useMemo(
    () => inspection.parts.map(part => findDuplicates(part.cards, existing)),
    [existing, inspection],
  );

  const [kinds, setKinds] = useState<ImportKind[]>(() => inspection.parts.map(p => p.kind));
  // Ticked means "I already own this", which is the safe default: it asks before
  // growing the collection rather than after.
  const [ticked, setTicked] = useState<Set<number>[]>(() =>
    diffs.map(diff => new Set(diff.candidates.map(c => c.index))),
  );

  const setKind = (part: number, kind: ImportKind) =>
    setKinds(prev => prev.map((k, i) => (i === part ? kind : k)));

  const toggle = (part: number, index: number) =>
    setTicked(prev =>
      prev.map((set, i) => {
        if (i !== part) return set;
        const next = new Set(set);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      }),
    );

  const setAll = (part: number, on: boolean) =>
    setTicked(prev =>
      prev.map((set, i) =>
        i === part ? new Set(on ? diffs[i].candidates.map(c => c.index) : []) : set,
      ),
    );

  const confirm = () =>
    onConfirm(
      inspection.parts.map((part, i) => ({
        cards: part.cards,
        deck: part.deck,
        // A deck is filed by name, so nothing there is weighed against the
        // collection — you can own a card and still play it.
        duplicates: kinds[i] === 'collection' ? [...ticked[i]] : [],
        kind: kinds[i],
        label: part.label,
      })),
    );

  const skipping = inspection.parts.reduce(
    (n, _part, i) => n + (kinds[i] === 'collection' ? ticked[i].size : 0),
    0,
  );
  const adding = inspection.parts.reduce(
    (n, part, i) =>
      n + (kinds[i] === 'collection' ? countOf(part.cards.filter((_c, j) => !ticked[i].has(j))) : 0),
    0,
  );
  const decks = kinds.filter(k => k === 'deck').length;

  return (
    <div className="flex max-h-full flex-col gap-3">
      <div>
        <div className="text-sm font-medium text-ink">Import {source}</div>
        <div className="text-2xs text-ink-faint">
          Nothing changes until you confirm.
          {inspection.delimiter === '\t' ? ' Read as a tab-separated file.' : ''}
        </div>
      </div>

      {inspection.parts.length === 0 && (
        <p className="text-xs text-ink-muted">
          No cards found in that file. A ManaBox CSV export or a plain decklist both work.
        </p>
      )}

      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        {inspection.parts.map((part, i) => {
          const diff = diffs[i];
          const isCollection = kinds[i] === 'collection';
          return (
            <section key={part.label ?? i} className="rounded border border-line">
              <header className="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-2 py-1.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-ink">
                    {part.label ?? 'This file'}
                  </span>
                  <span className="block text-2xs text-ink-faint">
                    {countOf(part.cards)} cards · {part.reason}
                  </span>
                </span>
                <Button
                  active={isCollection}
                  disabled={busy}
                  onClick={() => setKind(i, 'collection')}
                  size="xs"
                >
                  Collection
                </Button>
                <Button
                  active={!isCollection}
                  disabled={busy}
                  onClick={() => setKind(i, 'deck')}
                  size="xs"
                >
                  Deck
                </Button>
              </header>

              {part.uncertain && (
                <p className="border-b border-line bg-warn-soft px-2 py-1 text-2xs text-warn">
                  The file doesn&apos;t say which it is — this is our guess, so check it.
                </p>
              )}

              {isCollection && diff.candidates.length > 0 && (
                <>
                  <div className="flex items-center gap-2 border-b border-line px-2 py-1">
                    <span className="flex-1 text-2xs text-ink-muted">
                      {diff.candidates.length} may already be in your collection. Ticked ones are
                      skipped.
                    </span>
                    <Button disabled={busy} onClick={() => setAll(i, true)} size="xs" variant="subtle">
                      All
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => setAll(i, false)}
                      size="xs"
                      variant="subtle"
                    >
                      None
                    </Button>
                  </div>
                  <div className="max-h-64 divide-y divide-line overflow-y-auto">
                    {diff.candidates.map(candidate => (
                      <CandidateRow
                        key={`${candidate.index}-${candidate.existing.name}`}
                        candidate={candidate}
                        checked={ticked[i].has(candidate.index)}
                        disabled={busy}
                        onToggle={() => toggle(i, candidate.index)}
                      />
                    ))}
                  </div>
                </>
              )}

              {isCollection && diff.candidates.length === 0 && (
                <p className="px-2 py-1.5 text-2xs text-ink-faint">
                  Nothing here looks like a card you already have.
                </p>
              )}
            </section>
          );
        })}
      </div>

      <div className="flex items-center gap-2 border-t border-line pt-2">
        <span className="flex-1 text-2xs text-ink-faint">
          {adding > 0 && `${adding} cards to add`}
          {adding > 0 && skipping > 0 && ', '}
          {skipping > 0 && `${skipping} skipped as duplicates`}
          {decks > 0 && `${adding > 0 || skipping > 0 ? ' · ' : ''}${decks} deck${decks > 1 ? 's' : ''}`}
        </span>
        <Button disabled={busy} onClick={onCancel} size="sm" variant="subtle">
          Cancel
        </Button>
        <Button
          disabled={busy || inspection.parts.length === 0}
          onClick={confirm}
          size="sm"
          variant="primary"
        >
          {busy ? 'Importing…' : skipping > 0 ? 'Treat selected as duplicates and import' : 'Import'}
        </Button>
      </div>
    </div>
  );
};
