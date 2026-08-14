// Copy, Save, Share — named after what they do to your cards, not after where the
// cards are going.
//
// "Send to ManaBox" was the wrong label twice over: it promised one app when a
// list is just as welcome in Moxfield or a message to a friend, and it promised a
// route that doesn't exist, since ManaBox takes a deck as pasted text and never
// appears in a file share sheet. What each button does is now on the button.
//
// The file is built on tap rather than on render: a collection export is every row
// you own, and formatting tens of thousands of them to fill a prop would cost that
// on every keystroke of the search box above it.

import { useEffect, useRef, useState } from 'react';

import { canShareFiles, copyText, saveFile, shareFile } from './share';

import type { ExportFile } from '@/lib/export';

export type ExportAction = 'copy' | 'save' | 'share';

const LABEL: Record<ExportAction, string> = { copy: 'Copy', save: 'Save', share: 'Share' };

export const ExportBar = ({
  actions,
  className = '',
  file,
}: {
  actions: readonly ExportAction[];
  className?: string;
  /** Built on tap, not on render. */
  file: () => ExportFile;
}) => {
  const [said, setSaid] = useState<Partial<Record<ExportAction, string>>>({});
  // Asked after mount, not during render: it reads `navigator`, which the render
  // check in web/smoke.tsx runs without.
  const [shareable, setShareable] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    setShareable(canShareFiles());
    const running = timers.current;
    return () => running.forEach(clearTimeout);
  }, []);

  const say = (action: ExportAction, message: string | null): void => {
    setSaid(prev => ({ ...prev, [action]: message ?? undefined }));
    if (message) timers.current.push(setTimeout(() => say(action, null), 4000));
  };

  const run = async (action: ExportAction): Promise<void> => {
    const out = file();
    try {
      if (action === 'copy') {
        await copyText(out.text);
        say('copy', 'Copied');
      } else if (action === 'save') {
        saveFile(out);
        say('save', 'Saved');
      } else if ((await shareFile(out)) === 'shared') {
        say('share', 'Sent');
      }
    } catch {
      // Which one failed matters more than why: the other two are still routes out.
      say(action, 'Failed');
    }
  };

  return (
    <div className={`flex shrink-0 items-center gap-1.5 ${className}`}>
      {actions
        .filter(action => action !== 'share' || shareable)
        .map(action => (
          <button
            key={action}
            className="rounded-md bg-raised px-2.5 py-1.5 text-[11px] font-medium text-ink-muted active:bg-line"
            onClick={() => void run(action)}
            type="button"
          >
            {said[action] ?? LABEL[action]}
          </button>
        ))}
    </div>
  );
};
