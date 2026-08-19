// How sure a duplicate pairing is, in words and in colour.
//
// Shared because there are two places that ask "is this one you already have?" —
// an uploaded file and a Cardmarket purchase — and a match graded "same printing"
// in one of them must not look like a different degree of certainty in the other.

import type { MatchStrength } from '@/lib/duplicates';

export const STRENGTH_LABEL: Record<MatchStrength, string> = {
  exact: 'same printing',
  likely: 'same set',
  possible: 'maybe',
};

export const STRENGTH_CLASS: Record<MatchStrength, string> = {
  exact: 'bg-pos-soft text-pos',
  likely: 'bg-accent-soft text-accent',
  possible: 'bg-warn-soft text-warn',
};
