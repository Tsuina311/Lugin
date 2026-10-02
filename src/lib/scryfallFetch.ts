// One polite lane for every call to api.scryfall.com.
//
// Tag search, collection metadata, print lookups and set catalogue all share
// Scryfall's budget. Without a queue they race, trip 429, and the UI reports
// rate-limiting even for a single tag click. This module serialises those
// fetches, spaces them ~100ms apart (Scryfall's guidance), and retries 429
// with Retry-After / exponential backoff.

import type { ApiRequest, ApiResult } from './types';

const HOST = 'api.scryfall.com';
/** Minimum gap between the start of consecutive Scryfall requests. */
const MIN_GAP_MS = 120;
const MAX_RETRIES = 5;

let lastStartedAt = 0;

interface Queued {
  priority: number;
  reject: (error: unknown) => void;
  request: ApiRequest;
  resolve: (result: ApiResult) => void;
}

/** Not yet started. A higher priority is pulled out ahead of whatever was queued first. */
const waiting: Queued[] = [];
let draining = false;

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export const isScryfallUrl = (url: string): boolean => {
  try {
    return new URL(url).hostname === HOST;
  } catch {
    return false;
  }
};

const retryWaitMs = (headers: Headers, attempt: number): number => {
  const raw = headers.get('Retry-After');
  if (raw) {
    const asSeconds = Number(raw);
    if (Number.isFinite(asSeconds)) return Math.max(250, asSeconds * 1000);
    const when = Date.parse(raw);
    if (Number.isFinite(when)) return Math.max(250, when - Date.now());
  }
  // 0.6s, 1.2s, 2.4s, 4.8s, 8s — stay under Scryfall's patience, not ours.
  return Math.min(8000, 600 * 2 ** attempt);
};

const toResult = async (response: Response): Promise<ApiResult> => {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return {
    body: await response.text(),
    headers,
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    url: response.url,
  };
};

const run = async (request: ApiRequest): Promise<ApiResult> => {
  const gap = Math.max(0, MIN_GAP_MS - (Date.now() - lastStartedAt));
  if (gap > 0) await sleep(gap);

  for (let attempt = 0; ; attempt++) {
    lastStartedAt = Date.now();
    const response = await fetch(request.url, {
      body: request.body,
      headers: {
        Accept: 'application/json',
        ...request.headers,
      },
      method: request.method ?? 'GET',
    });

    if (response.status === 429 && attempt < MAX_RETRIES) {
      await sleep(retryWaitMs(response.headers, attempt));
      continue;
    }

    return toResult(response);
  }
};

const drain = async (): Promise<void> => {
  if (draining) return;
  draining = true;
  try {
    while (waiting.length > 0) {
      let best = 0;
      for (let i = 1; i < waiting.length; i++) {
        if (waiting[i].priority > waiting[best].priority) best = i;
      }
      const job = waiting.splice(best, 1)[0];
      try {
        job.resolve(await run(job.request));
      } catch (error) {
        job.reject(error);
      }
    }
  } finally {
    draining = false;
    if (waiting.length > 0) void drain();
  }
};

/**
 * Fetch a Scryfall URL through the shared rate gate.
 *
 * Safe to call from the background worker and from the phone build's direct
 * fetch path — each JS realm gets its own queue, which is what we want.
 * `priority` (higher first) lets a print picker pass a deck's background lookups.
 */
export const scryfallFetch = (request: ApiRequest): Promise<ApiResult> =>
  new Promise((resolve, reject) => {
    waiting.push({ priority: request.priority ?? 0, reject, request, resolve });
    void drain();
  });
