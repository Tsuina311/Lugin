// Pause multi-step Cardmarket work when Cloudflare returns 403 / captcha.
//
// XHR 403s often leave the tab looking fine while further fetches keep failing.
// We collapse the overlay so the user can clear the check, persist a checkpoint,
// and continue the remaining steps when Lugin is restored on a real page.

import { hideOverlay, rememberReopenAfterLogin } from './overlay';
import { askForVerification, needsVerification } from './verify';

import type { WizardResults } from '@/sites/cardmarket/shoppingWizard';

const STORAGE_KEY = 'lugin:challengeResume';

/** Fired when the overlay leaves `hidden` so paused jobs can continue. */
export const OVERLAY_RESTORED_EVENT = 'lugin:overlay-restored';

export interface WizardAlsoAllResumeJob {
  type: 'wizardAlsoAll';
  wantListId: string;
  /** Sellers already fetched successfully (status done). */
  alsoDone: Record<
    string,
    {
      lines: unknown[];
      status: 'done';
    }
  >;
  alsoAllTotal: number;
  gridPicks: Record<string, string>;
  /** Sellers not yet done — includes the one that hit 403 and any not sent. */
  pending: { i: number; name: string; url: string }[];
  results: WizardResults;
  tab: 'wantlists';
}

export type ChallengeResumeJob = WizardAlsoAllResumeJob;

export interface ChallengeResumeState {
  at: number;
  job: ChallengeResumeJob;
  reason: string;
}

let memory: ChallengeResumeState | null = null;
const listeners = new Set<() => void>();

const emit = () => {
  for (const l of listeners) l();
};

const read = async (): Promise<ChallengeResumeState | null> => {
  if (memory) return memory;
  try {
    const raw = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as
      | ChallengeResumeState
      | undefined;
    if (raw?.job && typeof raw.at === 'number') {
      memory = raw;
      return raw;
    }
  } catch {
    // ignore
  }
  return null;
};

const write = async (state: ChallengeResumeState | null): Promise<void> => {
  memory = state;
  emit();
  try {
    if (state) await chrome.storage.local.set({ [STORAGE_KEY]: state });
    else await chrome.storage.local.remove(STORAGE_KEY);
  } catch {
    // keep in-memory
  }
};

export const challengeResumeStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): ChallengeResumeState | null {
    return memory;
  },
};

/** Hydrate memory early so subscribers see a checkpoint after reload. */
export const hydrateChallengeResume = async (): Promise<ChallengeResumeState | null> => {
  const state = await read();
  emit();
  return state;
};

export const peekChallengeResume = (): Promise<ChallengeResumeState | null> => read();

export const saveChallengeResume = async (
  reason: string,
  job: ChallengeResumeJob,
): Promise<void> => {
  await write({ at: Date.now(), job, reason });
};

export const clearChallengeResume = async (): Promise<void> => {
  await write(null);
};

/**
 * Collapse Lugin, remember to reopen on the want-lists tab, and reload into
 * Cloudflare's check when that helps.
 */
export const yieldToChallenge = async (reason: string): Promise<void> => {
  rememberReopenAfterLogin();
  try {
    localStorage.setItem('lugin:tab', 'wantlists');
  } catch {
    // ignore
  }
  hideOverlay();
  await askForVerification(reason);
};

export { needsVerification };
