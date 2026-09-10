// Lightweight JS event-loop lag probe (debug / perf baseline).

export type JsLagStats = {
  p50: number;
  p95: number;
  max: number;
  samples: number;
};

const INTERVAL_MS = 100;
const MAX_SAMPLES = 120;

let timer: ReturnType<typeof setInterval> | null = null;
let expectedAt = 0;
const lags: number[] = [];
const listeners = new Set<(s: JsLagStats) => void>();

const percentile = (xs: number[], p: number): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * (s.length - 1)))];
};

export const getJsLagStats = (): JsLagStats => {
  const max = lags.length ? Math.max(...lags) : 0;
  return {
    p50: percentile(lags, 50),
    p95: percentile(lags, 95),
    max,
    samples: lags.length,
  };
};

export const startJsLagProbe = (): void => {
  if (timer) return;
  expectedAt = Date.now() + INTERVAL_MS;
  timer = setInterval(() => {
    const now = Date.now();
    const lag = Math.max(0, now - expectedAt);
    lags.push(lag);
    if (lags.length > MAX_SAMPLES) lags.shift();
    expectedAt = now + INTERVAL_MS;
    const snap = getJsLagStats();
    for (const l of listeners) l(snap);
  }, INTERVAL_MS);
};

export const stopJsLagProbe = (): void => {
  if (timer) clearInterval(timer);
  timer = null;
  lags.length = 0;
};

export const subscribeJsLag = (fn: (s: JsLagStats) => void): (() => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
