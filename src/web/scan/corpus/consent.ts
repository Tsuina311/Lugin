// Development-capture consent — local only, not synced to Drive.

import { CORPUS_CONSENT_VERSION } from '@/lib/scan/corpus/types';
import { newContributorId } from '@/lib/scan/corpus/ids';

const CONSENT_KEY = 'lugin:corpus-consent';
const CONTRIBUTOR_KEY = 'lugin:corpus-contributor';
const STATS_KEY = 'lugin:corpus-stats';

export type CorpusConsentAnswer = 'accepted' | 'declined';

export interface CorpusConsentState {
  answer: CorpusConsentAnswer;
  answeredAt: string;
  version: number;
}

export interface CorpusStats {
  contributed: number;
}

const readJson = <T>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

export const getCorpusConsent = (): CorpusConsentState | null => {
  const s = readJson<CorpusConsentState>(CONSENT_KEY);
  if (!s?.answer || s.version !== CORPUS_CONSENT_VERSION) return null;
  return s;
};

export const setCorpusConsent = (answer: CorpusConsentAnswer): CorpusConsentState => {
  const state: CorpusConsentState = {
    answer,
    answeredAt: new Date().toISOString(),
    version: CORPUS_CONSENT_VERSION,
  };
  localStorage.setItem(CONSENT_KEY, JSON.stringify(state));
  if (answer === 'accepted') ensureContributorId();
  return state;
};

export const clearCorpusConsent = (): void => {
  localStorage.removeItem(CONSENT_KEY);
};

export const isCorpusCaptureEnabled = (): boolean =>
  getCorpusConsent()?.answer === 'accepted';

export const ensureContributorId = (): string => {
  const existing = localStorage.getItem(CONTRIBUTOR_KEY);
  if (existing) return existing;
  const id = newContributorId();
  localStorage.setItem(CONTRIBUTOR_KEY, id);
  return id;
};

export const getCorpusStats = (): CorpusStats =>
  readJson<CorpusStats>(STATS_KEY) ?? { contributed: 0 };

export const bumpContributed = (): void => {
  const s = getCorpusStats();
  localStorage.setItem(
    STATS_KEY,
    JSON.stringify({ contributed: s.contributed + 1 }),
  );
};
