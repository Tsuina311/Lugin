import type { TaskProgress } from '@/content/taskQueue';
import type { CapturedCall } from '@/lib/types';

/** Small presentation helpers shared across the overlay UI. */

/**
 * A running task's progress as one line: "12/35 · 2 skipped · Card name".
 *
 * Where a task distinguishes the two, the first number is what it achieved
 * rather than what it attempted, so it can be held against the site's own view;
 * anything it had to give up on is counted apart instead of quietly padding the
 * total. The trailing label is whatever it has in hand.
 */
export const taskProgress = (p: TaskProgress): string => {
  const added = p.added ?? p.current;
  const skipped = p.current - added;
  return [`${added}/${p.total}`, skipped > 0 ? `${skipped} skipped` : '', p.label]
    .filter(Boolean)
    .join(' · ');
};

export const shortUrl = (url: string): string => {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
};

export const originOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

export const statusColor = (status?: number): string => {
  if (status == null) return 'text-slate-400';
  if (status >= 500) return 'text-red-400';
  if (status >= 400) return 'text-amber-400';
  if (status >= 300) return 'text-sky-400';
  if (status >= 200) return 'text-emerald-400';
  return 'text-slate-400';
};

export const methodColor = (method: string): string => {
  switch (method) {
    case 'GET':
      return 'bg-emerald-500/15 text-emerald-300';
    case 'POST':
      return 'bg-sky-500/15 text-sky-300';
    case 'PUT':
    case 'PATCH':
      return 'bg-amber-500/15 text-amber-300';
    case 'DELETE':
      return 'bg-red-500/15 text-red-300';
    default:
      return 'bg-slate-500/15 text-slate-300';
  }
};

export const formatDuration = (ms?: number): string => {
  if (ms == null) return '…';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
};

/** Pretty-print JSON when possible; otherwise return the original text. */
export const prettyBody = (body?: string): string => {
  if (!body) return '';
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
};

/** Parse a URL's query string into [key, value] pairs for display. */
export const queryParams = (url: string): [string, string][] => {
  try {
    return Array.from(new URL(url).searchParams.entries());
  } catch {
    return [];
  }
};

/** Look up a header case-insensitively. */
export const header = (
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined => {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
};

/** Build a runnable cURL command that reproduces the captured request. */
export const toCurl = (call: CapturedCall): string => {
  const parts = [`curl '${call.url}'`];
  if (call.method && call.method !== 'GET') parts.push(`-X ${call.method}`);
  for (const [k, v] of Object.entries(call.requestHeaders ?? {})) {
    parts.push(`-H '${k}: ${v.replace(/'/g, "'\\''")}'`);
  }
  if (call.requestBody) {
    parts.push(`--data-raw '${call.requestBody.replace(/'/g, "'\\''")}'`);
  }
  return parts.join(' \\\n  ');
};

/** Build a JS fetch() snippet that reproduces the captured request. */
export const toFetchSnippet = (call: CapturedCall): string => {
  const init: Record<string, unknown> = { method: call.method };
  if (call.requestHeaders && Object.keys(call.requestHeaders).length) {
    init.headers = call.requestHeaders;
  }
  if (call.requestBody) init.body = call.requestBody;
  init.credentials = 'include';
  return `fetch(${JSON.stringify(call.url)}, ${JSON.stringify(init, null, 2)})`;
};
