import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { BRACKET_NAME, type BracketCardRef } from '@/lib/bracket';
import { cardKey, frontFaceName } from '@/lib/cardName';
import {
  comboIndexError,
  ensureComboIndex,
  getComboIndexSnapshot,
  subscribeComboIndex,
} from '@/lib/combos/load';
import type { DetectedPair } from '@/lib/combos/types';
import type { Deck } from '@/lib/deck';
import { estimateDeck } from '@/lib/decks/bracket/estimator';
import { SPELLBOOK_TAG_RULES } from '@/lib/decks/bracket/rules';
import { flags } from '@/lib/flags';
import { requestScryfall, requestScryfallCached } from '@/lib/messaging';
import { scryfallFetch } from '@/lib/scryfallFetch';

const TONE: Record<2 | 3 | 4, string> = {
  2: 'border-line-strong bg-tint text-ink-muted',
  3: 'border-accent bg-accent-soft text-accent',
  4: 'border-warn bg-warn-soft text-warn',
};

const artUrl = (card: {
  card_faces?: { image_uris?: { normal?: string; small?: string } }[];
  image_uris?: { normal?: string; small?: string };
}): string | undefined =>
  card.image_uris?.normal ??
  card.image_uris?.small ??
  card.card_faces?.[0]?.image_uris?.normal ??
  card.card_faces?.[0]?.image_uris?.small;

const isExtension = (): boolean => typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);

