import { formatDuration, methodColor, shortUrl, statusColor } from '../format';

import type { CapturedCall } from '@/lib/types';

interface Props {
  calls: CapturedCall[];
  onSelect: (id: string) => void;
  selectedId: string | null;
}

export const CallList = ({ calls, selectedId, onSelect }: Props) => {
  if (calls.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-slate-500">
        No calls captured yet. Interact with the page and watch its fetch / XHR traffic appear here.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-800/70">
      {calls.map(call => {
        const pending = call.endedAt == null && !call.error;
        return (
          <li key={call.id}>
            <button
              className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-slate-800/60 ${
                selectedId === call.id ? 'bg-slate-800' : ''
              }`}
              onClick={() => onSelect(call.id)}
              type="button"
            >
              <span
                className={`w-12 shrink-0 rounded px-1 py-0.5 text-center text-[9px] font-bold ${methodColor(
                  call.method,
                )}`}
              >
                {call.method}
              </span>
              <span
                className={`w-9 shrink-0 text-[11px] font-semibold ${statusColor(call.status)}`}
              >
                {pending ? (
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
                ) : (
                  (call.status ?? 'ERR')
                )}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-300">
                {call.origin === 'replay' && (
                  <span className="mr-1 rounded bg-violet-500/20 px-1 py-0.5 text-[8px] font-bold uppercase text-violet-300">
                    replay
                  </span>
                )}
                {shortUrl(call.url)}
              </span>
              <span className="shrink-0 text-[10px] tabular-nums text-slate-500">
                {formatDuration(call.durationMs)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
};
