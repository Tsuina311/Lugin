// HTTP fetch for APIs that block page CORS in the extension build.
//
// The extension routes through its background worker (host_permissions). The phone
// build calls Scryfall and EDHREC directly; MTGGoldfish goes through an optional
// Cloudflare Worker proxy (VITE_LUGIN_GOLDFISH_PROXY_URL) because neither direct
// fetch nor a service-worker relay can read its HTML in modern browsers.

import { requestApi } from './messaging';
import type { ApiResult } from './types';

const GOLDFISH = 'https://www.mtggoldfish.com/';

const isExtension = (): boolean =>
  typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);

const goldfishProxyUrl = (): string | undefined => {
  const raw = import.meta.env.VITE_LUGIN_GOLDFISH_PROXY_URL;
  return typeof raw === 'string' && raw.trim() ? raw.trim().replace(/\/$/, '') : undefined;
};

const isGoldfish = (url: string): boolean => url.startsWith(GOLDFISH);

const fetchViaGoldfishProxy = async (url: string, accept?: string): Promise<ApiResult> => {
  const base = goldfishProxyUrl();
  if (!base) {
    throw new Error(
      'MTGGoldfish is not configured for the phone app yet. Use the extension, or open the page on Goldfish.',
    );
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