/** Pictures for the hover. The extension uses its Scryfall cache; the phone calls Scryfall directly. */
const loadArt = async (names: string[]): Promise<Record<string, string>> => {
  const want = [...new Set(names.map(name => name.trim()).filter(Boolean))];
  if (want.length === 0) return {};
  const out: Record<string, string> = {};
  const put = (name: string, url?: string): void => {
    if (!url) return;
    out[cardKey(name)] = url;
  };
  try {
    if (isExtension()) {
      const cached = await requestScryfallCached(want);
      const have = new Set(cached.map(card => cardKey(card.name)));
      const missing = want.filter(name => !have.has(cardKey(name)));
      const fresh = missing.length > 0 ? await requestScryfall(missing) : [];
      for (const card of [...cached, ...fresh]) put(card.name, card.imageUrl);
      return out;
    }
    const res = await scryfallFetch({
      body: JSON.stringify({
        identifiers: want.slice(0, 75).map(name => ({ name: frontFaceName(name) })),
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      priority: 1,
      url: 'https://api.scryfall.com/cards/collection',
    });
    if (!res.ok) return out;
    const body = JSON.parse(res.body) as {
      data?: {
        card_faces?: { image_uris?: { normal?: string; small?: string } }[];
        image_uris?: { normal?: string; small?: string };
        name: string;
      }[];
    };
    for (const card of body.data ?? []) put(card.name, artUrl(card));
  } catch {
    // The floor is already known. A missing picture leaves the name.
  }
  return out;
};

const CardRow = ({
  card,
  image,
  onRemove,
}: {
  card: BracketCardRef;
  image?: string;
  onRemove?: (card: BracketCardRef) => void;
}) => (
  <li className="flex items-center gap-1.5 py-0.5">
    {image ? (
      <img
        alt=""
        className="h-9 w-7 flex-none rounded-sm bg-raised object-cover"
        src={image}
        style={{ objectPosition: '50% 18%' }}
      />
    ) : (
      <span className="h-9 w-7 flex-none rounded-sm bg-raised" />
    )}
    <span className="min-w-0 flex-1 truncate text-ink">{card.name}</span>
    {onRemove && (
      <button
        className="flex-none text-2xs font-medium text-ink-faint hover:text-neg"
        onClick={() => onRemove(card)}
        type="button"
      >
        Remove
      </button>
    )}
  </li>
);

const Group = ({
  cards,
  imageOf,
  label,
  onRemove,
}: {
  cards: BracketCardRef[];
  imageOf: (name: string) => string | undefined;
  label: string;
  onRemove?: (card: BracketCardRef) => void;
}) => {
  if (cards.length === 0) return null;
  return (
    <div>
      <div className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">
        {label} · {cards.length}
      </div>
      <ul className="mt-0.5">
        {cards.map(card => (
          <CardRow
            key={`${card.section}|${cardKey(card.name)}`}
            card={card}
            image={imageOf(card.name)}
            onRemove={onRemove}
          />
        ))}
      </ul>
    </div>
  );
};

const DEPENDENCY: Record<DetectedPair['lead']['dependency'], string> = {
  COMMANDER_DEPENDENT: 'One of these has to be your commander.',
  CONDITIONAL: 'Needs more than the two cards.',
  SELF_CONTAINED: 'The two cards are the line.',
};

/**
 * Estimated Commander bracket: the card-list floor, plus known two-card combos.
 * Other formats have no bracket. The number is an estimate, not an official bracket.
 */
export const BracketMark = ({
  deck,
  knownImages,
  onRemove,
  oracleByKey,
}: {
  deck: Deck;
  /** Art already resolved for this deck, keyed by card key. */
  knownImages?: Record<string, string | undefined>;
  /** Deck detail passes this so taking a Game Changer out drops the number. */
  onRemove?: (card: BracketCardRef) => void;
  /** Scryfall identity for each card key, when the deck editor has already looked it up. */
  oracleByKey?: Record<string, { found: boolean; oracleId?: string } | undefined>;
}) => {
  const comboIndex = useSyncExternalStore(subscribeComboIndex, getComboIndexSnapshot, getComboIndexSnapshot);
  useEffect(() => {
    void ensureComboIndex();
  }, []);
  const estimate = useMemo(() => {
    if (deck.format !== 'commander') return null;
    const cards = deck.cards.map(card => {
      const meta = oracleByKey?.[cardKey(card.name)];
      return {
        name: card.name,
        oracleId: meta?.oracleId,
        quantity: card.quantity,
        section: card.section,
        unresolved: meta?.found === false,
      };
    });
    return estimateDeck(cards, comboIndex.bundle);
  }, [comboIndex.bundle, deck.cards, deck.format, oracleByKey]);
  const countable = deck.cards.some(card => card.section !== 'sideboard');
  const [open, setOpen] = useState(false);
  const [openPair, setOpenPair] = useState<string | null>(null);
  const [art, setArt] = useState<Record<string, string>>({});
  const box = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number>(0);
  const [place, setPlace] = useState<{
    left: number;
    maxHeight: number;
    top: number;
    width: number;
  } | null>(null);

  const namesKey = useMemo(() => {
    if (!estimate) return '';
    const names = [
      ...estimate.checklist.gameChangers,
      ...estimate.checklist.massLandDenial,
      ...estimate.checklist.extraTurns,
      ...estimate.checklist.tutors,
    ].map(card => card.name);
    for (const pair of estimate.combos.pairs) {
      names.push(pair.cards[0].name, pair.cards[1].name);
    }
    return names.join('|');
  }, [estimate]);

  useEffect(() => {
    if (!open || !namesKey) return;
    let cancel = false;
    void loadArt(namesKey.split('|')).then(found => {
      if (!cancel) setArt(prev => ({ ...prev, ...found }));
    });
    return () => {
      cancel = true;
    };
  }, [open, namesKey]);

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent): void => {
      if (box.current && event.composedPath().includes(box.current)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !box.current || !panel.current) {
      setPlace(null);
      return;
    }
    const trigger = box.current.getBoundingClientRect();
    let bound = new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    let node: HTMLElement | null = box.current.parentElement;
    while (node) {
      const style = getComputedStyle(node);
      const clips =
        style.overflowY === 'auto' || style.overflowY === 'hidden' || style.overflowY === 'scroll';
      if (clips || style.position === 'fixed') bound = node.getBoundingClientRect();
      if (style.position === 'fixed') break;
      node = node.parentElement;
    }
    const width = Math.min(320, Math.max(200, bound.width - 16));
    const margin = 6;
    const spaceBelow = bound.bottom - trigger.bottom - margin;
    const spaceAbove = trigger.top - bound.top - margin;
    const below = spaceBelow >= 140 || spaceBelow >= spaceAbove;
    const maxHeight = Math.max(96, Math.min(360, (below ? spaceBelow : spaceAbove) - margin));
    const height = Math.min(panel.current.scrollHeight, maxHeight);
    let top = below ? trigger.bottom + margin : trigger.top - margin - height;
    top = Math.max(bound.top + 4, Math.min(top, bound.bottom - height - 4));
    let left = trigger.right - width;
    left = Math.max(bound.left + 4, Math.min(left, bound.right - width - 4));
    setPlace({ left, maxHeight, top, width });
  }, [open, namesKey, openPair]);

  if (!estimate || !countable) return null;

  const show = (): void => {
    window.clearTimeout(hideTimer.current);
    setOpen(true);
  };
  const hide = (): void => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setOpen(false), 160);
  };

  const imageOf = (name: string): string | undefined => {
    const key = cardKey(name);
    return (
      art[key] ??
      knownImages?.[key] ??
      deck.cards.find(card => cardKey(card.name) === key)?.printing?.imageUrl
    );
  };

  return (
    <span
      ref={box}
      className="relative flex-none"
      onBlur={event => {
        const next = event.relatedTarget;
        if (next instanceof Node && box.current?.contains(next)) return;
        hide();
      }}
      onClick={event => event.stopPropagation()}
      onFocus={show}
      onPointerEnter={event => {
        if (event.pointerType === 'mouse') show();
      }}
      onPointerLeave={event => {
        if (event.pointerType === 'mouse') hide();
      }}
    >
      <button
        aria-label={`Estimated bracket ${estimate.estimatedBracket}, ${BRACKET_NAME[estimate.estimatedBracket]}. Likely range ${estimate.likelyRange[0]} to ${estimate.likelyRange[1]}.`}
        className={`inline-flex h-5 items-center rounded-sm border px-1 font-semibold tabular-nums leading-none ${TONE[estimate.estimatedBracket]}`}
        onPointerDown={event => {
          if (event.pointerType !== 'mouse') setOpen(value => !value);
        }}
        type="button"
      >
        <span aria-hidden className="font-normal opacity-70">
          [
        </span>
        <span className="px-px text-xs">{estimate.estimatedBracket}</span>
        <span aria-hidden className="font-normal opacity-70">
          ]
        </span>
      </button>
      {open && (
        <div
          ref={panel}
          aria-label={`Estimated bracket ${estimate.estimatedBracket}`}
          className="fixed z-[80] overflow-auto rounded-md border border-line-strong bg-panel p-2 text-xs text-ink shadow-pop"
          role="dialog"
          style={
            place
              ? { left: place.left, maxHeight: place.maxHeight, top: place.top, width: place.width }
              : { left: 0, top: 0, visibility: 'hidden', width: 320 }
          }
        >
          <div className="font-semibold text-ink">
            Estimated bracket {estimate.estimatedBracket}
            <span className="font-normal text-ink-muted">
              {' '}
              · {BRACKET_NAME[estimate.estimatedBracket]}
            </span>
          </div>
          {estimate.likelyRange[0] !== estimate.likelyRange[1] && (
            <p className="mt-0.5 text-ink-muted">
              Likely range {estimate.likelyRange[0]}–{estimate.likelyRange[1]}
            </p>
          )}
          {estimate.estimatedBracket !== estimate.constructionFloor && (
            <p className="mt-0.5 text-2xs text-ink-faint">
              The card list alone would be bracket {estimate.constructionFloor}.
            </p>
          )}
          <div className="mt-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-faint">
            Why
          </div>
          {estimate.evidence.length === 0 ? (
            <p className="mt-0.5 text-ink">
              Nothing on the restricted lists, and no known two-card combo.
            </p>
          ) : (
            <ul className="mt-0.5 space-y-0.5">
              {estimate.evidence.map(item => (
                <li key={`${item.kind}|${item.pairKey ?? item.summary}`}>• {item.summary}</li>
              ))}
            </ul>
          )}
          {estimate.combos.pairs.length > 0 && (
            <div className="mt-2 space-y-1">
              <div className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">
                Combos
              </div>
              {estimate.combos.pairs.map(pair => {
                const openLine = openPair === pair.pairKey;
                const tag = SPELLBOOK_TAG_RULES[pair.lead.tag];
                return (
                  <div
                    key={pair.pairKey}
                    className="rounded-sm border border-line bg-raised px-1.5 py-1"
                  >
                    <button
                      className="w-full text-left text-ink"
                      onClick={() => setOpenPair(openLine ? null : pair.pairKey)}
                      type="button"
                    >
                      <span className="font-medium">
                        {pair.cards[0].name} + {pair.cards[1].name}
                      </span>
                      <span className="mt-0.5 block text-2xs text-ink-muted">
                        {pair.lead.results[0] ?? 'Combo'}
                        {' · '}
                        {tag.name}
                        {pair.lines.length > 1 ? ` · ${pair.lines.length} known lines` : ''}
                      </span>
                    </button>
                    {openLine && (
                      <div className="mt-1 space-y-1 border-t border-line pt-1 text-2xs leading-snug">
                        <p>{DEPENDENCY[pair.lead.dependency]}</p>
                        {pair.usesCommander && <p>Commander is one half of this combo.</p>}
                        {pair.lines.map(line => (
                          <div key={line.id}>
                            {pair.lines.length > 1 && (
                              <div className="font-medium text-ink-muted">{line.id}</div>
                            )}
                            {line.results.length > 0 && <p>Result: {line.results.join(', ')}</p>}
                            {line.prerequisites.length > 0 && (
                              <p>Requirements: {line.prerequisites.join(' ')}</p>
                            )}
                            {line.description && (
                              <p className="whitespace-pre-wrap">{line.description}</p>
                            )}
                          </div>
                        ))}
                        <a
                          className="text-accent"
                          href={pair.lead.url}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Open in Commander Spellbook
                        </a>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-1.5 space-y-1.5">
            <Group
              cards={estimate.checklist.gameChangers}
              imageOf={imageOf}
              label="Game Changers"
              onRemove={onRemove}
            />
            <Group
              cards={estimate.checklist.massLandDenial}
              imageOf={imageOf}
              label="Mass land denial"
              onRemove={onRemove}
            />
            <Group
              cards={estimate.checklist.extraTurns}
              imageOf={imageOf}
              label="Extra turns"
              onRemove={onRemove}
            />
            <Group
              cards={estimate.checklist.tutors}
              imageOf={imageOf}
              label="Tutors"
              onRemove={onRemove}
            />
          </div>
          {estimate.combos.unresolved > 0 && (
            <p className="mt-1.5 text-2xs text-warn">
              {estimate.combos.unresolved} unresolved{' '}
              {estimate.combos.unresolved === 1 ? 'card' : 'cards'} may affect analysis.
            </p>
          )}
          {!estimate.indexReady && (
            <p className="mt-1.5 text-2xs text-ink-faint">
              {comboIndex.loading
                ? 'Loading combo database…'
                : comboIndexError() ?? 'Combo database isn’t available yet.'}
            </p>
          )}
          {comboIndex.bundle && (
            <p className="mt-1.5 text-2xs text-ink-faint">
              Commander Spellbook {comboIndex.bundle.metadata.sourceVersion} ·{' '}
              {comboIndex.bundle.metadata.generatedAt.slice(0, 10)} ·{' '}
              {comboIndex.bundle.metadata.pairCount} pairs
              {flags.devTools ? ` · ${comboIndex.bundle.metadata.sha256.runtime.slice(0, 12)}` : ''}
            </p>
          )}
        </div>
      )}
    </span>
  );
};
