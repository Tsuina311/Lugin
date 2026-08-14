// Importing a ManaBox export, on the phone.
//
// This is the screen the whole phone build exists for: the cards are scanned on
// the phone, so the file is on the phone, and asking someone to mail it to their
// desktop to get it into their collection would be absurd.
//
// The review itself is `ImportReview`, unchanged and unwrapped — the same
// component the extension shows. That is the point of it having no platform in
// it: the questions asked of a file, and the answers available, must not depend
// on which device you happened to be holding.
//
// What's different here is only the shell: a big tap target instead of a
// toolbar, and file input attributes that make Android offer Files and ManaBox's
// own share sheet rather than the camera.

import { useState } from 'react';

import type { SharedImport } from './sharedImport';

import type { CollectionCard } from '@/lib/collection';
import {
  inspectImport,
  type ImportDecision,
  type ImportFormat,
  type ImportInspection,
} from '@/lib/import';
import { ImportReview } from '@/ui/components/ImportReview';


interface ImportScreenProps {
  /** Rows to match against, so duplicates are found before anything is written. */
  existing: CollectionCard[];
  /**
   * A file shared to the app from elsewhere, to review instead of asking for one.
   * Read at mount; the caller remounts this screen (by key) to offer a new one.
   */
  incoming?: SharedImport | null;
  onImport: (
    decisions: ImportDecision[],
    file: { format: ImportFormat; source: string },
  ) => Promise<void>;
}

/** A file read but not yet applied. */
interface Pending {
  inspection: ImportInspection;
  source: string;
}

export const ImportScreen = ({ existing, incoming, onImport }: ImportScreenProps) => {
  // A shared file opens straight into the review, since picking it was the tap
  // that got us here. Parsed in the initialiser rather than an effect so it never
  // renders the picker first and flickers past it.
  const [pending, setPending] = useState<Pending | null>(() =>
    incoming ? { inspection: inspectImport(incoming.text), source: incoming.name } : null,
  );
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const read = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setFailed(null);
    setBusy(true);
    try {
      const text = await file.text();
      setPending({ inspection: inspectImport(text), source: file.name });
    } catch {
      // Reading a local file barely fails, but a share-sheet handoff can expire
      // between the pick and the read, and that must not look like a crash.
      setFailed('That file couldn’t be read. Try picking it again.');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (decisions: ImportDecision[]): Promise<void> => {
    if (!pending) return;
    setBusy(true);
    try {
      await onImport(decisions, {
        format: pending.inspection.format,
        source: pending.source,
      });
      setPending(null);
    } finally {
      setBusy(false);
    }
  };

  if (pending) {
    return (
      <div className="h-full p-3">
        <ImportReview
          busy={busy}
          existing={existing}
          inspection={pending.inspection}
          onCancel={() => setPending(null)}
          onConfirm={decisions => void confirm(decisions)}
          source={pending.source}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-5 px-6 py-10 text-center">
      <h2 className="text-base font-semibold text-ink">Add cards from ManaBox</h2>
      <p className="max-w-xs text-sm leading-relaxed text-ink-muted">
        In ManaBox, export a collection, a binder or a deck, then pick the file here. Lugin works out
        which it is and shows you before anything changes.
      </p>

      <label className="w-full max-w-xs">
        {/* A label rather than a button: tapping it opens the picker with no
            script, so it still works if the JS handler hasn't hydrated yet. */}
        <span className="block rounded-lg bg-accent px-5 py-3.5 text-sm font-semibold text-accent-ink active:bg-accent-strong">
          {busy ? 'Reading…' : 'Choose a file'}
        </span>
        <input
          // Every spelling of "a CSV" that an Android picker might report, plus
          // the ones that aren't spellings at all: a file arriving from Drive or a
          // share sheet is routinely typed application/octet-stream, and Android
          // has historically called .csv application/vnd.ms-excel. Anything
          // missing from this list is greyed out in the picker — the user can see
          // their export and not select it — so it is deliberately generous, and
          // `inspectImport` is what actually decides whether a file is usable.
          accept={[
            '.csv',
            '.txt',
            '.tsv',
            'text/csv',
            'text/plain',
            'text/tab-separated-values',
            'text/comma-separated-values',
            'application/csv',
            'application/vnd.ms-excel',
            'application/octet-stream',
          ].join(',')}
          className="sr-only"
          disabled={busy}
          onChange={event => void read(event.target.files?.[0])}
          type="file"
        />
      </label>

      {failed ? <p className="text-xs text-neg">{failed}</p> : null}

      <p className="max-w-xs text-xs leading-relaxed text-ink-faint">
        Imports are saved on this phone first, then synced to your Drive — so this works with no
        signal, and catches up later.
      </p>
    </div>
  );
};
