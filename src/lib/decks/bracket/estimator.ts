import { estimateBracket, type BracketEstimate } from '@/lib/bracket';
import { findTwoCardCombos } from '@/lib/combos/detect';
import type { ComboAnalysis, ComboBundle, DeckComboCard, DetectedPair } from '@/lib/combos/types';
import { SPELLBOOK_TAG_RULES } from '@/lib/decks/bracket/rules';

export type BracketEvidenceKind =
  'EXTRA_TURNS' | 'GAME_CHANGER' | 'MASS_LAND_DENIAL' | 'TUTOR_DENSITY' | 'TWO_CARD_COMBO';

export interface BracketEvidence {
  detail?: string;
  kind: BracketEvidenceKind;
  pairKey?: string;
  severity: 'high' | 'info' | 'notable';
  suggestedFloor?: 2 | 3 | 4;
  summary: string;
}

export interface DeckBracketEstimate {
  checklist: BracketEstimate;
  combos: ComboAnalysis;
  confidence: 'low' | 'medium';
  /** Card-list floor from Game Changers and mass land denial. Combos never lower this. */
  constructionFloor: 2 | 3 | 4;
  estimatedBracket: 2 | 3 | 4;
  evidence: BracketEvidence[];
  /** Combo index was parsed. When false, combo evidence is empty on purpose. */
  indexReady: boolean;
  likelyRange: [2 | 3 | 4, 2 | 3 | 4];
}

const clamp = (value: number): 2 | 3 | 4 => (value >= 4 ? 4 : value <= 2 ? 2 : 3);

const comboEvidence = (pair: DetectedPair): BracketEvidence => {
  const rule = SPELLBOOK_TAG_RULES[pair.lead.tag];
  const names = `${pair.cards[0].name} + ${pair.cards[1].name}`;
  const lines = pair.lines.length === 1 ? '1 line' : `${pair.lines.length} known lines`;
  const commander = pair.usesCommander ? ' Commander is one half of this combo.' : '';
  return {
    detail: `${rule.sourceNote}${commander}`,
    kind: 'TWO_CARD_COMBO',
    pairKey: pair.pairKey,
    severity: rule.severity,
    suggestedFloor: rule.raisesTo,
    summary: `${rule.name} two-card combo: ${names} (${lines}).${commander}`,
  };
};

const checklistEvidence = (checklist: BracketEstimate): BracketEvidence[] => {
  const evidence: BracketEvidence[] = [];
  if (checklist.gameChangers.length > 0) {
    const count = checklist.gameChangers.length;
    evidence.push({
      kind: 'GAME_CHANGER',
      severity: count >= 4 ? 'high' : 'notable',
      suggestedFloor: count >= 4 ? 4 : 3,
      summary: `${count} Game Changer${count === 1 ? '' : 's'}: ${checklist.gameChangers.map(card => card.name).join(', ')}.`,
    });
  }
  if (checklist.massLandDenial.length > 0) {
    evidence.push({
      kind: 'MASS_LAND_DENIAL',
      severity: 'high',
      suggestedFloor: 4,
      summary: `${checklist.massLandDenial.length} mass land denial: ${checklist.massLandDenial.map(card => card.name).join(', ')}.`,
    });
  }
  if (checklist.extraTurns.length > 0) {
    const count = checklist.extraTurns.length;
    evidence.push({
      detail: 'A couple of these still fits Core. They keep the deck from Bracket 1.',
      kind: 'EXTRA_TURNS',
      severity: 'info',
      summary: `${count} extra-turn card${count === 1 ? '' : 's'}: ${checklist.extraTurns.map(card => card.name).join(', ')}.`,
    });
  }
  if (checklist.tutors.length > 0) {
    const count = checklist.tutors.length;
    evidence.push({
      detail: 'Tutor count is recorded for a later pass. It does not raise this estimate.',
      kind: 'TUTOR_DENSITY',
      severity: 'info',
      summary: `${count} tutor${count === 1 ? '' : 's'}.`,
    });
  }
  return evidence;
};

/**
 * Construction floor, then Spellbook tags on the unique pairs actually in the
 * deck. Exhibition, Core, and Oddball do not raise the number. Several variants
 * of one pair count once.
 */
export const estimateDeck = (
  cards: readonly DeckComboCard[],
  bundle: ComboBundle | null,
): DeckBracketEstimate => {
  const checklist = estimateBracket(cards);
  const combos = bundle
    ? findTwoCardCombos(cards, bundle)
    : {
        pairs: [],
        pending: 0,
        resolved: 0,
        total: cards.filter(card => card.section !== 'sideboard').length,
        unresolved: 0,
      };
  const fromCombos = combos.pairs.map(comboEvidence);
  const evidence = [...fromCombos, ...checklistEvidence(checklist)];
  let estimated: 2 | 3 | 4 = checklist.floor;
  let high: 2 | 3 | 4 = checklist.floor;
  for (const pair of combos.pairs) {
    const rule = SPELLBOOK_TAG_RULES[pair.lead.tag];
    if (rule.raisesTo && rule.raisesTo > estimated) estimated = rule.raisesTo;
    const top = rule.rangeHigh ?? rule.raisesTo ?? checklist.floor;
    if (top > high) high = top;
  }
  if (high < estimated) high = estimated;
  const indexReady = bundle !== null;
  return {
    checklist,
    combos,
    confidence: !indexReady || combos.unresolved > 0 ? 'low' : 'medium',
    constructionFloor: checklist.floor,
    estimatedBracket: clamp(estimated),
    evidence,
    indexReady,
    likelyRange: [clamp(estimated), clamp(high)],
  };
};
