import { useState } from 'react';

import {
  formatDuration,
  header,
  methodColor,
  prettyBody,
  queryParams,
  statusColor,
  toCurl,
  toFetchSnippet,
} from '../format';

import { Button } from './Button';

import { replayInPage } from '@/lib/messaging';
import type { ApiRequest, ApiResult, CapturedCall } from '@/lib/types';

const Section = ({ title, children }: { children: React.ReactNode; title: string }) => {
  return (
    <div className="mb-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </div>
      {children}
    </div>
  );
};

const HeaderTable = ({ headers }: { headers?: Record<string, string> }) => {
  const entries = Object.entries(headers ?? {});
  if (entries.length === 0) return <div className="text-xs text-slate-500">None</div>;
  return (
    <div className="overflow-hidden rounded border border-slate-700/60">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-2 border-b border-slate-700/40 px-2 py-1 last:border-b-0">
          <span className="shrink-0 font-mono text-[11px] text-sky-300">{k}</span>
          <span className="break-all font-mono text-[11px] text-slate-300">{v}</span>
        </div>
      ))}
    </div>
  );
};

const Body = ({ body, truncated }: { body?: string; truncated?: boolean }) => {
  if (!body) return <div className="text-xs text-slate-500">Empty</div>;
  return (
    <div>
      <pre className="max-h-64 overflow-auto rounded border border-slate-700/60 bg-slate-950/60 p-2 font-mono text-[11px] leading-relaxed text-slate-200">
        {prettyBody(body)}
      </pre>
      {truncated && (
        <div className="mt-1 text-[10px] text-amber-400">Body truncated at 512 KB.</div>
      )}
    </div>
  );
};

const CopyButton = ({ label, getText }: { getText: () => string; label: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(getText());
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* clipboard may be blocked; ignore */
        }
      }}
      size="xs"
      variant="neutral"
    >
      {copied ? 'Copied!' : label}
    </Button>
  );
};

const QueryTable = ({ url }: { url: string }) => {
  const params = queryParams(url);
  if (params.length === 0) return null;
  return (
    <Section title={`Query params (${params.length})`}>
      <div className="overflow-hidden rounded border border-slate-700/60">
        {params.map(([k, v], i) => (
          <div
            key={i}
            className="flex gap-2 border-b border-slate-700/40 px-2 py-1 last:border-b-0"
          >
            <span className="shrink-0 font-mono text-[11px] text-emerald-300">{k}</span>
            <span className="break-all font-mono text-[11px] text-slate-300">{v}</span>
          </div>
        ))}
      </div>
    </Section>
  );
};

const ReplaySection = ({ call }: { call: CapturedCall }) => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const replay = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    const request: ApiRequest = {
      body: call.requestBody,
      headers: call.requestHeaders,
      method: call.method,
      url: call.url,
    };
    try {
      setResult(await replayInPage(request));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Section title="Replay (runs in the page, using your session)">
      <Button disabled={loading} onClick={replay} size="md" variant="primary">
        {loading ? 'Replaying…' : 'Replay this request'}
      </Button>

      {error && (
        <div className="mt-2 rounded border border-red-700/60 bg-red-950/40 p-2 text-[11px] text-red-300">
          {error}
        </div>
      )}
      {result && (
        <div className="mt-2">
          <div className="mb-1 text-[11px]">
            <span className={`font-semibold ${statusColor(result.status)}`}>
              {result.status} {result.statusText}
            </span>
          </div>
          <pre className="max-h-64 overflow-auto rounded border border-slate-700/60 bg-slate-950/60 p-2 font-mono text-[11px] leading-relaxed text-slate-200">
            {prettyBody(result.body)}
          </pre>
        </div>
      )}
    </Section>
  );
};

export const CallDetail = ({ call }: { call: CapturedCall }) => {
  const reqType = header(call.requestHeaders, 'content-type');
  const resType = header(call.responseHeaders, 'content-type');

  return (
    <div className="flex h-full flex-col overflow-auto p-3">
      <div className="mb-3 flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${methodColor(call.method)}`}>
          {call.method}
        </span>
        <span className={`text-xs font-semibold ${statusColor(call.status)}`}>
          {call.status ?? (call.error ? 'ERR' : 'pending')}
        </span>
        <span className="ml-auto text-[10px] text-slate-500">
          {formatDuration(call.durationMs)} · {call.source}
        </span>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <CopyButton getText={() => toCurl(call)} label="Copy as cURL" />
        <CopyButton getText={() => toFetchSnippet(call)} label="Copy as fetch" />
        <CopyButton getText={() => call.url} label="Copy URL" />
      </div>

      <Section title="URL">
        <div className="break-all rounded border border-slate-700/60 bg-slate-950/60 p-2 font-mono text-[11px] text-slate-200">
          {call.url}
        </div>
        {(reqType || resType) && (
          <div className="mt-1 flex flex-wrap gap-x-4 text-[10px] text-slate-500">
            {reqType && <span>request: {reqType}</span>}
            {resType && <span>response: {resType}</span>}
          </div>
        )}
      </Section>

      <QueryTable url={call.url} />

      {call.error && (
        <Section title="Error">
          <div className="rounded border border-red-700/60 bg-red-950/40 p-2 text-xs text-red-300">
            {call.error}
          </div>
        </Section>
      )}

      <ReplaySection call={call} />

      <Section title="Request Headers">
        <HeaderTable headers={call.requestHeaders} />
      </Section>

      <Section title="Request Body">
        <Body body={call.requestBody} />
      </Section>

      <Section title="Response Headers">
        <HeaderTable headers={call.responseHeaders} />
      </Section>

      <Section title="Response Body">
        <Body body={call.responseBody} truncated={call.responseTruncated} />
      </Section>
    </div>
  );
};
