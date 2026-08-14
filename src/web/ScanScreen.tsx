// Two-step phone scanner.
//
// Step 1 — Title only. OCR is optimised for the name bar / a title-only zoom.
// Step 2 — Once the name is locked (and printings loaded), gather set + number,
//          and Pick manually is available immediately as the last resort.

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
  readTitleLine,
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
  NAME_REGION,
  NUMBER_REGION,
  SET_REGION,
  SET_SYMBOL_REGION,
  TITLE_LINE_REGION,
  TITLE_ZOOM_REGION,
  cropRegion,
  type Region,
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
/** Procedural scan: title first, then collector details. */
type Step = 'title' | 'details';

interface Progress {
  collector: CollectorParts;
  name: string | null;
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

const Guide = ({
  active,
  done,
  region,
}: {
  active: boolean;
  done: boolean;
  region: Region;
}) => (
  <div
    className={`absolute border ${
      done
        ? 'border-pos/80 bg-pos/20'
        : active
          ? 'border-sky-300/90 bg-sky-400/20'
          : 'border-white/20 bg-transparent'
    }`}
    style={{
      height: `${region.h * 100}%`,
      left: `${region.x * 100}%`,
      top: `${region.y * 100}%`,
      width: `${region.w * 100}%`,
    }}
  />
);

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
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>('camera');
  const [step, setStep] = useState<Step>('title');
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
    setStep('title');
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

  const lockTitle = async (
    ocrName: string,
    base: Progress,
  ): Promise<Progress | null> => {
    const named = await fetchNamedFuzzy(ocrName);
    if (named) {
      const printings = await fetchPrintingsByName(named.name);
      return { ...base, name: named.name, printings };
    }
    if (ocrName.length >= 3) {
      return { ...base, name: ocrName, printings: [] };
    }
    return null;
  };

  /** Step 1: only title OCR — full-card name bar OR a title-only zoom. */
  const runTitlePass = async (card: HTMLCanvasElement, base: Progress) => {
    setMessage('Reading title…');
    const ocr = (region: Region) => enhanceForOcr(cropRegion(card, region));

    const [bar, line, zoom] = await Promise.all([
      readTitleLine(ocr(NAME_REGION)),
      readTitleLine(ocr(TITLE_LINE_REGION)),
      readTitleLine(ocr(TITLE_ZOOM_REGION)),
    ]);
    // Also try a block read on the zoom — helps when the title wraps two lines.
    const zoomBlock = await readText(ocr(TITLE_ZOOM_REGION));

    const ocrName = bestName(bar, line, zoom, zoomBlock);
    if (!ocrName) {
      setPhase('camera');
      setMessage(
        'Couldn’t read a title. Fill the guide with the name bar (or just the title text) and Scan again.',
      );
      return;
    }

    const next = await lockTitle(ocrName, base);
    if (!next?.name) {
      setPhase('camera');
      setMessage(`Read “${ocrName}” but couldn’t match a card. Try a clearer shot.`);
      return;
    }

    setProgress(next);
    setStep('details');
    setPhase('camera');
    setMessage(
      next.printings.length
        ? `Title locked: ${next.name}. Scan set & number, or Pick manually (${next.printings.length} printings).`
        : `Title locked: ${next.name}. Scan set & number, or Pick manually.`,
    );
  };

  /** Step 2: set / number / symbol only (name already locked). */
  const runDetailsPass = async (card: HTMLCanvasElement, base: Progress) => {
    setMessage('Reading set & number…');
    const ocr = (region: Region) => enhanceForOcr(cropRegion(card, region));

    const rawStrip = cropRegion(card, COLLECTOR_REGION);
    const rawData = rawStrip
      .getContext('2d')
      ?.getImageData(0, 0, rawStrip.width, rawStrip.height);
    const stats = rawData ? imageStats(rawData.data) : null;

    const [numberText, classicNumberText, setText, setSymbolText, collectorText] =
      await Promise.all([
        readText(ocr(NUMBER_REGION), COLLECTOR_WHITELIST),
        readText(ocr(CLASSIC_NUMBER_REGION), COLLECTOR_WHITELIST),
        readText(ocr(SET_REGION), COLLECTOR_WHITELIST),
        readText(ocr(SET_SYMBOL_REGION), SET_SYMBOL_WHITELIST),
        readText(ocr(COLLECTOR_REGION), COLLECTOR_WHITELIST),
      ]);

    let next: Progress = { ...base, collector: { ...base.collector } };
    if (next.name && next.printings.length === 0) {
      next = { ...next, printings: await fetchPrintingsByName(next.name) };
    }

    next.collector = mergePartsForScan(next.collector, parseCollectorParts(numberText), {
      nameLocked: true,
    });
    next.collector = mergePartsForScan(
      next.collector,
      parseCollectorParts(classicNumberText),
      { nameLocked: true },
    );
    next.collector = mergePartsForScan(next.collector, parseCollectorParts(setText), {
      nameLocked: true,
    });
    next.collector = mergePartsForScan(next.collector, parseCollectorParts(collectorText), {
      nameLocked: true,
    });

    const symbolSet = parseSetSymbolText(setSymbolText);
    if (symbolSet) {
      next.collector = mergePartsForScan(
        next.collector,
        { foilMarker: null, raw: setSymbolText, setCode: symbolSet },
        { nameLocked: true },
      );
    }

    setProgress(next);
    if (await tryResolve(next, stats)) return;

    const missing = [
      !next.collector.setCode ? 'edition' : null,
      !next.collector.collectorNumber ? 'number' : null,
    ].filter(Boolean);
    setPhase('camera');
    setMessage(
      missing.length
        ? `Still need ${missing.join(' & ')}. Zoom those bands, Scan again, or Pick manually.`
        : 'Have set & number but Scryfall couldn’t pin one printing — Pick manually.',
    );
  };

