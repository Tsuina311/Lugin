// ---------------------------------------------------------------------------
// MAIN-world interceptor
// ---------------------------------------------------------------------------
// This file is injected into the PAGE's JavaScript context (world: MAIN) at
// document_start, before the site's own scripts run. That placement is what
// lets us monkey-patch fetch / XMLHttpRequest and observe the real request and
// response bodies of the site's API calls. It then forwards a compact summary
// to the content script via window.postMessage.
//
// It must never touch `chrome.*` APIs — those don't exist in the MAIN world.
import { isReplayCommand, postInterceptorMessage, postReplayReply } from '@/lib/messaging';
import type { ApiResult, CapturedCall } from '@/lib/types';

const MAX_BODY_BYTES = 512 * 1024; // 512 KB cap so we never blow up memory.

const newId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const truncate = (text: string): { body: string; truncated: boolean } => {
  if (text.length <= MAX_BODY_BYTES) return { body: text, truncated: false };
  return { body: text.slice(0, MAX_BODY_BYTES), truncated: true };
};

const headersToObject = (headers: Headers): Record<string, string> => {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
};

/** Merge request headers from a Request object and/or a RequestInit into one map. */
const collectRequestHeaders = (
  input: RequestInfo | URL,
  init?: RequestInit,
): Record<string, string> | undefined => {
  const out: Record<string, string> = {};
  const merge = (h?: HeadersInit) => {
    if (!h) return;
    new Headers(h).forEach((value, key) => {
      out[key] = value;
    });
  };
  if (input instanceof Request) merge(input.headers);
  merge(init?.headers);
  return Object.keys(out).length ? out : undefined;
};

/** Best-effort serialization of a fetch/XHR request body to text. */
const bodyToText = (body: unknown): string | undefined => {
  if (body == null) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof FormData) {
    const entries: string[] = [];
    body.forEach((value, key) => {
      entries.push(`${key}=${typeof value === 'string' ? value : '[file]'}`);
    });
    return entries.join('&');
  }
  try {
    return JSON.stringify(body);
  } catch {
    return '[unserializable body]';
  }
};

// --- fetch ------------------------------------------------------------------
const originalFetch = window.fetch;
window.fetch = async function patchedFetch(
  this: typeof window,
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const url =
    typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

  const call: CapturedCall = {
    id: newId(),
    method,
    requestBody: bodyToText(init?.body),
    requestHeaders: collectRequestHeaders(input, init),
    source: 'fetch',
    startedAt: Date.now(),
    url,
  };
  postInterceptorMessage({ call, kind: 'call:start' });

  try {
    const response = await originalFetch.call(this, input as RequestInfo, init);
    // Clone before reading so the page still receives an unconsumed body.
    let responseBody: string | undefined;
    let truncated = false;
    try {
      const text = await response.clone().text();
      const t = truncate(text);
      responseBody = t.body;
      truncated = t.truncated;
    } catch {
      responseBody = '[body could not be read]';
    }

    const endedAt = Date.now();
    postInterceptorMessage({
      call: {
        ...call,
        durationMs: endedAt - call.startedAt,
        endedAt,
        responseBody,
        responseHeaders: headersToObject(response.headers),
        responseTruncated: truncated,
        status: response.status,
        statusText: response.statusText,
      },
      kind: 'call:end',
    });
    return response;
  } catch (err) {
    const endedAt = Date.now();
    postInterceptorMessage({
      call: {
        ...call,
        durationMs: endedAt - call.startedAt,
        endedAt,
        error: err instanceof Error ? err.message : String(err),
      },
      kind: 'call:end',
    });
    throw err;
  }
};

// --- XMLHttpRequest ---------------------------------------------------------
const OriginalXHR = window.XMLHttpRequest;

// We stash per-instance capture state on a WeakMap so we never mutate the XHR
// object the page can see.
interface XhrState {
  call: CapturedCall;
  requestHeaders: Record<string, string>;
}
const xhrState = new WeakMap<XMLHttpRequest, XhrState>();

const originalOpen = OriginalXHR.prototype.open;
OriginalXHR.prototype.open = function open(
  this: XMLHttpRequest,
  method: string,
  url: string | URL,
  ...rest: unknown[]
) {
  xhrState.set(this, {
    call: {
      id: newId(),
      method: method.toUpperCase(),
      source: 'xhr',
      startedAt: 0,
      url: url.toString(),
    },
    requestHeaders: {},
  });
  // @ts-expect-error — forward the original variadic signature untouched.
  return originalOpen.call(this, method, url, ...rest);
};

