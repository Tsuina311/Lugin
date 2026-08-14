// Getting a file out of the app: to the clipboard, to storage, or to another app.
//
// Three ways rather than one, because the apps we hand cards to disagree about
// how they take them. ManaBox is the case in point: its deck import reads pasted
// text or a URL and has no file picker at all, while its collection import wants a
// CSV chosen from storage. So a share sheet — the obvious answer, and the one that
// looks best in a screenshot — is the *only* one of the three that cannot import a
// deck into ManaBox. It stays because Drive, mail and the rest do accept files,
// but it can't be the single route out.
//
// The mirror of this is the share *target* in the manifest, which is how ManaBox
// sends a scan in. That direction has a share sheet because ManaBox exports files;
// this direction mostly doesn't, because ManaBox imports text.

import type { ExportFile } from '@/lib/export';

export type ShareOutcome = 'cancelled' | 'shared';

/** A File the platform can be asked about without building the real export. */
const probe = (): File | null =>
  typeof File === 'undefined' ? null : new File([''], 'probe.csv', { type: 'text/csv' });

/** Whether a share sheet is worth offering at all — desktop and iOS often say no. */
export const canShareFiles = (): boolean => {
  const file = probe();
  return Boolean(file && navigator.canShare?.({ files: [file] }));
};

export const saveFile = (out: ExportFile): void => {
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
  const file = new File([out.text], out.name, { type: out.mime });
  try {
    await navigator.share({ files: [file], title: out.name });
    return 'shared';
  } catch (err) {
    // Dismissing the sheet is a decision, not a failure, and must not then leave a
    // file in Downloads behind their back.
    if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
    throw err;
  }
};

export const copyText = async (text: string): Promise<void> => {
  // The async clipboard needs a secure context, which the app has, but a WebView
  // or an older browser can still refuse it — hence the old selection dance as a
  // floor. It has to be in the document to be selectable, so it goes in and comes
  // straight back out.
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  try {
    area.select();
    if (!document.execCommand('copy')) throw new Error('the browser refused to copy');
  } finally {
    area.remove();
  }
};
