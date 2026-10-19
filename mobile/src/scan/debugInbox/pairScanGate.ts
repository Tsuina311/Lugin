/**
 * The scan screen keeps its camera session alive on the Settings tab.
 * Pair QR scanning needs that session released before a second camera starts.
 */
let active = false;
const listeners = new Set<(active: boolean) => void>();

export const isPairScanActive = (): boolean => active;

export const setPairScanActive = (next: boolean): void => {
  if (active === next) return;
  active = next;
  for (const listener of listeners) listener(active);
};

export const subscribePairScan = (listener: (active: boolean) => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
