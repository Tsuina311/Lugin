// HTTP fetch for APIs that block page CORS in the extension build.
//
// The extension routes through its background worker; the phone build calls
// directly when the target sends permissive CORS headers (Scryfall, EDHREC JSON).

import { requestApi } from './messaging';
import type { ApiResult } from './types';

export const fetchRemote = async (url: string, accept?: string): Promise<ApiResult> => {
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
      return await requestApi({ url });
    }
  } catch {
    // Unpacked builds can throw when the runtime is gone — fall through to fetch.
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
