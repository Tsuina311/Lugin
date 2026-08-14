// Point the phone at a card; build name + set + number across snaps.
//
// Each capture tries all three regions. Fields that land stay checked (green)
// so the user knows what still needs a closer pass. Once the name is known we
// ask Scryfall for that card's printings, which turns a partial set/number into
// an exact match much more often than OCR alone.

import { useEffect, useRef, useState } from 'react';

import { captureCard, openCamera, type CameraSession } from './scan/camera';
import { COLLECTOR_WHITELIST, disposeOcr, readText } from './scan/ocr';

import type { CollectionCard } from '@/lib/collection';
import { guessFoil, imageStats, type FoilHint } from '@/lib/scan/foil';
import {
  mergeParts,
  parseCollectorParts,
  tidyName,
  type CollectorParts,
} from '@/lib/scan/parseCollector';
import {
  COLLECTOR_REGION,
  NAME_REGION,
  NUMBER_REGION,
  SET_REGION,
  cropRegion,
} from '@/lib/scan/regions';
import {
  cardFromScan,
  fetchNamedFuzzy,
  fetchPrinting,
  fetchPrintingsByName,
  pickPrinting,
  type ScryfallPrinting,
} from '@/lib/scan/resolve';
import { Check, Hash, Library, Type, type LucideIcon } from '@/ui/components/icons';

type Phase = 'camera' | 'working' | 'review' | 'error';

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
    return true;
  };

  const snap = async () => {
    const video = videoRef.current;
    const frame = frameRef.current;
    if (!video || !frame || video.readyState < 2) return;
    setPhase('working');
    setMessage('Reading…');
    try {
      const guide = frame.getBoundingClientRect();
      const host = video.getBoundingClientRect();
      const card = captureCard(video, {
        height: guide.height,
        left: guide.left - host.left,
        top: guide.top - host.top,
        width: guide.width,
      });

      const nameCanvas = cropRegion(card, NAME_REGION);
      const numberCanvas = cropRegion(card, NUMBER_REGION);
      const setCanvas = cropRegion(card, SET_REGION);
      const collectorCanvas = cropRegion(card, COLLECTOR_REGION);
      const strip = collectorCanvas.getContext('2d')?.getImageData(
        0,
        0,
        collectorCanvas.width,
        collectorCanvas.height,
      );
      const stats = strip ? imageStats(strip.data) : null;

      const [nameText, numberText, setText, collectorText] = await Promise.all([
        readText(nameCanvas),
        readText(numberCanvas, COLLECTOR_WHITELIST),
        readText(setCanvas, COLLECTOR_WHITELIST),
        readText(collectorCanvas, COLLECTOR_WHITELIST),
      ]);

      let next: Progress = { ...progress, collector: { ...progress.collector } };

      // Merge every OCR pass — split regions first, then the wide fallback.
      next.collector = mergeParts(next.collector, parseCollectorParts(numberText));
      next.collector = mergeParts(next.collector, parseCollectorParts(setText));
      next.collector = mergeParts(next.collector, parseCollectorParts(collectorText));

      const ocrName = tidyName(nameText);
      if (ocrName && !next.name) {
        const named = await fetchNamedFuzzy(ocrName);
        if (named) {
          next = {
            ...next,
            name: named.name,
            printings: await fetchPrintingsByName(named.name),
          };
        } else if (ocrName.length >= 5) {
          // Keep the raw OCR so the chip can show progress even before Scryfall agrees.
          next = { ...next, name: ocrName, printings: [] };
        }
      } else if (next.name && next.printings.length === 0) {
        next = { ...next, printings: await fetchPrintingsByName(next.name) };
      }

      setProgress(next);

      if (await tryResolve(next, stats)) return;

      const missing = [
        !next.name ? 'name' : null,
        !next.collector.setCode ? 'edition' : null,
        !next.collector.collectorNumber ? 'number' : null,
      ].filter(Boolean);
      setPhase('camera');
      setMessage(
        missing.length
          ? `Got a pass — still need ${missing.join(', ')}. Move closer to the missing band and scan again.`
          : 'Name, set and number are in, but Scryfall couldn’t pin one printing. Try another angle.',
      );
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

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
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
              className={`absolute border ${haveSet ? 'border-pos/80 bg-pos/20' : 'border-violet-300/90 bg-violet-400/20'}`}
              style={{
                height: `${SET_REGION.h * 100}%`,
                left: `${SET_REGION.x * 100}%`,
                top: `${SET_REGION.y * 100}%`,
                width: `${SET_REGION.w * 100}%`,
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
          Each scan tries all three. Green checks stick — nudge the card so the missing band is
          sharp, then scan again. A locked name narrows Scryfall to that card’s printings.
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
        )}
      </div>
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
