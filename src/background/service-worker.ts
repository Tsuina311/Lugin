import { getCardMetadata, getCachedMetadata } from './scryfall';
import { handleSyncMessage } from './sync';

import { adoptRenamedKeys } from '@/lib/renamedKeys';
import type { ApiRequest, ApiResult, RuntimeMessage, RuntimeResponse } from '@/lib/types';

// ---------------------------------------------------------------------------
// Background service worker (MV3)
// ---------------------------------------------------------------------------
// Two jobs:
//   1. Clicking the toolbar icon toggles the overlay on the active tab.
//   2. Perform API requests on behalf of the overlay. Running fetch here (with
//      host_permissions) avoids the page's CORS restrictions and is the right
//      place to grow your custom API integration.

// Runs before any page's content script can ask for stored data, which is why
// it's here rather than in the overlay: the stores start reading the moment
// they're imported, and would find nothing under the new names.
void adoptRenamedKeys();

chrome.action.onClicked.addListener(async tab => {
  if (tab.id == null) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { kind: 'overlay:toggle' });
  } catch {
    // Content script not present on this tab (e.g. chrome:// pages). Ignore.
  }
});

const performFetch = async (request: ApiRequest): Promise<ApiResult> => {
  const response = await fetch(request.url, {
    body: request.body,
    headers: request.headers,
    method: request.method ?? 'GET',
  });

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

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, _sender, sendResponse: (r: RuntimeResponse) => void) => {
    if (message.kind === 'ping') {
      sendResponse({ kind: 'pong' });
      return; // synchronous
    }

    if (message.kind === 'api:fetch') {
      performFetch(message.request)
        .then(result => sendResponse({ kind: 'api:result', result }))
        .catch((err: unknown) =>
          sendResponse({ error: err instanceof Error ? err.message : String(err), kind: 'error' }),
        );
      return true; // keep the message channel open for the async response.
    }

    if (message.kind === 'scryfall:collection') {
      getCardMetadata(message.names)
        .then(cards => sendResponse({ cards, kind: 'scryfall:result' }))
        .catch((err: unknown) =>
          sendResponse({ error: err instanceof Error ? err.message : String(err), kind: 'error' }),
        );
      return true;
    }

    const sync = handleSyncMessage(message);
    if (sync) {
      sync.then(sendResponse).catch((err: unknown) =>
        sendResponse({ error: err instanceof Error ? err.message : String(err), kind: 'error' }),
      );
      return true;
    }

    if (message.kind === 'scryfall:cached') {
      getCachedMetadata(message.names)
        .then(cards => sendResponse({ cards, kind: 'scryfall:result' }))
        .catch((err: unknown) =>
          sendResponse({ error: err instanceof Error ? err.message : String(err), kind: 'error' }),
        );
      return true;
    }

    return false;
  },
);
