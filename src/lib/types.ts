import type { CardMetadata } from './mtg';
import type { PriceState } from './prices';

import type { DomainKey, SyncedApplicationState } from '@/core/sync/model';
import type { RemoteSnapshot } from '@/core/sync/repository';

/** A single captured HTTP call, from request start to response end. */
export interface CapturedCall {
  /** Wall-clock duration in ms, if finished. */
  durationMs?: number;
  /** Milliseconds since epoch when the response finished (undefined while pending). */
  endedAt?: number;
  /** Set if the request threw (network error, aborted, etc.). */
  error?: string;
  id: string;
  method: string;
  /** Where the call originated: the page itself, or a replay we issued. */
  origin?: 'page' | 'replay';
  /** Request body as text when it could be serialized. */
  requestBody?: string;

  requestHeaders?: Record<string, string>;
  /** Response body as text (may be truncated for very large payloads). */
  responseBody?: string;

  responseHeaders?: Record<string, string>;
  /** True when the response body was cut off due to size limits. */
  responseTruncated?: boolean;
  /** How the call was made by the page. */
  source: 'fetch' | 'xhr';
  /** Milliseconds since epoch when the request started. */
  startedAt: number;
  status?: number;

  statusText?: string;

  url: string;
}

/** Messages posted from the MAIN-world interceptor to the content script. */
export type InterceptorMessage =
  { call: CapturedCall; kind: 'call:start' } | { call: CapturedCall; kind: 'call:end' };

/** Namespaced envelope used on window.postMessage so we ignore unrelated messages. */
export interface InterceptorEnvelope {
  __lugin: true;
  payload: InterceptorMessage;
}

/**
 * Replay command: content script -> MAIN-world interceptor. The interceptor
 * re-issues the request using the PAGE's own fetch, so it carries the user's
 * existing session/cookies exactly like the site's own calls do.
 */
export interface ReplayCommand {
  __luginCmd: 'replay';
  id: string;
  request: ApiRequest;
}

/** Replay result: MAIN-world interceptor -> content script (correlated by id). */
export interface ReplayReply {
  __luginReply: 'replay';
  error?: string;
  id: string;
  result?: ApiResult;
}

/** Messages exchanged between the content script / overlay and the background worker. */
export type RuntimeMessage =
  | { kind: 'api:fetch'; request: ApiRequest }
  | { kind: 'scryfall:collection'; names: string[] }
  | { kind: 'scryfall:cached'; names: string[] }
  // Google Drive sync. The overlay runs the reconciliation but can't do either
  // of these itself: `chrome.identity` doesn't exist in a content script, and a
  // cross-origin call from the Cardmarket page would be the page's to make.
  | { at: string; domain: DomainKey; kind: 'drive:archive'; value: unknown }
  | { base: string | null; kind: 'drive:save'; state: SyncedApplicationState }
  | { kind: 'drive:load' }
  | { kind: 'google:connect' }
  | { kind: 'google:disconnect' }
  | { kind: 'google:status' }
  | { kind: 'ping' }
  // The card price table. Fetched by the worker because the overlay sits inside a
  // page with its own CSP, and cached there because it is megabytes.
  | { kind: 'prices:get' };

export type RuntimeResponse =
  | { kind: 'api:result'; result: ApiResult }
  | { cards: CardMetadata[]; kind: 'scryfall:result' }
  | { connected: boolean; kind: 'google:status' }
  | { kind: 'drive:snapshot'; snapshot: RemoteSnapshot | null }
  | { kind: 'ok' }
  | { kind: 'pong' }
  | { kind: 'prices:state'; state: PriceState }
  | { code?: RuntimeErrorCode; error: string; kind: 'error' };

/**
 * Enough for the other side to rebuild the error it would have caught locally.
 * Messages cross a structured-clone boundary, so the class itself can't.
 */
export type RuntimeErrorCode = 'auth' | 'conflict' | 'unsupported-schema';

/** A request the overlay wants the background worker to perform on its behalf. */
export interface ApiRequest {
  body?: string;
  headers?: Record<string, string>;
  method?: string;
  url: string;
}

export interface ApiResult {
  body: string;
  headers: Record<string, string>;
  ok: boolean;
  status: number;
  statusText: string;
  /**
   * Where the response actually came from, after any redirects. Cardmarket
   * answers some POSTs by sending you to the page it just made, so this is
   * sometimes the only place the new thing's id appears.
   */
  url?: string;
}

export const Lugin_NAMESPACE = '__lugin' as const;