  const runOnCard = async (card: HTMLCanvasElement) => {
    setPhase('working');
    try {
      if (step === 'title' || !progress.name) {
        await runTitlePass(card, progress);
      } else {
        await runDetailsPass(card, progress);
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
    setMessage(step === 'title' ? 'Focusing on title…' : 'Focusing…');
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
  const onTitleStep = step === 'title' || !haveName;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-canvas">
      {phase === 'pick' ? (
        <div className="flex min-h-0 flex-1 flex-col bg-panel">
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
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
          <ul className="min-h-0 flex-1 overflow-y-auto px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            {pickList.map(p => (
              <li key={p.id}>
                <button
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-raised active:bg-raised"
                  onClick={() => enterReview(p, progress.collector, null)}
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
      ) : phase === 'review' && review ? (
        <div className="flex min-h-0 flex-1 flex-col bg-panel px-4 py-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
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
          <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            <div className="flex gap-3">
              {review.printing.imageUrl ? (
                <img
                  alt=""
                  className="h-28 w-auto rounded-md border border-line"
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
          </div>
          <div className="mt-3 flex shrink-0 gap-2">
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
        <>
          <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
            <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 pb-24">
              <div
                ref={frameRef}
                className="relative w-[min(72vw,280px)] overflow-hidden rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
                style={{ aspectRatio: '63 / 88' }}
              >
                {onTitleStep ? (
                  <>
                    <Guide active done={false} region={TITLE_ZOOM_REGION} />
                    <Guide active done={false} region={TITLE_LINE_REGION} />
                    <Guide active done={false} region={NAME_REGION} />
                  </>
                ) : (
                  <>
                    <Guide active={false} done region={NAME_REGION} />
                    <Guide active={!haveNumber} done={haveNumber} region={NUMBER_REGION} />
                    <Guide
                      active={!haveNumber}
                      done={haveNumber}
                      region={CLASSIC_NUMBER_REGION}
                    />
                    <Guide active={!haveSet} done={haveSet} region={SET_REGION} />
                    <Guide active={!haveSet} done={haveSet} region={SET_SYMBOL_REGION} />
                  </>
                )}
              </div>
            </div>

            <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-gradient-to-t from-black/80 via-black/50 to-transparent px-4 pb-3 pt-10">
              {phase === 'error' ? (
                <p className="text-center text-xs text-red-300">
                  {message ?? 'Camera unavailable.'}
                </p>
              ) : message ? (
                <p className="text-center text-xs text-white/90">{message}</p>
              ) : onTitleStep ? (
                <p className="text-center text-[11px] text-white/70">
                  Step 1 — fill the guide with the card title, then tap Scan.
                </p>
              ) : (
                <p className="text-center text-[11px] text-white/70">
                  Step 2 — scan set & number, or Pick manually below.
                </p>
              )}
              <div className="flex items-center gap-2">
                {(haveName || haveSet || haveNumber) && (
                  <button
                    className="rounded-full border border-white/30 bg-black/40 px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
                    disabled={phase === 'working'}
                    onClick={reset}
                    type="button"
                  >
                    Reset
                  </button>
                )}
                <button
                  className="flex-1 rounded-full bg-accent py-3.5 text-base font-semibold text-accent-ink shadow-lg disabled:opacity-50"
                  disabled={phase === 'working' || phase === 'error'}
                  onClick={() => void snap()}
                  type="button"
                >
                  {phase === 'working'
                    ? 'Reading…'
                    : onTitleStep
                      ? 'Scan title'
                      : 'Scan set / number'}
                </button>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-col gap-2 border-t border-line bg-panel px-4 py-2.5">
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
            <div className="flex gap-2">
              {haveName ? (
                <button
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 py-2 text-sm font-medium text-accent disabled:opacity-50"
                  disabled={phase === 'working'}
                  onClick={() => void openManualPick()}
                  type="button"
                >
                  <List aria-hidden size={14} />
                  Pick manually
                </button>
              ) : null}
              <button
                className="flex-1 rounded-lg border border-line-strong py-2 text-sm font-medium text-ink-muted disabled:opacity-50"
                disabled={phase === 'working'}
                onClick={() => fileRef.current?.click()}
                type="button"
              >
                Use photo
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
