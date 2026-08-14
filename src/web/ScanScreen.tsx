// Point the phone at a card; build name + set + number across snaps.
//
// Pipeline: capture (padded guide) → detect card quad → perspective warp to a
// canonical card raster → step-1 title OCR → match against the local card-name
// index → step-2 set/number (or Pick manually).

import { useEffect, useRef, useState } from 'react';

import { loadCardIndex } from './cardIndexStore';
import { ScanDebugPanel } from './scan/ScanDebugPanel';
import {
  capturePreparedCard,
  imageFromFile,
  openCamera,
  type CameraSession,
  type Capture,
} from './scan/camera';
import { disposeOcr, tesseractRecognizer } from './scan/tesseractRecognizer';

import type { CollectionCard } from '@/lib/collection';
import { flags } from '@/lib/flags';
import {
  ScanTimer,
  emptyDiagnostics,
  type ScanDiagnostics,
} from '@/lib/scan/diagnostics';
import { guessFoil, imageStats, type FoilHint } from '@/lib/scan/foil';
import { matchReadings, type NameCandidate, type Reading } from '@/lib/scan/matchName';
import { mergePartsForScan, type CollectorParts } from '@/lib/scan/parseCollector';
import { glareRatio } from '@/lib/scan/quality';
import { readCollector, readTitle } from '@/lib/scan/readCard';
import {
  CLASSIC_NUMBER_REGION,
  COLLECTOR_REGION,
  NAME_REGION,
  NUMBER_REGION,
  SET_REGION,
  SET_SYMBOL_REGION,
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
import { cropImage, type ScanImage } from '@/lib/scan/types';
import { Check, Hash, Library, List, Type, type LucideIcon } from '@/ui/components/icons';

type Phase = 'camera' | 'working' | 'pick' | 'review' | 'error';
/** Procedural scan: title first, then collector details. */
type Step = 'title' | 'details';

interface Progress {
  /**
   * Runners-up from the name match, best first, so "Pick manually" can offer the
   * other cards it nearly was instead of only other printings of this one.
   */
  candidates: NameCandidate[];
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
  candidates: [],
  collector: { foilMarker: null, raw: '' },
  name: null,
  printings: [],
});

/**
 * Longest tidied reading — the pre-index heuristic, kept only for the fallback
 * path. Length is not evidence of quality; the index is.
 */
