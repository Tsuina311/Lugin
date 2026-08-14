// Handing a file to Android's share sheet, which is how it reaches ManaBox.
//
// The mirror of the share *target* the manifest registers: that lets ManaBox send
// a scan to Lugin, this lets Lugin send a deck back. Both directions are files
// through the OS, because ManaBox exposes no other way in.
//
// Sharing can fail for reasons that are none of the user's business — a browser
// without the API, a desktop, a file type the platform won't carry — so a
// download is always the floor. Something lands either way, and what lands is the
// same bytes ManaBox's import reads.

import type { ExportFile } from '@/lib/export';

export type ShareOutcome = 'cancelled' | 'downloaded' | 'shared';

const download = (out: ExportFile): void => {
  const url = URL.createObjectURL(new Blob([out.text], { type: out.mime }));
  const anchor = document.createElement('a');
  anchor.download = out.name;
  anchor.href = url;
  anchor.click();
  // Revoked late: Safari has been known to abandon the download if the URL dies
  // in the same tick as the click.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

export const shareFile = async (out: ExportFile): Promise<ShareOutcome> => {
  const file = typeof File === 'undefined' ? null : new File([out.text], out.name, { type: out.mime });

  // `canShare` first: calling `share` with files a platform won't take throws,
  // and on some Android builds only after the sheet has flashed up.
  if (file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: out.name });
      return 'shared';
    } catch (err) {
      // Dismissing the sheet is a decision, not a failure, and must not then
      // dump a file in Downloads behind their back.
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    }
  }

  download(out);
  return 'downloaded';
};
