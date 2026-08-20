// HTTP fetch for APIs that block page CORS in the extension build.
//
// The extension routes through its background worker (host_permissions). The phone
// build calls Scryfall and EDHREC directly; MTGGoldfish goes through an optional
// Cloudflare Worker proxy (VITE_LUGIN_GOLDFISH_PROXY_URL) because neither direct
// fetch nor a service-worker relay can read its HTML in modern browsers.

import { requestApi } from './messaging';
import { isScryfallUrl, scryfallFetch } from './scryfallFetch';
import type { ApiResult } from './types';

const GOLDFISH = 'https://www.mtggoldfish.com/';
const DEV_GOLDFISH_PROXY = 'http://127.0.0.1:8787';

const isExtension = (): boolean =>
  typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);

/** Phone-build proxy base URL (Cloudflare Worker), if configured. */
export const goldfishProxyUrl = (): string | undefined => {
  const raw = import.meta.env.VITE_LUGIN_GOLDFISH_PROXY_URL;
  if (typeof raw === 'string' && raw.trim()) return raw.trim().replace(/\/$/, '');
  // Local phone dev: `yarn goldfish:proxy` serves workers/goldfish-proxy.js here.
  if (import.meta.env.DEV) return DEV_GOLDFISH_PROXY;
  return undefined;
};

const isGoldfish = (url: string): boolean => url.startsWith(GOLDFISH);

export const GOLDFISH_PHONE_SETUP =
  'Deploy workers/goldfish-proxy.js once (`yarn goldfish:deploy`), then set VITE_LUGIN_GOLDFISH_PROXY_URL to the workers.dev URL (local .env.local and the GitHub Pages variable for deploys).';

const fetchViaGoldfishProxy = async (url: string, accept?: string): Promise<ApiResult> => {
  const base = goldfishProxyUrl();
  if (!base) {
    throw new Error(`MTGGoldfish is not configured for the phone app yet. ${GOLDFISH_PHONE_SETUP}`);
  }
  const proxyUrl = `${base}?url=${encodeURIComponent(url)}`;
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
  if (isExtension()) {
    return requestApi({ url });
  }

  if (isGoldfish(url)) {
    return fetchViaGoldfishProxy(url, accept);
  }

  // Phone build talks to Scryfall directly — same queue as the extension's
  // background path so tag search and metadata don't race each other here.
  if (isScryfallUrl(url)) {
    return scryfallFetch({
      headers: accept ? { Accept: accept } : undefined,
      url,
    });
  }

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