const bestReading = (readings: readonly Reading[]): string | null =>
  readings.reduce<string | null>(
    (best, r) => (!best || r.text.length > best.length ? r.text : best),
    null,
  );

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

  const [detected, setDetected] = useState(false);
  const [focusRing, setFocusRing] = useState<{ key: number, x: number; y: number; } | null>(
    null,
  );
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [diagnostics, setDiagnostics] = useState<ScanDiagnostics | null>(null);
  const [showDebug, setShowDebug] = useState(false);

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
      if (focusTimer.current) clearTimeout(focusTimer.current);
      void disposeOcr();
    };
  }, []);

  const onTapFocus = (e: React.PointerEvent<HTMLDivElement>) => {
    // Ignore taps on the bottom controls (buttons / copy).
    if ((e.target as HTMLElement).closest('[data-scan-controls]')) return;
    if (phase === 'working' || phase === 'error') return;

    const video = videoRef.current;
    const cam = session.current;
    if (!video || !cam) return;

    const host = e.currentTarget.getBoundingClientRect();
    setFocusRing({
      key: Date.now(),
      x: e.clientX - host.left,
      y: e.clientY - host.top,
    });
    if (focusTimer.current) clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(() => setFocusRing(null), 900);

    void cam.focusAt(e.clientX, e.clientY);
  };

  const reset = () => {
    setProgress(emptyProgress());
    setReview(null);
    setStep('title');
    setPhase('camera');
    setMessage(null);
    setDetected(false);
    setDiagnostics(null);
    setShowDebug(false);
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

  /**
   * Settle on a card name, preferring the local index.
   *
   * The index answers with a *ranked* list, which the Scryfall fuzzy endpoint
   * cannot: it returns one card and no score, so an ambiguous read is
   * indistinguishable from a certain one. Ranking is what lets an unsure scan
   * offer a choice instead of guessing, and it works with no signal.
   *
   * Scryfall stays as the fallback for a card too new for the cached index, and
   * for the first scan before the download lands.
   */
  const lockTitle = async (
    readings: Reading[],
    base: Progress,
    diag: ScanDiagnostics,
  ): Promise<Progress | null> => {
    const { index } = await loadCardIndex();
    if (index) {
      const ranked = matchReadings(readings, index, { limit: 8 });
      diag.candidates = ranked.map(c => ({ name: c.name, score: c.score }));
      if (ranked.length) {
        const printings = await fetchPrintingsByName(ranked[0].name);
        return { ...base, candidates: ranked, name: ranked[0].name, printings };
      }
    }

    // No index, or nothing in it came close enough.
    const ocrName = bestReading(readings);
    if (!ocrName) return null;
    const named = await fetchNamedFuzzy(ocrName);
    if (named) {
      const printings = await fetchPrintingsByName(named.name);
      return { ...base, candidates: [], name: named.name, printings };
    }
    return ocrName.length >= 3
      ? { ...base, candidates: [], name: ocrName, printings: [] }
      : null;
  };

  /** Step 1: only title OCR — full-card name bar OR a title-only zoom. */
  const runTitlePass = async (
    card: ScanImage,
    base: Progress,
    timer: ScanTimer,
    diag: ScanDiagnostics,
  ) => {
    setMessage('Reading title…');
    const { readings, samples } = await timer.measureAsync('ocr:title', () =>
      readTitle(card, tesseractRecognizer, { keepCrops: flags.scanDebug }),
    );
    diag.ocr.push(...samples);

    if (!readings.length) {
      diag.outcome = 'no title text read';
      setPhase('camera');
      setMessage(
        'Couldn’t read a title. Frame the card (or fill the guide with the name) and Scan again.',
      );
      return;
    }

    const next = await timer.measureAsync('match:name', () => lockTitle(readings, base, diag));
    if (!next?.name) {
      const tried = bestReading(readings) ?? '';
      diag.outcome = `read "${tried}" but no card matched`;
      setPhase('camera');
      setMessage(`Read “${tried}” but couldn’t match a card. Try a clearer shot.`);
      return;
    }

    diag.outcome = `title locked: ${next.name}`;
    setProgress(next);
    setStep('details');
    setPhase('camera');
    const how = diag.source === 'detected'
      ? 'Card detected & straightened.'
      : 'Using the guide frame (no card edges found).';
    setMessage(
      next.printings.length
        ? `${how} Title: ${next.name}. Scan set & number, or Pick manually (${next.printings.length}).`
        : `${how} Title: ${next.name}. Scan set & number, or Pick manually.`,
    );
  };

  /** Step 2: set / number / symbol only (name already locked). */
  const runDetailsPass = async (
    card: ScanImage,
    base: Progress,
    timer: ScanTimer,
    diag: ScanDiagnostics,
  ) => {
    setMessage('Reading set & number…');
    const stats = imageStats(cropImage(card, COLLECTOR_REGION).data);

    const { parts, samples } = await timer.measureAsync('ocr:collector', () =>
      readCollector(
        card,
        tesseractRecognizer,
        (into, incoming) => mergePartsForScan(into, incoming, { nameLocked: true }),
        { keepCrops: flags.scanDebug },
      ),
    );
    diag.ocr.push(...samples);

    let next: Progress = {
      ...base,
      collector: mergePartsForScan(base.collector, parts, { nameLocked: true }),
    };
    if (next.name && next.printings.length === 0) {
      next = {
        ...next,
        printings: await timer.measureAsync('scryfall:printings', () =>
          fetchPrintingsByName(next.name as string),
        ),
      };
    }

    setProgress(next);
    if (await timer.measureAsync('scryfall:resolve', () => tryResolve(next, stats))) {
      diag.outcome = 'printing resolved';
      return;
    }

    const missing = [
      !next.collector.setCode ? 'edition' : null,
      !next.collector.collectorNumber ? 'number' : null,
    ].filter(Boolean);
    diag.outcome = missing.length ? `missing ${missing.join(' & ')}` : 'no unique printing';
    setPhase('camera');
    setMessage(
      missing.length
        ? `Still need ${missing.join(' & ')}. Zoom those bands, Scan again, or Pick manually.`
        : 'Have set & number but Scryfall couldn’t pin one printing — Pick manually.',
    );
  };

  const runOnCard = async (capture: Capture, fromPhoto: boolean) => {
    const timer = new ScanTimer();
    const diag: ScanDiagnostics = {
      ...emptyDiagnostics(),
      ...(flags.scanDebug ? { cardImage: capture.card.image } : {}),
      corners: capture.card.corners,
      detectionScore: capture.card.score,
      frameHeight: capture.frame.height,
      frameWidth: capture.frame.width,
      glare: glareRatio(capture.card.image),
      sharpness: capture.sharpness,
      source: fromPhoto ? 'photo' : capture.card.source,
    };

    setDetected(capture.card.detected);
    setPhase('working');
    try {
      if (step === 'title' || !progress.name) {
        await runTitlePass(capture.card.image, progress, timer, diag);
      } else {
        await runDetailsPass(capture.card.image, progress, timer, diag);
      }
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      diag.outcome = `error: ${text}`;
      setPhase('camera');
      setMessage(text);
    } finally {
      diag.timings = timer.timings;
      diag.totalMs = timer.totalMs;
      setDiagnostics(diag);
    }
  };

  const snap = async () => {
    const video = videoRef.current;
    const frame = frameRef.current;
    if (!video || !frame || video.readyState < 2) return;
    setPhase('working');
    setMessage(
      step === 'title' ? 'Detecting card & reading title…' : 'Detecting card…',
    );
    try {
      const guide = frame.getBoundingClientRect();
      const host = video.getBoundingClientRect();
      const capture = await capturePreparedCard(video, {
        height: guide.height,
        left: guide.left - host.left,
        top: guide.top - host.top,
        width: guide.width,
      });
      await runOnCard(capture, false);
    } catch (err) {
      setPhase('camera');
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const onPickPhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      await runOnCard(await imageFromFile(file), true);
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

  /**
   * Switch to a runner-up from the name match.
   *
   * Worth offering because the failure it recovers from is invisible otherwise: a
   * confident match on the wrong card looks exactly like a right one until the
   * user reads the printing list and finds nothing they recognize.
   */
  const switchToCard = async (candidate: NameCandidate) => {
    setBusy(true);
    try {
      const printings = await fetchPrintingsByName(candidate.name);
      setProgress(p => ({ ...p, name: candidate.name, printings }));
      setMessage(`Switched to ${candidate.name}.`);
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
  const otherCards = progress.candidates.filter(c => c.name !== progress.name).slice(0, 5);

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
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            {otherCards.length ? (
              <div className="mb-2 rounded-lg border border-line bg-raised/40 p-2">
                <p className="px-1 pb-1 text-[11px] font-medium text-ink-faint">
                  Not this card? The title also looked like:
                </p>
                <ul className="flex flex-wrap gap-1">
                  {otherCards.map(c => (
                    <li key={c.name}>
                      <button
                        className="rounded-md border border-line-strong px-2 py-1 text-[12px] text-ink disabled:opacity-50"
                        disabled={busy}
                        onClick={() => void switchToCard(c)}
                        type="button"
                      >
                        {c.name}
                        {c.printedName ? (
                          <span className="text-ink-faint"> · {c.printedName}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <ul>
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
          <div
            className="relative min-h-0 flex-1 touch-manipulation overflow-hidden bg-black"
            onPointerDown={onTapFocus}
          >
            <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 pb-24">
              <div
                ref={frameRef}
                className="relative w-[min(72vw,280px)] overflow-hidden rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
                style={{ aspectRatio: '63 / 88' }}
              >
                {onTitleStep ? (
                  <Guide active done={false} region={NAME_REGION} />
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

            {focusRing ? (
              <div
                key={focusRing.key}
                aria-hidden
                className="pointer-events-none absolute h-16 w-16 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full border-2 border-white/90 opacity-80"
                style={{ animationDuration: '0.7s', left: focusRing.x, top: focusRing.y }}
              />
            ) : null}
            {focusRing ? (
              <div
                aria-hidden
                className="pointer-events-none absolute h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70"
                style={{ left: focusRing.x, top: focusRing.y }}
              />
            ) : null}

            {flags.scanDebug && diagnostics ? (
              <button
                className="absolute right-2 top-2 rounded border border-amber-300/60 bg-black/60 px-2 py-1 text-[10px] font-medium text-amber-200"
                data-scan-controls
                onClick={() => setShowDebug(true)}
                type="button"
              >
                Debug · {diagnostics.totalMs.toFixed(0)}ms
              </button>
            ) : null}
            {flags.scanDebug && showDebug && diagnostics ? (
              <ScanDebugPanel diagnostics={diagnostics} onClose={() => setShowDebug(false)} />
            ) : null}

            <div
              className="absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-gradient-to-t from-black/80 via-black/50 to-transparent px-4 pb-3 pt-10"
              data-scan-controls
            >
              {phase === 'error' ? (
                <p className="text-center text-xs text-red-300">
                  {message ?? 'Camera unavailable.'}
                </p>
              ) : message ? (
                <p className="text-center text-xs text-white/90">{message}</p>
              ) : onTitleStep ? (
                <p className="text-center text-[11px] text-white/70">
                  Step 1 — tap to focus, frame the card, then Scan title.
                </p>
              ) : (
                <p className="text-center text-[11px] text-white/70">
                  Step 2 — tap to focus, scan set & number
                  {detected ? ' (perspective locked)' : ''}
                  , or Pick manually.
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
