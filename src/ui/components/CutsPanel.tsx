// Suggested cuts: the cards in this deck that few other decks with the same
// commander play. EDHREC's commander page tells us the share of decks that run
// each card, so anything below a threshold is a candidate to swap out.
//
// The lists EDHREC publishes are themselves truncated — cards played in only a
// couple of percent of decks don't make them at all. So a card we can't find is
// the *weakest* signal of all, and we report it as "under <the least-played
// listed card>%" rather than pretending we know the exact number.

import { useEffect, useMemo, useState } from 'react';

import { Button } from './Button';
import { NumberStepper } from './Field';
import { SelectionBar } from './Selection';
import { useCardPreview } from './cardPreview';

import { cardKey } from '@/lib/cardName';
import type { DeckCard } from '@/lib/deck';
import { EdhrecNotFound, fetchEdhrec, type EdhrecData } from '@/lib/edhrec';
import { isBasicLand } from '@/lib/lands';
import type { CardMetadata } from '@/lib/mtg';
import { useRowSelection, type RowSelection } from '@/ui/useRowSelection';

const THRESHOLD_KEY = 'lugin:deckCutThreshold';
const DEFAULT_THRESHOLD = 10;

const readThreshold = (): number => {
  try {
    const raw = Number(localStorage.getItem(THRESHOLD_KEY));
    return Number.isFinite(raw) && raw > 0 && raw <= 100 ? raw : DEFAULT_THRESHOLD;
  } catch {
    return DEFAULT_THRESHOLD;
  }
};

const writeThreshold = (value: number): void => {
  try {
    localStorage.setItem(THRESHOLD_KEY, String(value));
  } catch {
    // ignore storage failures
  }
};

/** One card up for the chop, with what we know about how often it's played. */
interface CutCandidate {
  card: DeckCard;
  imageUrls: string[];
  /** Share of decks playing it, 0..1. Undefined when EDHREC doesn't list it. */
  inclusion?: number;
  numDecks?: number;
}

