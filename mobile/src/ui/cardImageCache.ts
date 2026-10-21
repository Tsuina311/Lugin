const USER_AGENT = 'Lugin (Android)';
const MAX_CONCURRENT = 1;
/** Scryfall asks for 50–100ms between calls and answers 429 if we burst. */
const REQUEST_GAP_MS = 120;

type LegacyFS = typeof import('expo-file-system/legacy');

let directoryReady: Promise<string> | null = null;
/** Remote URL → local file. */
const saved = new Map<string, string>();
/** Remote URL → renderable image. Survives tab changes for this app process. */
const memory = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
let active = 0;
const queue: Array<() => void> = [];
let nextRequestAt = 0;

const fileKey = (url: string): string => {
  let a = 2166136261;
  let b = 5381;
  for (let i = 0; i < url.length; i++) {
    const code = url.charCodeAt(i);
    a = Math.imul(a ^ code, 16777619);
    b = (Math.imul(b, 33) ^ code) >>> 0;
  }
  return `${(a >>> 0).toString(16)}${b.toString(16)}`;
};

const withSlot = <T>(job: () => Promise<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    const run = () => {
      active += 1;
      job().then(resolve, reject).finally(() => {
        active -= 1;
        queue.shift()?.();
      });
    };
    if (active < MAX_CONCURRENT) run();
    else queue.push(run);
  });

const bytesToBase64 = (bytes: Uint8Array): string => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const parts: string[] = [];
  let out = '';
  const push = (chunk: string) => {
    out += chunk;
    if (out.length >= 2048) {
      parts.push(out);
      out = '';
    }
  };
  for (let i = 0; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    push(
      alphabet[(n >> 18) & 63] +
        alphabet[(n >> 12) & 63] +
        alphabet[(n >> 6) & 63] +
        alphabet[n & 63],
    );
  }
  const rem = bytes.length % 3;
  if (rem === 1) {
    const n = bytes[bytes.length - 1] << 16;
    push(`${alphabet[(n >> 18) & 63]}${alphabet[(n >> 12) & 63]}==`);
  } else if (rem === 2) {
    const n = (bytes[bytes.length - 2] << 16) | (bytes[bytes.length - 1] << 8);
    push(`${alphabet[(n >> 18) & 63]}${alphabet[(n >> 12) & 63]}${alphabet[(n >> 6) & 63]}=`);
  }
  if (out) parts.push(out);
  return parts.join('');
};

const sniff = (bytes: Uint8Array): { ext: string; mime: string } | null => {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45
  ) {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
};

const mimeForPath = (path: string): string => {
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
};

const resolveRedirect = (base: string, location: string): string => {
  if (/^https?:\/\//i.test(location)) return location;
  if (location.startsWith('//')) return `https:${location}`;
  const schemeEnd = base.indexOf('//');
  const rootEnd = schemeEnd === -1 ? -1 : base.indexOf('/', schemeEnd + 2);
  const root = rootEnd === -1 ? base : base.slice(0, rootEnd);
  if (location.startsWith('/')) return `${root}${location}`;
  return `${base.slice(0, base.lastIndexOf('/') + 1)}${location}`;
};

const pace = async (): Promise<void> => {
  const now = Date.now();
  const at = Math.max(now, nextRequestAt);
  nextRequestAt = at + REQUEST_GAP_MS;
  if (at > now) await new Promise(resolve => setTimeout(resolve, at - now));
};

const holdForRateLimit = (waitMs: number): void => {
  nextRequestAt = Math.max(nextRequestAt, Date.now() + waitMs);
};

const retryAfterMs = (response: Response, attempt: number): number => {
  const header = response.headers.get('Retry-After') ?? response.headers.get('retry-after');
  const seconds = header ? Number(header) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.max(seconds, 1) * 1000, 8000);
  return Math.min(1000 * 2 ** attempt, 8000);
};

const request = (url: string, manual: boolean): Promise<Response> =>
  fetch(url, {
    headers: {
      Accept: 'image/jpeg,image/png,image/webp,*/*;q=0.8',
      'User-Agent': USER_AGENT,
    },
    ...(manual ? { redirect: 'manual' as const } : {}),
  });

/**
 * Scryfall answers 400 to OkHttp's default User-Agent, including the card CDN.
 * Follow redirects ourselves so the app name is on every hop.
 */
