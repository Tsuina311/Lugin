// Point the phone at a card; build name + set + number across snaps.
//
// Each capture tries all three regions. Fields that land stay checked (green)
// so the user knows what still needs a closer pass. Once the name is known we
// ask Scryfall for that card's printings, which turns a partial set/number into
// an exact match much more often than OCR alone.

import { useEffect, useRef, useState } from 'react';

import {
  canvasFromFile,
  captureBestCard,
  openCamera,
  type CameraSession,
} from './scan/camera';
import { enhanceForOcr } from './scan/enhance';
import {
  COLLECTOR_WHITELIST,
  SET_SYMBOL_WHITELIST,
  disposeOcr,
  readText,
} from './scan/ocr';

import type { CollectionCard } from '@/lib/collection';
import { guessFoil, imageStats, type FoilHint } from '@/lib/scan/foil';
import {
  bestName,
  mergePartsForScan,
  parseCollectorParts,
  parseSetSymbolText,
  type CollectorParts,
} from '@/lib/scan/parseCollector';
import {
  CLASSIC_NUMBER_REGION,
  COLLECTOR_REGION,
  NAME_FOCUS_REGION,
  NAME_REGION,
  NUMBER_REGION,
  SET_REGION,
  SET_SYMBOL_REGION,
  cropRegion,
} from '@/lib/scan/regions';
import {
  cardFromScan,
  fetchNamedFuzzy,
  fetchPrinting,
  fetchPrintingsByName,
  filterPrintings,
  pickPrinting,
  type ScryfallPrinting,
} from '@/lib/scan/resolve';
import { Check, Hash, Library, List, Type, type LucideIcon } from '@/ui/components/icons';

type Phase = 'camera' | 'working' | 'pick' | 'review' | 'error';

interface Progress {
  collector: CollectorParts;
  /** Canonical Scryfall name once fuzzy lookup succeeds. */
  name: string | null;
  /** Printings of `name`, filled after the name locks in. */
  printings: ScryfallPrinting[];
}

interface Review {
  card: CollectionCard;
  foil: FoilHint;
  printing: ScryfallPrinting;
}

const emptyProgress = (): Progress => ({
  collector: { foilMarker: null, raw: '' },
  name: null,
  printings: [],
});

