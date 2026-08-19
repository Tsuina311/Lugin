import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { Button } from './Button';
import { IconButton } from './IconButton';
import { CircleAlert, Loader2 } from './icons';

import { taskQueue } from '@/content/taskQueue';
import { taskProgress } from '@/ui/format';

// Whether Lugin is busy, and with what.
//
// The long jobs — reading want lists, walking order history, scanning a seller —
// run one at a time in a queue that survives page changes, so at any moment there
// may be something happening that no tab is showing. That list used to live inside
// a "Tools" disclosure in the Cards tab: to find out whether your purchase sync
// was still running, you opened an unrelated tab and expanded a panel.
//
// It belongs in the header, where "is it doing something" is a glance and the
// detail is a hover. Nothing is drawn when nothing is happening, which is most of
// the time — an idle indicator is just furniture.

export const TaskIndicator = () => {
  const tasks = useSyncExternalStore(taskQueue.subscribe, taskQueue.getSnapshot);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

  const active = tasks.filter(t => t.status === 'queued' || t.status === 'running');
  const failed = tasks.filter(t => t.status === 'error');
  const running = active.find(t => t.status === 'running');

  // Close when the last thing finishes, so a hover-opened panel doesn't sit there
  // over an empty list.
  useEffect(() => {
    if (active.length === 0 && failed.length === 0) setOpen(false);
  }, [active.length, failed.length]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      // `contains` is no use here: the overlay lives in a shadow root, so by the
      // time the event reaches the document its target has been retargeted to the
      // host and every click would look like an outside one. Same trick as SyncButton.
      const inside = box.current !== null && e.composedPath().includes(box.current);
      if (!inside) setOpen(false);
    };
    document.addEventListener('mousedown', close, true);
    return () => document.removeEventListener('mousedown', close, true);
  }, [open]);

  // A failure is worth a mark until it's dismissed; silence would just look like
  // the job never ran.
  if (active.length === 0 && failed.length === 0) return null;

  const busy = active.length > 0;
  const label = busy
    ? `${running?.label ?? active[0].label}${
        running?.progress ? ` — ${taskProgress(running.progress)}` : ' — starting…'
      }${active.length > 1 ? ` (+${active.length - 1} waiting)` : ''}`
    : `${failed.length} task${failed.length === 1 ? '' : 's'} failed`;

  return (
    <div
      ref={box}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <IconButton
        active={open}
        className={busy ? '[&>svg]:animate-spin' : ''}
        icon={busy ? Loader2 : CircleAlert}
        label={label}
        onClick={() => setOpen(o => !o)}
        tone={busy ? 'accent' : 'danger'}
      />

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded-md border border-line-strong bg-panel p-2 text-xs shadow-pop">
          <div className="mb-1 flex items-center gap-2">
            <span className="font-medium text-ink">{busy ? 'Working' : 'Finished'}</span>
            {busy && (
              <span className="text-2xs text-ink-faint">
                one at a time · keeps going as you browse
              </span>
            )}
            {failed.length > 0 && (
              <Button
                className="ml-auto"
                onClick={() => taskQueue.clearFinished()}
                size="xs"
                variant="subtle"
              >
                Dismiss
              </Button>
            )}
          </div>

          <div className="max-h-48 space-y-1 overflow-auto">
            {[...active, ...failed].map(t => (
              <div key={t.id} className="flex items-center gap-1.5">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    t.status === 'running'
                      ? 'animate-pulse bg-accent'
                      : t.status === 'queued'
                        ? 'bg-ink-faint'
                        : 'bg-neg'
                  }`}
                />
                <span className="shrink-0 text-ink">{t.label}</span>
                <span className="min-w-0 flex-1 truncate text-2xs text-ink-muted">
                  {t.status === 'running'
                    ? t.progress
                      ? taskProgress(t.progress)
                      : 'starting…'
                    : t.status === 'queued'
                      ? 'waiting'
                      : (t.error ?? 'failed')}
                </span>
                {(t.status === 'queued' || t.status === 'running') && (
                  <Button
                    className="shrink-0"
                    onClick={() => taskQueue.cancel(t.id)}
                    size="xs"
                    variant="subtle"
                  >
                    {t.status === 'queued' ? 'Cancel' : 'Stop'}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