const fetchPicture = async (start: string): Promise<Uint8Array> => {
  let url = start;
  let manual = true;
  let rateTries = 0;
  for (let hop = 0, steps = 0; hop < 6 && steps < 12; steps += 1) {
    await pace();
    let response: Response;
    try {
      response = await request(url, manual);
    } catch (error) {
      if (!manual) throw error;
      manual = false;
      continue;
    }
    if (manual && (response.status === 0 || response.type === 'opaqueredirect')) {
      manual = false;
      continue;
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location') ?? response.headers.get('location');
      if (!location) throw new Error(`Card image HTTP ${response.status} without a location`);
      url = resolveRedirect(url, location);
      hop += 1;
      continue;
    }
    if (response.status === 429 && rateTries < 5) {
      const wait = retryAfterMs(response, rateTries);
      rateTries += 1;
      holdForRateLimit(wait);
      await new Promise(resolve => setTimeout(resolve, wait));
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Card image HTTP ${response.status}`);
    }
    if (typeof response.arrayBuffer !== 'function') {
      throw new Error('This phone cannot read a picture download');
    }
    return new Uint8Array(await response.arrayBuffer());
  }
  throw new Error('Card image redirected too many times');
};

const cacheDirectory = (fs: LegacyFS): Promise<string> => {
  directoryReady ??= (async () => {
    const root = fs.cacheDirectory;
    if (!root) throw new Error('No cache directory');
    const dir = `${root}lugin-card-images/`;
    const info = await fs.getInfoAsync(dir);
    if (!info.exists) await fs.makeDirectoryAsync(dir, { intermediates: true });
    return dir;
  })().catch(error => {
    directoryReady = null;
    throw error;
  });
  return directoryReady;
};

const readDataUri = async (fs: LegacyFS, path: string): Promise<string> => {
  const base64 = await fs.readAsStringAsync(path, { encoding: fs.EncodingType.Base64 });
  return `data:${mimeForPath(path)};base64,${base64}`;
};

const diskPaths = (dir: string, url: string): string[] => {
  const key = fileKey(url);
  return [`${dir}${key}.jpg`, `${dir}${key}.png`, `${dir}${key}.webp`];
};

/** Synchronous memory hit, used so returning to a tab has no placeholder frame. */
export const peekCachedCardImage = (url: string): string | undefined => memory.get(url);

/** Download a card picture. Android's image view is refused by Scryfall. */
export const cachedCardImage = (url: string): Promise<string> => {
  const memoryHit = memory.get(url);
  if (memoryHit) return Promise.resolve(memoryHit);
  const running = pending.get(url);
  if (running) return running;

  const job = withSlot(async () => {
    const hit = saved.get(url);
    const fs = await import('expo-file-system/legacy');
    if (hit) {
      try {
        const info = await fs.getInfoAsync(hit);
        if (info.exists && info.size > 2000) {
          const dataUri = await readDataUri(fs, hit);
          memory.set(url, dataUri);
          return dataUri;
        }
      } catch {
        saved.delete(url);
      }
    }

    const dir = await cacheDirectory(fs);
    for (const path of diskPaths(dir, url)) {
      try {
        const info = await fs.getInfoAsync(path);
        if (!info.exists || info.size <= 2000) continue;
        const dataUri = await readDataUri(fs, path);
        saved.set(url, path);
        memory.set(url, dataUri);
        return dataUri;
      } catch {
        // Try the next supported file type.
      }
    }

    const bytes = await fetchPicture(url);
    const kind = sniff(bytes);
    if (!kind) throw new Error(`Card image was not a picture (${bytes.length} bytes)`);
    const base64 = bytesToBase64(bytes);
    const dataUri = `data:${kind.mime};base64,${base64}`;
    memory.set(url, dataUri);
    try {
      const dest = `${dir}${fileKey(url)}.${kind.ext}`;
      await fs.writeAsStringAsync(dest, base64, { encoding: fs.EncodingType.Base64 });
      saved.set(url, dest);
    } catch {
      // The picture can still show. The next visit downloads it again.
    }
    return dataUri;
  }).finally(() => {
    pending.delete(url);
  });

  pending.set(url, job);
  return job;
};

/** Resolve the first usable candidate while preserving the shared fallback order. */
export const preloadCardImageCandidates = async (
  candidates: readonly string[],
): Promise<string | null> => {
  for (const url of candidates) {
    const hit = memory.get(url);
    if (hit) return hit;
    try {
      return await cachedCardImage(url);
    } catch {
      // Try the less exact printing/name candidate.
    }
  }
  return null;
};

export const peekCardImageCandidates = (
  candidates: readonly string[],
): { uri: string; url: string } | null => {
  for (const url of candidates) {
    const hit = memory.get(url);
    if (hit) return { uri: hit, url };
  }
  return null;
};
