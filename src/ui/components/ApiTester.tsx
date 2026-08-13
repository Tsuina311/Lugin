import { useState } from 'react';

import { prettyBody, statusColor } from '../format';

import { Button } from './Button';

import { requestApi } from '@/lib/messaging';
import type { ApiResult } from '@/lib/types';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/**
 * A small playground for the "fetch from an API" use case. Requests are run by
 * the background service worker (see requestApi), so they aren't subject to the
 * page's CORS rules. This is the seed for building your own custom actions on
 * top of the site's API.
 */
export const ApiTester = () => {
  const [method, setMethod] = useState<(typeof METHODS)[number]>('GET');
  const [url, setUrl] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await requestApi({
        body: method === 'GET' ? undefined : body || undefined,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        method,
        url,
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-2 overflow-auto p-3">
      <div className="flex gap-1.5">
        <select
          className="rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[11px] text-slate-200 outline-none focus:border-sky-500"
          onChange={e => setMethod(e.target.value as (typeof METHODS)[number])}
          value={method}
        >
          {METHODS.map(m => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-[11px] text-slate-200 outline-none focus:border-sky-500"
          onChange={e => setUrl(e.target.value)}
          placeholder="https://api.example.com/endpoint"
          value={url}
        />
        <Button disabled={loading || !url} onClick={send} size="md" variant="primary">
          {loading ? '…' : 'Send'}
        </Button>
      </div>

      {method !== 'GET' && (
        <textarea
          className="w-full rounded border border-slate-700 bg-slate-900 p-2 font-mono text-[11px] text-slate-200 outline-none focus:border-sky-500"
          onChange={e => setBody(e.target.value)}
          placeholder='Request body (e.g. {"key":"value"})'
          rows={4}
          value={body}
        />
      )}

      {error && (
        <div className="rounded border border-red-700/60 bg-red-950/40 p-2 text-[11px] text-red-300">
          {error}
        </div>
      )}

      {result && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-1 flex items-center gap-2 text-[11px]">
            <span className={`font-semibold ${statusColor(result.status)}`}>
              {result.status} {result.statusText}
            </span>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto rounded border border-slate-700/60 bg-slate-950/60 p-2 font-mono text-[11px] leading-relaxed text-slate-200">
            {prettyBody(result.body)}
          </pre>
        </div>
      )}
    </div>
  );
};
