import { foldName } from '../matchName';

import type { FocusSeriesBundle } from './types';

export interface FocusExpectedIdentity {
  expectedName: string;
  expectedOracleId: string;
  source: 'label-map' | 'unresolved';
}

const LABEL_EXPECTATIONS: { match: RegExp; expectedName: string }[] = [
  { expectedName: 'Wand of Wonder', match: /\bwand\b/i },
  { expectedName: 'Livaan, Cultist of Tiamat', match: /\blivaan\b/i },
  { expectedName: 'Excalibur, Sword of Eden', match: /\bexcalibur\b/i },
  { expectedName: 'The Deck of Many Things', match: /cartes\s+merveilleuses|deck of many things/i },
  { expectedName: 'Octopus Form', match: /\boctopus\b/i },
  { expectedName: "Teferi's Veil", match: /\bteferi\b/i },
  { expectedName: 'Island', match: /\bisland\b|\b[iî]le\b/i },
];

export const expectedIdentityFromLabel = (label: string): FocusExpectedIdentity => {
  const hit = LABEL_EXPECTATIONS.find(row => row.match.test(label));
  if (!hit) {
    return { expectedName: label.trim() || '(unknown)', expectedOracleId: '', source: 'unresolved' };
  }
  return {
    expectedName: hit.expectedName,
    expectedOracleId: foldName(hit.expectedName),
    source: 'label-map',
  };
};

export const identityMatchesExpected = (
  predicted: string | null | undefined,
  expectedName: string,
): boolean => {
  if (!predicted || !expectedName) return false;
  return foldName(predicted) === foldName(expectedName);
};

export const resolveExpectedIdentity = (bundle: FocusSeriesBundle): FocusExpectedIdentity =>
  expectedIdentityFromLabel(bundle.label || bundle.fixtureId);
