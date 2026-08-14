import type { CardMetadata } from './mtg';
import type { PriceState } from './prices';
import type {
  ApiRequest,
  ApiResult,
  InterceptorEnvelope,
  InterceptorMessage,
  ReplayCommand,
  ReplayReply,
  RuntimeMessage,
  RuntimeResponse,
} from './types';

/**
 * Type guard for messages coming across window.postMessage from the MAIN-world
 * interceptor. We tag every message with `__lugin: true` so the content script
 * can safely ignore the noisy stream of unrelated postMessage traffic.
 */
export const isInterceptorEnvelope = (data: unknown): data is InterceptorEnvelope =>
  typeof data === 'object' &&
  data !== null &&
  (data as Record<string, unknown>).__lugin === true &&
  'payload' in (data as Record<string, unknown>);

/** Post a message from the MAIN-world interceptor to the content script. */
export const postInterceptorMessage = (payload: InterceptorMessage): void => {
  const envelope: InterceptorEnvelope = { __lugin: true, payload };
  window.postMessage(envelope, '*');
};

export const isReplayCommand = (data: unknown): data is ReplayCommand =>
  typeof data === 'object' &&
  data !== null &&
  (data as Record<string, unknown>).__luginCmd === 'replay';

const isReplayReply = (data: unknown): data is ReplayReply =>
  typeof data === 'object' &&
  data !== null &&
  (data as Record<string, unknown>).__luginReply === 'replay';

let replayCounter = 0;

/**
 * Ask the MAIN-world interceptor to re-issue a request in the page context and
 * resolve with its response. This mirrors how the site itself calls its own
 * endpoints (same origin, same cookies), so it faithfully repeats an allowed
 * call. Runs from the content script / overlay.
 */
export const replayInPage = (request: ApiRequest, timeoutMs = 30_000): Promise<ApiResult> => {
  const id = `replay-${Date.now().toString(36)}-${replayCounter++}`;
  return new Promise<ApiResult>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('Replay timed out'));
    }, timeoutMs);

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || !isReplayReply(event.data)) return;
      if (event.data.id !== id) return;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      if (event.data.error) reject(new Error(event.data.error));
      else if (event.data.result) resolve(event.data.result);
      else reject(new Error('Empty replay reply'));
    };

    window.addEventListener('message', onMessage);
    const command: ReplayCommand = { __luginCmd: 'replay', id, request };
    window.postMessage(command, '*');
  });
};

/** Post a replay reply from the MAIN-world interceptor back to the content script. */
export const postReplayReply = (reply: ReplayReply): void => {
  window.postMessage(reply, '*');
};

/**
 * Ask the background service worker to perform an API request on our behalf.
 * Routing through the background worker sidesteps page CORS and keeps the
 * site's own auth cookies out of scope unless we explicitly opt in.
 */
export const requestApi = async (request: ApiRequest): Promise<ApiResult> => {
  const message: RuntimeMessage = { kind: 'api:fetch', request };
  const response = (await chrome.runtime.sendMessage(message)) as RuntimeResponse;
  if (response.kind === 'api:result') return response.result;
  if (response.kind === 'error') throw new Error(response.error);
  throw new Error(`Unexpected response from background: ${response.kind}`);
};

/**
 * Look up Magic card metadata (type, subtypes, colors, mana value…) by name via
 * Scryfall, through the background worker (which batches + caches the results).
 */
export const requestScryfall = async (names: string[]): Promise<CardMetadata[]> => {
  const message: RuntimeMessage = { kind: 'scryfall:collection', names };
  const response = (await chrome.runtime.sendMessage(message)) as RuntimeResponse;
  if (response.kind === 'scryfall:result') return response.cards;
  if (response.kind === 'error') throw new Error(response.error);
  throw new Error(`Unexpected response from background: ${response.kind}`);
};

/**
 * The card price table, from the worker's daily copy.
 *
 * One table for the whole collection, rather than a lookup per card: valuing
 * 20,000 rows is then a sum rather than 20,000 requests. See
 * scripts/build-prices.mjs.
 */
export const requestPrices = async (): Promise<PriceState> => {
  const message: RuntimeMessage = { kind: 'prices:get' };
  const response = (await chrome.runtime.sendMessage(message)) as RuntimeResponse;
  if (response.kind === 'prices:state') return response.state;
  if (response.kind === 'error') throw new Error(response.error);
  throw new Error(`Unexpected response from background: ${response.kind}`);
};

/**
 * Cache-only variant: returns metadata already stored on disk (no network). Use
 * to preload previously-seen cards instantly; names not yet cached are omitted.
 */
export const requestScryfallCached = async (names: string[]): Promise<CardMetadata[]> => {
  const message: RuntimeMessage = { kind: 'scryfall:cached', names };
  const response = (await chrome.runtime.sendMessage(message)) as RuntimeResponse;
  if (response.kind === 'scryfall:result') return response.cards;
  if (response.kind === 'error') throw new Error(response.error);
  throw new Error(`Unexpected response from background: ${response.kind}`);
};
