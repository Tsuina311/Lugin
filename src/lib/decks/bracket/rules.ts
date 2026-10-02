// How Lugin reads Commander Spellbook bracket tags.
//
// Spellbook's own guide (syntax page, current with API 7.1.3) says a tag is a
// qualitative hint, not a rigid bracket. These floors are that hint, applied
// once per unique card pair. They do not turn "any combo" into Bracket 4.
// Wizards' Game Changer and mass-land-denial checklist stays a separate floor
// and is never lowered by a combo.

import type { SpellbookBracketTag } from '@/lib/combos/types';

export interface SpellbookTagRule {
  /** Spellbook's name for the tag. */
  name: string;
  /** Highest bracket this tag suggests. Absent when the tag must not raise the estimate. */
  raisesTo?: 2 | 3 | 4;
  /** Spellbook: "probably 3 or 4" / "probably 2 or 3". */
  rangeHigh?: 3 | 4;
  severity: 'high' | 'info' | 'notable';
  /** Their searchable bracket number, when they publish one. */
  sourceBracket: number | null;
  sourceNote: string;
}

export const SPELLBOOK_TAG_RULES: Record<SpellbookBracketTag, SpellbookTagRule> = {
  B: {
    name: 'Banned',
    severity: 'info',
    sourceBracket: null,
    sourceNote: 'Not legal in Commander, usually because a card is banned.',
  },
  C: {
    name: 'Core',
    severity: 'info',
    sourceBracket: 2,
    sourceNote: 'For unoptimized decks in bracket 2+. Does not raise this estimate by itself.',
  },
  E: {
    name: 'Exhibition',
    severity: 'info',
    sourceBracket: 1,
    sourceNote: 'Combos that do not fit the other tags. Does not raise this estimate.',
  },
  O: {
    name: 'Oddball',
    rangeHigh: 3,
    severity: 'info',
    sourceBracket: 2,
    sourceNote: 'Probably 2 or 3. Does not raise the estimate above the card-list floor.',
  },
  P: {
    name: 'Powerful',
    raisesTo: 3,
    severity: 'notable',
    sourceBracket: 3,
    sourceNote: 'For strong decks in bracket 3+. A slow or Game-Changer two-card line.',
  },
  R: {
    name: 'Ruthless',
    raisesTo: 4,
    severity: 'high',
    sourceBracket: 4,
    sourceNote:
      'For competitive decks at brackets 4+. Spellbook’s tag for a fast, relevant two-card line.',
  },
  S: {
    name: 'Spicy',
    raisesTo: 3,
    rangeHigh: 4,
    severity: 'notable',
    sourceBracket: 3,
    sourceNote: 'Probably 3 or 4. Often a line that still wants another piece, or that stalls.',
  },
};
