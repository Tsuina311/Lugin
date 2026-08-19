// HTTP fetch for APIs that block page CORS in the extension build.
//
// The extension routes through its background worker; the phone build calls
// directly when the target sends permissive CORS headers (Scryfall, EDHREC JSON),
// or through the PWA service worker for hosts that don't (MTGGoldfish).

import { requestApi } from './messaging';
import type { ApiResult } from './types';

/** Hosts the phone build proxies via its service worker (`/api/fetch`). */
const PROXY_HOSTS = ['https://www.mtggoldfish.com/'] as const;

const needsProxy = (url: string): boolean => PROXY_HOSTS.some(prefix => url.startsWith(prefix));

const fetchViaServiceWorkerProxy = async (url: string, accept?: string): Promise<ApiResult> => {
  const base = typeof import.meta.env?.BASE_URL === 'string' ? import.meta.env.BASE_URL : '/';
  const proxyUrl = `${base}api/fetch?url=${encodeURIComponent(url)}`;
  const res = await fetch(proxyUrl, {
    headers: accept ? { Accept: accept } : {},
  });
  return {
    body: await res.text(),
    headers: {},
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    url,
  };
};

export const fetchRemote = async (url: string, accept?: string): Promise<ApiResult> => {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
      return await requestApi({ url });
    }
  } catch {
    // Unpacked builds can throw when the runtime is gone — fall through to fetch.
  }
  if (needsProxy(url)) return fetchViaServiceWorkerProxy(url, accept);
  const res = await fetch(url, {
    headers: { Accept: accept ?? 'application/json, text/html;q=0.9,*/*;q=0.8' },
  });
  return {
    body: await res.text(),
    headers: {},
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    url: res.url,
  };
};
