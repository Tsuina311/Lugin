// Decks, and the two questions worth asking about them away from the desk:
// what's still missing, and can I start a new one?
//
// `deckShortfall` is the extension's own comparison, reused unchanged — so the
// shopping list on the phone can't drift from the one on the desktop. Creating
// works the same way for the same reason: the desktop offers an empty deck of a
// chosen format and a decklist to import, and both doors are here, over the same
// `newDeck` and `deckFromImport` the extension builds with.
//
// Pasting is the phone's version of the desktop's file picker. A decklist on a
// phone is far more often in the clipboard — copied out of Moxfield or a forum
// post — than it is a file, and the file route is already covered by the Import
// tab and the ManaBox share sheet.
//
// Copy / save / share live on each list row: exporting is about the deck as a
// whole, not something you do while editing cards.

import { useMemo, useState } from 'react';

import { DeckEditor } from './DeckEditor';
import { ExportBar } from './ExportBar';
import { syncStore } from './syncStore';

import { candidatesByName, deckCardCandidates } from '@/lib/cardImage';
import type { Collection } from '@/lib/collection';
import {
  DECK_FORMATS,
  deckShortfall,
  formatInfo,
  type Deck,
  type DeckFormat,
} from '@/lib/deck';
import { deckFile } from '@/lib/export';
import { CollectionThumb } from '@/ui/components/CollectionThumb';

const copies = (deck: Deck): number =>
  deck.cards
    .filter(card => card.section !== 'sideboard')
    .reduce((sum, card) => sum + card.quantity, 0);

/** Face for the list row: commander when the format has one, else the first main card. */
const previewCardName = (deck: Deck): string | null => {
  if (formatInfo(deck.format).commanderZone) {
    const commander = deck.cards.find(card => card.section === 'commander');
    if (commander) return commander.name;
  }
  const first =
    deck.cards.find(card => card.section === 'main') ??
    deck.cards.find(card => card.section !== 'sideboard') ??
    deck.cards[0];
  return first?.name ?? null;
};

const FormatPicker = ({
  onChange,
  value,
}: {
  onChange: (format: DeckFormat) => void;
  value: DeckFormat;
}) => (
  <select
    aria-label="Format for the new deck"
    className="rounded-lg border border-line-strong bg-raised px-2 py-2.5 text-sm text-ink"
    onChange={event => onChange(event.target.value as DeckFormat)}
    value={value}
  >
    {DECK_FORMATS.map(format => (
      <option key={format.id} value={format.id}>
        {format.label}
      </option>
    ))}
  </select>
);

/** The paste sheet: the phone's answer to the desktop's "upload a decklist". */
const PasteList = ({
  busy,
  onCancel,
  onPaste,
}: {
  busy: boolean;
  onCancel: () => void;
  onPaste: (text: string) => void;
}) => {
  const [text, setText] = useState('');
  return (
    <div className="border-b border-line px-4 py-3">
      <textarea
        aria-label="Decklist"
        autoCapitalize="none"
        autoCorrect="off"
        className="h-40 w-full rounded-lg border border-line-strong bg-raised px-3 py-2.5 font-mono text-sm text-ink placeholder:text-ink-faint"
        onChange={event => setText(event.target.value)}
        placeholder={'1 Sol Ring\n1 Rhystic Study\n…'}
        value={text}
      />
      <p className="mt-1 text-[11px] text-ink-faint">
        Arena, MTGO, Moxfield and ManaBox lists all work, section headers included.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          className="flex-1 rounded-lg bg-accent py-2.5 text-sm font-semibold text-accent-ink disabled:opacity-40"
          disabled={busy || !text.trim()}
          onClick={() => onPaste(text)}
          type="button"
        >
          {busy ? 'Reading…' : 'Make a deck from this'}
        </button>
        <button
          className="rounded-lg px-4 text-sm font-medium text-ink-muted"
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export const DeckList = ({
  collection,
  decks,
}: {
  collection: Collection | null;
  decks: readonly Deck[];
}) => {
  const [openId, setOpenId] = useState<string | null>(null);
  const [format, setFormat] = useState<DeckFormat>('commander');
  const [pasting, setPasting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ownedCandidates = useMemo(
    () => candidatesByName(collection?.cards ?? []),
    [collection],
  );

  const open = decks.find(deck => deck.id === openId);
  if (open) return <DeckEditor collection={collection} deck={open} onBack={() => setOpenId(null)} />;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      setOpenId(await syncStore.createDeck(format));
    } finally {
      setBusy(false);
    }
  };

  const paste = async (text: string) => {
    setBusy(true);
    setError(null);
    try {
      const id = await syncStore.importDeckList(text, 'pasted list');
      if (!id) {
        setError('No cards found in that list.');
        return;
      }
      setPasting(false);
      setOpenId(id);
    } finally {
      setBusy(false);
    }
  };

  const sorted = [...decks].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <FormatPicker onChange={setFormat} value={format} />
        <button
          className="flex-1 rounded-lg bg-accent py-2.5 text-sm font-semibold text-accent-ink disabled:opacity-40"
          disabled={busy}
          onClick={() => void create()}
          type="button"
        >
          New deck
        </button>
        <button
          aria-pressed={pasting}
          className={`rounded-lg border border-line-strong px-3 py-2.5 text-sm font-medium ${
            pasting ? 'bg-raised text-ink' : 'text-ink-muted'
          }`}
          onClick={() => setPasting(value => !value)}
          type="button"
        >
          Paste
        </button>
      </div>

      {pasting ? (
        <PasteList busy={busy} onCancel={() => setPasting(false)} onPaste={text => void paste(text)} />
      ) : null}

      {error ? <p className="border-b border-line bg-neg-soft px-4 py-2 text-xs text-neg">{error}</p> : null}

      {decks.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-ink-muted">
          No decks yet. Start an empty one above and add cards to it, or paste a list you already
          have.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {sorted.map(deck => {
            const missing = collection ? deckShortfall(deck.cards, collection.byKey).length : 0;
            const face = previewCardName(deck);
            const candidates = face ? deckCardCandidates(face, ownedCandidates) : [];
            return (
              <li key={deck.id} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <button
                    className="flex min-w-0 flex-1 items-center gap-3 text-left active:opacity-80"
                    onClick={() => setOpenId(deck.id)}
                    type="button"
                  >
                    {face ? (
                      <CollectionThumb
                        candidates={candidates}
                        className="h-14 w-10 flex-none overflow-hidden rounded-md bg-raised"
                        imgStyle={{ objectPosition: '50% 18%' }}
                        name={face}
                        previewKey={`decklist|${deck.id}|${face}`}
                      />
                    ) : (
                      <span className="h-14 w-10 flex-none rounded-md bg-raised" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{deck.name}</span>
                      <span className="mt-0.5 block text-[11px] capitalize text-ink-faint">
                        {deck.format} · {copies(deck)} cards
                        {missing > 0 ? ` · ${missing} missing` : ''}
                      </span>
                    </span>
                  </button>
                  <ExportBar actions={['copy', 'save', 'share']} file={() => deckFile(deck)} />
                  <button
                    aria-label={`Open ${deck.name}`}
                    className="shrink-0 px-1 text-ink-faint"
                    onClick={() => setOpenId(deck.id)}
                    type="button"
                  >
                    ›
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};
