// "Send to ManaBox", and the two words back that say where it went.
//
// The file is built on tap rather than on render: a collection export is every
// row you own, and formatting tens of thousands of them to fill a button's props
// would cost that on every keystroke of the search box above it.
//
// Where it ended up is worth saying, because the two outcomes look nothing alike —
// a share sheet is its own confirmation, a download is a file somewhere you have
// to go and find. The button says so itself for a moment instead of a banner
// appearing somewhere else on the screen.

import { useEffect, useRef, useState } from 'react';

import { shareFile, type ShareOutcome } from './share';

import type { ExportFile } from '@/lib/export';

const SAID: Partial<Record<ShareOutcome, string>> = {
  downloaded: 'Saved to your files',
  shared: 'Sent',
};

export const ShareButton = ({
  className = '',
  file,
  label,
}: {
  className?: string;
  /** Built on tap, not on render. */
  file: () => ExportFile;
  label: string;
}) => {
  const [said, setSaid] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <button
      className={`shrink-0 rounded-md bg-raised px-2.5 py-1.5 text-[11px] font-medium text-ink-muted active:bg-line disabled:opacity-50 ${className}`}
      onClick={async () => {
        const outcome = await shareFile(file());
        setSaid(SAID[outcome] ?? null);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setSaid(null), 4000);
      }}
      type="button"
    >
      {said ?? label}
    </button>
  );
};