const originalSetRequestHeader = OriginalXHR.prototype.setRequestHeader;
OriginalXHR.prototype.setRequestHeader = function setRequestHeader(
  this: XMLHttpRequest,
  name: string,
  value: string,
) {
  const state = xhrState.get(this);
  if (state) state.requestHeaders[name] = value;
  return originalSetRequestHeader.call(this, name, value);
};

const originalSend = OriginalXHR.prototype.send;
OriginalXHR.prototype.send = function send(
  this: XMLHttpRequest,
  body?: Document | XMLHttpRequestBodyInit | null,
) {
  const state = xhrState.get(this);
  if (state) {
    state.call.startedAt = Date.now();
    state.call.requestHeaders = state.requestHeaders;
    state.call.requestBody = bodyToText(body);
    postInterceptorMessage({ call: state.call, kind: 'call:start' });

    this.addEventListener('loadend', () => {
      const endedAt = Date.now();
      let responseBody: string | undefined;
      let truncated = false;
      try {
        // responseText is only valid for '' or 'text' responseType.
        if (this.responseType === '' || this.responseType === 'text') {
          const t = truncate(this.responseText ?? '');
          responseBody = t.body;
          truncated = t.truncated;
        } else {
          responseBody = `[responseType=${this.responseType}]`;
        }
      } catch {
        responseBody = '[body could not be read]';
      }

      // Parse the raw header block into an object.
      const responseHeaders: Record<string, string> = {};
      (this.getAllResponseHeaders() || '')
        .trim()
        .split(/[\r\n]+/)
        .forEach(line => {
          const idx = line.indexOf(':');
          if (idx > 0) responseHeaders[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        });

      postInterceptorMessage({
        call: {
          ...state.call,
          durationMs: endedAt - state.call.startedAt,
          endedAt,
          error: this.status === 0 ? 'Request failed or was aborted' : undefined,
          responseBody,
          responseHeaders,
          responseTruncated: truncated,
          status: this.status,
          statusText: this.statusText,
        },
        kind: 'call:end',
      });
    });
  }
  return originalSend.call(this, body ?? null);
};

// --- Replay ------------------------------------------------------------------
// The overlay asks us to re-issue a request here in the page context. Because
// this runs on the site's own origin, the call carries the user's session and
// cookies exactly like the site's own requests — the correct way to repeat an
// allowed call. We use originalFetch so the replay isn't itself re-captured.
window.addEventListener('message', async event => {
  if (event.source !== window || !isReplayCommand(event.data)) return;
  const { id, request } = event.data;
  const method = (request.method ?? 'GET').toUpperCase();

  // Emit capture events for the replay too, so it's visible in the traffic tab
  // (tagged origin:'replay'). We call originalFetch, so it isn't double-captured.
  const call: CapturedCall = {
    id: newId(),
    method,
    origin: 'replay',
    requestBody: method !== 'GET' ? request.body : undefined,
    requestHeaders: request.headers,
    source: 'fetch',
    startedAt: Date.now(),
    url: request.url,
  };
  postInterceptorMessage({ call, kind: 'call:start' });

  try {
    const response = await originalFetch.call(window, request.url, {
      body: method !== 'GET' ? request.body : undefined,
      credentials: 'include',
      headers: request.headers,
      method,
    });
    const t = truncate(
      await response
        .clone()
        .text()
        .catch(() => '[body could not be read]'),
    );
    const result: ApiResult = {
      body: t.body,
      headers: headersToObject(response.headers),
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      url: response.url,
    };
    const endedAt = Date.now();
    postInterceptorMessage({
      call: {
        ...call,
        durationMs: endedAt - call.startedAt,
        endedAt,
        responseBody: t.body,
        responseHeaders: headersToObject(response.headers),
        responseTruncated: t.truncated,
        status: response.status,
        statusText: response.statusText,
      },
      kind: 'call:end',
    });
    postReplayReply({ __luginReply: 'replay', id, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const endedAt = Date.now();
    postInterceptorMessage({
      call: { ...call, durationMs: endedAt - call.startedAt, endedAt, error: message },
      kind: 'call:end',
    });
    postReplayReply({ __luginReply: 'replay', error: message, id });
  }
});

// A tiny breadcrumb so you can confirm in the page console that we injected.
console.debug('[Lugin] interceptor installed');