const StatusChip = ({
  done,
  icon: Icon,
  label,
  value,
}: {
  done: boolean;
  icon: LucideIcon;
  label: string;
  value?: string | null;
}) => (
  <div
    className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border px-2 py-1.5 ${
      done ? 'border-pos/40 bg-pos-soft text-pos' : 'border-line bg-raised text-ink-faint'
    }`}
    title={value ?? label}
  >
    {done ? <Check aria-hidden size={14} strokeWidth={2.5} /> : <Icon aria-hidden size={14} />}
    <span className="min-w-0 truncate text-[11px] font-medium">
      {done && value ? value : label}
    </span>
  </div>
);

export const ScanScreen = ({
  onAdd,
}: {
  onAdd: (card: CollectionCard) => Promise<void>;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const session = useRef<CameraSession | null>(null);
  const [phase, setPhase] = useState<Phase>('camera');
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>(emptyProgress);
  const [review, setReview] = useState<Review | null>(null);
  const [foil, setFoil] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let alive = true;
    void openCamera(video)
      .then(s => {
        if (!alive) {
          s.stop();
          return;
        }
        session.current = s;
      })
      .catch(err => {
        setPhase('error');
        setMessage(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
      session.current?.stop();
      session.current = null;
      void disposeOcr();
    };
  }, []);

  const reset = () => {
    setProgress(emptyProgress());
    setReview(null);
    setPhase('camera');
    setMessage(null);
  };

  const enterReview = (
    printing: ScryfallPrinting,
    collector: CollectorParts,
    stripStats: ReturnType<typeof imageStats> | null,
  ) => {
    const hint = guessFoil(collector, stripStats);
    const canFoil = printing.finishes.includes('foil');
    setReview({
      card: cardFromScan(printing, hint),
      foil: hint,
      printing,
    });
    setFoil(canFoil ? hint.foil : false);
    setPhase('review');
    setMessage(null);
  };

  const tryResolve = async (
    next: Progress,
    stripStats: ReturnType<typeof imageStats> | null,
  ): Promise<boolean> => {
    const { collector } = next;
    let printing: ScryfallPrinting | null = null;

    if (collector.setCode && collector.collectorNumber) {
      printing = await fetchPrinting(collector.setCode, collector.collectorNumber);
    }
    if (!printing && next.printings.length > 0) {
      printing = pickPrinting(next.printings, collector);
    }
    if (!printing) return false;

    // Name known but disagrees with this printing — keep gathering, don't lock.
    if (next.name && !namesLooselyMatch(next.name, printing.name)) return false;

    enterReview(printing, collector, stripStats);
    return true;
  };

  const openManualPick = async () => {
    if (!progress.name) return;
    setPhase('working');
    setMessage('Loading printings…');
    try {
      let printings = progress.printings;
      if (printings.length === 0) {
        printings = await fetchPrintingsByName(progress.name);
        setProgress(p => ({ ...p, printings }));
      }
      if (printings.length === 0) {
        setPhase('camera');
        setMessage(`No Scryfall printings found for “${progress.name}”.`);
        return;
      }
      setPhase('pick');
      setMessage(null);
    } catch (err) {
      setPhase('camera');
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const pickPrintingManual = (printing: ScryfallPrinting) => {
    enterReview(printing, progress.collector, null);
  };

  const fileRef = useRef<HTMLInputElement>(null);

  const runOnCard = async (card: HTMLCanvasElement) => {
    setPhase('working');
    setMessage('Reading…');
    try {
      const ocrCrop = (region: Parameters<typeof cropRegion>[1]) =>
        enhanceForOcr(cropRegion(card, region));

      const nameCanvas = ocrCrop(NAME_REGION);
      const nameFocusCanvas = ocrCrop(NAME_FOCUS_REGION);
      const numberCanvas = ocrCrop(NUMBER_REGION);
      const classicNumberCanvas = ocrCrop(CLASSIC_NUMBER_REGION);
      const setCanvas = ocrCrop(SET_REGION);
      const setSymbolCanvas = ocrCrop(SET_SYMBOL_REGION);
      const collectorCanvas = ocrCrop(COLLECTOR_REGION);
      // Foil stats from the raw (unenhanced) strip colour.
      const rawStrip = cropRegion(card, COLLECTOR_REGION);
      const rawData = rawStrip
        .getContext('2d')
        ?.getImageData(0, 0, rawStrip.width, rawStrip.height);
      const stats = rawData ? imageStats(rawData.data) : null;

      // Name first: title bar + wide focus so a name-only zoom still locks.
      const [nameText, nameFocusText] = await Promise.all([
        readText(nameCanvas),
        readText(nameFocusCanvas),
      ]);

      let next: Progress = { ...progress, collector: { ...progress.collector } };
      const ocrName = bestName(nameText, nameFocusText);

      if (ocrName && !next.name) {
        const named = await fetchNamedFuzzy(ocrName);
        if (named) {
          next = {
            ...next,
            name: named.name,
            printings: await fetchPrintingsByName(named.name),
          };
        } else if (ocrName.length >= 3) {
          next = { ...next, name: ocrName, printings: [] };
        }
      } else if (next.name && next.printings.length === 0) {
        next = { ...next, printings: await fetchPrintingsByName(next.name) };
      }

      const [numberText, classicNumberText, setText, setSymbolText, collectorText] =
        await Promise.all([
          readText(numberCanvas, COLLECTOR_WHITELIST),
          readText(classicNumberCanvas, COLLECTOR_WHITELIST),
          readText(setCanvas, COLLECTOR_WHITELIST),
          readText(setSymbolCanvas, SET_SYMBOL_WHITELIST),
          readText(collectorCanvas, COLLECTOR_WHITELIST),
        ]);

      const nameLocked = Boolean(next.name);
      next.collector = mergePartsForScan(
        next.collector,
        parseCollectorParts(numberText),
        { nameLocked },
      );
      next.collector = mergePartsForScan(
        next.collector,
        parseCollectorParts(classicNumberText),
        { nameLocked },
      );
      next.collector = mergePartsForScan(next.collector, parseCollectorParts(setText), {
        nameLocked,
      });
      next.collector = mergePartsForScan(
        next.collector,
        parseCollectorParts(collectorText),
        { nameLocked },
      );

      const symbolSet = parseSetSymbolText(setSymbolText);
      if (symbolSet) {
        next.collector = mergePartsForScan(
          next.collector,
          { foilMarker: null, raw: setSymbolText, setCode: symbolSet },
          { nameLocked },
        );
      }

      setProgress(next);

      if (await tryResolve(next, stats)) return;

      const missing = [
        !next.name ? 'name' : null,
        !next.collector.setCode ? 'edition' : null,
        !next.collector.collectorNumber ? 'number' : null,
      ].filter(Boolean);
      setPhase('camera');
      if (next.name && (!next.collector.setCode || !next.collector.collectorNumber)) {
        setMessage(
          `Name locked: ${next.name}. Frame the set symbol (type-line, right) and the bottom number, then scan again.`,
        );
      } else if (missing.length) {
        setMessage(
          `Got a pass — still need ${missing.join(', ')}. Zoom the missing band sharp and scan again.`,
        );
      } else {
        setMessage(
          'Name, set and number are in, but Scryfall couldn’t pin one printing. Try another angle.',
        );
      }
    } catch (err) {
      setPhase('camera');
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const snap = async () => {
    const video = videoRef.current;
    const frame = frameRef.current;
    if (!video || !frame || video.readyState < 2) return;
    setPhase('working');
    setMessage('Focusing…');
    try {
      const guide = frame.getBoundingClientRect();
      const host = video.getBoundingClientRect();
      const card = await captureBestCard(video, {
        height: guide.height,
        left: guide.left - host.left,
        top: guide.top - host.top,
        width: guide.width,
      });
      await runOnCard(card);
    } catch (err) {
      setPhase('camera');
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const onPickPhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      const card = await canvasFromFile(file);
      await runOnCard(card);
    } catch (err) {
      setPhase('camera');
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const save = async () => {
    if (!review) return;
    setBusy(true);
    try {
      const card: CollectionCard = { ...review.card, foil };
      await onAdd(card);
      reset();
      setMessage(`Added ${card.name}${card.foil ? ' (foil)' : ''}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const haveName = Boolean(progress.name);
  const haveSet = Boolean(progress.collector.setCode);
  const haveNumber = Boolean(progress.collector.collectorNumber);
  const pickList = filterPrintings(progress.printings, progress.collector);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      {phase === 'pick' ? (
        <div className="flex min-h-0 flex-1 flex-col bg-panel">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <button
              className="rounded-lg border border-line-strong px-3 py-2 text-sm text-ink-muted"
              onClick={() => setPhase('camera')}
              type="button"
            >
              Back
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{progress.name}</p>
              <p className="text-[11px] text-ink-faint">
                {pickList.length} printing{pickList.length === 1 ? '' : 's'}
                {haveSet || haveNumber ? ' (filtered by what we scanned)' : ''}
              </p>
            </div>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
            {pickList.map(p => (
              <li key={p.id}>
                <button
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-raised active:bg-raised"
                  onClick={() => pickPrintingManual(p)}
                  type="button"
                >
                  {p.imageUrl ? (
                    <img
                      alt=""
                      className="h-14 w-auto shrink-0 rounded border border-line"
                      loading="lazy"
                      src={p.imageUrl}
                    />
                  ) : (
                    <div className="h-14 w-10 shrink-0 rounded border border-line bg-raised" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-ink">
                      {p.setCode.toUpperCase()} #{p.collectorNumber}
                    </span>
                    <span className="block truncate text-[11px] text-ink-faint">
                      {p.setName}
                      {p.rarity ? ` · ${p.rarity}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <div
            ref={frameRef}
            className="relative w-[min(78vw,320px)] overflow-hidden rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
            style={{ aspectRatio: '63 / 88' }}
          >
            <div
              className={`absolute border ${haveName ? 'border-pos/80 bg-pos/20' : 'border-sky-300/80 bg-sky-400/15'}`}
              style={{
                height: `${NAME_REGION.h * 100}%`,
                left: `${NAME_REGION.x * 100}%`,
                top: `${NAME_REGION.y * 100}%`,
                width: `${NAME_REGION.w * 100}%`,
              }}
            />
            {!haveName ? (
              <div
                className="absolute border border-dashed border-sky-200/50 bg-sky-400/5"
                style={{
                  height: `${NAME_FOCUS_REGION.h * 100}%`,
                  left: `${NAME_FOCUS_REGION.x * 100}%`,
                  top: `${NAME_FOCUS_REGION.y * 100}%`,
                  width: `${NAME_FOCUS_REGION.w * 100}%`,
                }}
              />
            ) : null}
            <div
              className={`absolute border ${haveNumber ? 'border-pos/80 bg-pos/20' : 'border-amber-300/90 bg-amber-400/20'}`}
              style={{
                height: `${NUMBER_REGION.h * 100}%`,
                left: `${NUMBER_REGION.x * 100}%`,
                top: `${NUMBER_REGION.y * 100}%`,
                width: `${NUMBER_REGION.w * 100}%`,
              }}
            />
            <div
              className={`absolute border ${haveNumber ? 'border-pos/80 bg-pos/20' : 'border-amber-300/50 bg-amber-400/10'}`}
              style={{
                height: `${CLASSIC_NUMBER_REGION.h * 100}%`,
                left: `${CLASSIC_NUMBER_REGION.x * 100}%`,
                top: `${CLASSIC_NUMBER_REGION.y * 100}%`,
                width: `${CLASSIC_NUMBER_REGION.w * 100}%`,
              }}
            />
            <div
              className={`absolute border ${haveSet ? 'border-pos/80 bg-pos/20' : 'border-violet-300/90 bg-violet-400/20'}`}
              style={{
                height: `${SET_REGION.h * 100}%`,
                left: `${SET_REGION.x * 100}%`,
                top: `${SET_REGION.y * 100}%`,
                width: `${SET_REGION.w * 100}%`,
              }}
            />
            <div
              className={`absolute border ${haveSet ? 'border-pos/80 bg-pos/20' : 'border-violet-300/70 bg-violet-400/15'}`}
              style={{
                height: `${SET_SYMBOL_REGION.h * 100}%`,
                left: `${SET_SYMBOL_REGION.x * 100}%`,
                top: `${SET_SYMBOL_REGION.y * 100}%`,
                width: `${SET_SYMBOL_REGION.w * 100}%`,
              }}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-line bg-panel px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="flex gap-1.5">
          <StatusChip done={haveName} icon={Type} label="Name" value={progress.name} />
          <StatusChip
            done={haveSet}
            icon={Library}
            label="Edition"
            value={progress.collector.setCode?.toUpperCase()}
          />
          <StatusChip
            done={haveNumber}
            icon={Hash}
            label="Number"
            value={progress.collector.collectorNumber}
          />
        </div>
        <p className="text-[11px] leading-snug text-ink-faint">
          Name first (EN/FR/DE/IT). Edition from bottom text or the set symbol. Once the name
          is locked, Pick manually lists every printing if OCR can’t finish the job.
        </p>
        {message ? <p className="text-xs text-ink-muted">{message}</p> : null}

        {phase === 'error' ? (
          <p className="text-sm text-neg">{message ?? 'Camera unavailable.'}</p>
        ) : phase === 'review' && review ? (
          <div className="space-y-3">
            <div className="flex gap-3">
              {review.printing.imageUrl ? (
                <img
                  alt=""
                  className="h-24 w-auto rounded-md border border-line"
                  src={review.printing.imageUrl}
                />
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{review.printing.name}</p>
                <p className="text-xs text-ink-muted">
                  {review.printing.setCode.toUpperCase()} #{review.printing.collectorNumber}
                  {review.printing.setName ? ` · ${review.printing.setName}` : ''}
                </p>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                checked={foil}
                disabled={!review.printing.finishes.includes('foil')}
                onChange={e => setFoil(e.target.checked)}
                type="checkbox"
              />
              Foil
              <span className="text-[10px] text-ink-faint">
                ({review.foil.reason}, {Math.round(review.foil.confidence * 100)}%)
              </span>
            </label>
            <div className="flex gap-2">
              <button
                className="flex-1 rounded-lg border border-line-strong py-3 text-sm font-medium text-ink"
                onClick={reset}
                type="button"
              >
                Start over
              </button>
              <button
                className="flex-1 rounded-lg bg-accent py-3 text-sm font-semibold text-accent-ink disabled:opacity-50"
                disabled={busy}
                onClick={() => void save()}
                type="button"
              >
                {busy ? 'Adding…' : 'Add to collection'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              {(haveName || haveSet || haveNumber) && (
                <button
                  className="rounded-lg border border-line-strong px-3 py-3.5 text-sm font-medium text-ink-muted"
                  disabled={phase === 'working'}
                  onClick={reset}
                  type="button"
                >
                  Reset
                </button>
              )}
              <button
                className="flex-1 rounded-lg bg-accent py-3.5 text-sm font-semibold text-accent-ink disabled:opacity-50"
                disabled={phase === 'working'}
                onClick={() => void snap()}
                type="button"
              >
                {phase === 'working' ? 'Reading…' : 'Scan'}
              </button>
            </div>
            {haveName ? (
              <button
                className="flex items-center justify-center gap-1.5 rounded-lg border border-line-strong py-2.5 text-sm font-medium text-ink disabled:opacity-50"
                disabled={phase === 'working'}
                onClick={() => void openManualPick()}
                type="button"
              >
                <List aria-hidden size={14} />
                Pick manually
              </button>
            ) : null}
            <button
              className="rounded-lg border border-line-strong py-2.5 text-sm font-medium text-ink-muted disabled:opacity-50"
              disabled={phase === 'working'}
              onClick={() => fileRef.current?.click()}
              type="button"
            >
              Use photo instead
            </button>
            <input
              ref={fileRef}
              accept="image/*"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                e.target.value = '';
                void onPickPhoto(file);
              }}
              type="file"
            />
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
};

const namesLooselyMatch = (a: string, b: string): boolean => {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return true;
  return x.includes(y.slice(0, 8)) || y.includes(x.slice(0, 8));
};
