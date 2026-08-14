// Point the phone at a card, read set + number (+ name), add it to the collection.
//
// Standard frames only for now: name in the title bar, collector line at the
// bottom. Foil is ★ on that line when OCR sees it, else a soft image hint, else
// the toggle on the review sheet. Special layouts get their own region presets later.

import { useEffect, useRef, useState } from 'react';

import { captureCard, openCamera, type CameraSession } from './scan/camera';
import { COLLECTOR_WHITELIST, disposeOcr, readText } from './scan/ocr';

import type { CollectionCard } from '@/lib/collection';
import { guessFoil, imageStats, type FoilHint } from '@/lib/scan/foil';
import { parseCollectorLine } from '@/lib/scan/parseCollector';
import { COLLECTOR_REGION, NAME_REGION, cropRegion } from '@/lib/scan/regions';
import {
  cardFromScan,
  fetchPrinting,
  namesAgree,
  type ScryfallPrinting,
} from '@/lib/scan/resolve';

type Phase = 'camera' | 'working' | 'review' | 'error';

interface Review {
  card: CollectionCard;
  foil: FoilHint;
  nameOcr: string;
  nameWarn: boolean;
  printing: ScryfallPrinting;
  rawCollector: string;
}

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

  const snap = async () => {
    const video = videoRef.current;
    const frame = frameRef.current;
    if (!video || !frame || video.readyState < 2) return;
    setPhase('working');
    setMessage('Reading the card…');
    try {
      const guide = frame.getBoundingClientRect();
      const host = video.getBoundingClientRect();
      const card = captureCard(video, {
        height: guide.height,
        left: guide.left - host.left,
        top: guide.top - host.top,
        width: guide.width,
      });

      const collectorCanvas = cropRegion(card, COLLECTOR_REGION);
      const nameCanvas = cropRegion(card, NAME_REGION);
      const strip = collectorCanvas.getContext('2d')?.getImageData(
        0,
        0,
        collectorCanvas.width,
        collectorCanvas.height,
      );

      const [collectorText, nameText] = await Promise.all([
        readText(collectorCanvas, COLLECTOR_WHITELIST),
        readText(nameCanvas),
      ]);

      const parsed = parseCollectorLine(collectorText);
      if (!parsed) {
        setPhase('camera');
        setMessage(`Couldn’t read set/number from “${collectorText.trim() || '…'}”. Try again closer.`);
        return;
      }

      const printing = await fetchPrinting(parsed.setCode, parsed.collectorNumber);
      if (!printing) {
        setPhase('camera');
        setMessage(`No Scryfall card for ${parsed.setCode.toUpperCase()} #${parsed.collectorNumber}.`);
        return;
      }

      const hint = guessFoil(parsed, strip ? imageStats(strip.data) : null);
      const canFoil = printing.finishes.includes('foil');
      const next: Review = {
        card: cardFromScan(printing, hint),
        foil: hint,
        nameOcr: nameText.trim(),
        nameWarn: !namesAgree(nameText, printing.name),
        printing,
        rawCollector: parsed.raw,
      };
      setReview(next);
      setFoil(canFoil ? hint.foil : false);
      setPhase('review');
      setMessage(null);
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
      setReview(null);
      setPhase('camera');
      setMessage(`Added ${card.name}${card.foil ? ' (foil)' : ''}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
        <video
          ref={videoRef}
          className="h-full w-full object-cover"
          muted
          playsInline
        />
        {/* Card guide — 63:88 MTG aspect, centred. Region tints show where we read. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <div
            ref={frameRef}
            className="relative w-[min(78vw,320px)] overflow-hidden rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
            style={{ aspectRatio: '63 / 88' }}
          >
            <div
              className="absolute border border-sky-300/80 bg-sky-400/15"
              style={{
                height: `${NAME_REGION.h * 100}%`,
                left: `${NAME_REGION.x * 100}%`,
                top: `${NAME_REGION.y * 100}%`,
                width: `${NAME_REGION.w * 100}%`,
              }}
            />
            <div
              className="absolute border border-amber-300/90 bg-amber-400/20"
              style={{
                height: `${COLLECTOR_REGION.h * 100}%`,
                left: `${COLLECTOR_REGION.x * 100}%`,
                top: `${COLLECTOR_REGION.y * 100}%`,
                width: `${COLLECTOR_REGION.w * 100}%`,
              }}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-line bg-panel px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <p className="text-[11px] leading-snug text-ink-faint">
          Line the card up so the <span className="text-sky-600">name</span> and{' '}
          <span className="text-amber-700">set / number</span> sit in the tinted bands. Foil is
          read from ★ on the collector line when we can see it.
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
                <p className="mt-1 text-[10px] text-ink-faint">OCR: {review.rawCollector}</p>
                {review.nameWarn ? (
                  <p className="mt-1 text-[10px] text-warn">
                    Name OCR “{review.nameOcr || '…'}” doesn’t match — check the printing.
                  </p>
                ) : null}
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
                onClick={() => {
                  setReview(null);
                  setPhase('camera');
                }}
                type="button"
              >
                Retake
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
          <button
            className="rounded-lg bg-accent py-3.5 text-sm font-semibold text-accent-ink disabled:opacity-50"
            disabled={phase === 'working'}
            onClick={() => void snap()}
            type="button"
          >
            {phase === 'working' ? 'Reading…' : 'Scan card'}
          </button>
        )}
      </div>
    </div>
  );
};