export const CutsPanel = ({
  cards,
  commanderNames,
  metaByKey,
  onCut,
}: {
  cards: DeckCard[];
  commanderNames: string[];
  /** cardKey -> Scryfall metadata, for card images. */
  metaByKey: Record<string, CardMetadata>;
  /** Cut one card, or every card the user selected. */
  onCut: (names: string[]) => void;
}) => {
  const [data, setData] = useState<EdhrecData | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(readThreshold);

  const namesKey = commanderNames.map(n => cardKey(n)).join('|');

  useEffect(() => writeThreshold(threshold), [threshold]);

  // Judge the deck against the commander's overall page rather than a theme, so
  // a card isn't marked weak just for being off-theme.
  const load = (force = false): void => {
    if (commanderNames.length === 0) return;
    setStatus('loading');
    setError(null);
    void fetchEdhrec(commanderNames, undefined, force)
      .then(d => {
        setData(d);
        setStatus('idle');
      })
      .catch((e: unknown) => {
        setData(null);
        setStatus('error');
        setError(e instanceof EdhrecNotFound || e instanceof Error ? e.message : 'EDHREC failed');
      });
  };

  useEffect(() => {
    load();
    // `load` closes over the values in this dep list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey]);

  // How often EDHREC sees each card, plus the least-played card it bothered to
  // list — the ceiling on anything missing from the data.
  const played = useMemo(() => {
    const byKey = new Map<string, { inclusion?: number; numDecks?: number }>();
    let floor = 1;
    for (const list of data?.lists ?? []) {
      for (const c of list.cards) {
        const key = cardKey(c.name);
        const prev = byKey.get(key);
        // A card can appear in several lists; keep the highest reading.
        if (!prev || (c.inclusion ?? 0) > (prev.inclusion ?? 0)) {
          byKey.set(key, { inclusion: c.inclusion, numDecks: c.numDecks });
        }
        if (c.inclusion != null) floor = Math.min(floor, c.inclusion);
      }
    }
    return { byKey, floor };
  }, [data]);

  const { candidates, cuts } = useMemo(() => {
    const limit = threshold / 100;
    const out: CutCandidate[] = [];
    let candidates = 0;
    for (const card of cards) {
      // Basics are never a cut, and the commander can't be judged by its own page.
      if (card.section !== 'main' || isBasicLand(card.name)) continue;
      candidates += 1;
      const hit = played.byKey.get(cardKey(card.name));
      if ((hit?.inclusion ?? 0) >= limit) continue;
      const meta = metaByKey[cardKey(card.name)];
      const faces = meta?.faceImages;
      out.push({
        card,
        imageUrls: faces && faces.length >= 2 ? faces : meta?.imageUrl ? [meta.imageUrl] : [],
        inclusion: hit?.inclusion,
        numDecks: hit?.numDecks,
      });
    }
    // Weakest first: unlisted cards, then rising inclusion.
    out.sort(
      (a, b) => (a.inclusion ?? -1) - (b.inclusion ?? -1) || a.card.name.localeCompare(b.card.name),
    );
    return { candidates, cuts: out };
  }, [cards, metaByKey, played, threshold]);

  const byId = useMemo(
    () => new Map(cuts.map(cut => [cardKey(cut.card.name), cut] as const)),
    [cuts],
  );
  const selection = useRowSelection(cuts.map(cut => cardKey(cut.card.name)));

  if (commanderNames.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-xs text-slate-500">
        Pick a commander to see which of your cards other decks skip.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none flex-wrap items-center gap-1.5 border-b border-slate-800 px-2 py-1.5 text-[10px]">
        <span className="font-semibold uppercase tracking-wide text-slate-400">Cuts</span>
        {data?.deckCount != null && (
          <span className="text-slate-500">vs {data.deckCount} EDHREC decks</span>
        )}
        <span className="ml-auto flex items-center gap-1 text-slate-400">
          played in under
          <NumberStepper
            label="Cut cards played in under this share of decks"
            max={100}
            min={1}
            onChange={setThreshold}
            size="xs"
            title="Suggest cutting cards that fewer than this share of EDHREC decks play"
            value={threshold}
          />
          % of decks
        </span>
        <Button
          onClick={() => load(true)}
          size="xs"
          title="Re-fetch (bypasses the one-week cache)"
          variant="subtle"
        >
          Refresh
        </Button>
      </div>

      <div className="flex-none border-b border-slate-800 px-2 py-1 text-[10px] text-slate-500">
        {status === 'loading' && !data
          ? 'Loading EDHREC play rates…'
          : data && (
              <>
                {cuts.length} of {candidates} cards fall under {threshold}%
                {played.floor < 1 && (
                  <span title="EDHREC's lists stop before the rarely-played cards, so anything missing from them is at most this popular">
                    {' · '}cards it doesn’t list are under {Math.round(played.floor * 100)}%
                  </span>
                )}
              </>
            )}
      </div>

      {cuts.length > 0 && (
        <SelectionBar selection={selection}>
          <Button
            onClick={() => {
              onCut(selection.ids.map(id => byId.get(id)?.card.name ?? '').filter(Boolean));
              selection.clear();
            }}
            size="xs"
            title="Remove the selected cards from the deck"
            variant="danger"
          >
            Cut {selection.count}
          </Button>
        </SelectionBar>
      )}

      <div className="min-h-0 flex-1 overflow-auto outline-none" {...selection.listProps}>
        {status === 'error' && (
          <div className="px-4 py-6 text-center text-xs text-red-400">{error}</div>
        )}
        {data && cuts.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-slate-500">
            Every card here is played in at least {threshold}% of decks. Raise the threshold to be
            harsher.
          </div>
        )}
        <ul className="list-none divide-y divide-slate-800/60">
          {cuts.map(cut => (
            <CutRow
              key={cardKey(cut.card.name)}
              cut={cut}
              floor={played.floor}
              onCut={() => onCut([cut.card.name])}
              rowId={cardKey(cut.card.name)}
              selection={selection}
            />
          ))}
        </ul>
      </div>
    </div>
  );
};

const CutRow = ({
  cut,
  floor,
  onCut,
  rowId,
  selection,
}: {
  cut: CutCandidate;
  /** Inclusion of the least-played card EDHREC lists, for unlisted cards. */
  floor: number;
  onCut: () => void;
  rowId: string;
  selection: RowSelection;
}) => {
  const { card, imageUrls, inclusion, numDecks } = cut;
  const preview = useCardPreview();
  const { flippable, handlers } = preview(`cuts|${cardKey(card.name)}`, card.name, imageUrls);
  return (
    <li {...selection.rowProps(rowId, 'flex items-center gap-2 py-1.5 pl-2 pr-2 text-[11px]')}>
      <div className="h-8 w-8 flex-none overflow-hidden rounded bg-slate-800" {...handlers}>
        {imageUrls[0] && (
          <img
            alt={card.name}
            className={`h-full w-full object-cover ${flippable ? 'cursor-pointer' : 'cursor-zoom-in'}`}
            decoding="async"
            loading="lazy"
            src={imageUrls[0]}
            style={{ objectPosition: '50% 18%' }}
            title={flippable ? 'Click to flip to the other side' : undefined}
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-slate-100" title={card.name}>
          {card.quantity > 1 && <span className="text-slate-500">{card.quantity}× </span>}
          {card.name}
        </div>
        <div className="text-[9px] text-slate-500">
          {inclusion == null ? (
            <span title="Not among the cards EDHREC lists for this commander">
              not listed — under {Math.round(floor * 100)}%
            </span>
          ) : (
            <span title={numDecks != null ? `In ${numDecks} decks` : undefined}>
              in {Math.round(inclusion * 100)}% of decks
            </span>
          )}
        </div>
      </div>

      <Button
        onClick={onCut}
        size="xs"
        title={`Remove ${card.name} from the deck`}
        variant="danger"
      >
        cut
      </Button>
    </li>
  );
};
