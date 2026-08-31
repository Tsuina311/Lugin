// Continuous card scanner: live camera → detect → lock → multi-signal recognize.
//
// Shutter is optional (photo library / manual still). The normal path watches
// the video, waits for a stable card, and identifies automatically. High-
// confidence hits auto-add with a guessed foil finish so throughput stays high;
// ambiguous results show a candidate list for manual pick.

import { useEffect, useRef, useState } from 'react';

import { loadArtworkIndex } from './artworkIndexStore';
import { loadCardIndex } from './cardIndexStore';
import { ScanDebugPanel } from './scan/ScanDebugPanel';
import {
  capturePreparedCard,
  imageFromFile,
  openCamera,
  type CameraSession,
} from './scan/camera';
import { startLiveLoop, type LiveLoop } from './scan/liveLoop';
import { disposeOcr, tesseractRecognizer } from './scan/tesseractRecognizer';

import type { CollectionCard } from '@/lib/collection';
import { flags } from '@/lib/flags';
import { emptyDiagnostics, type ScanDiagnostics } from '@/lib/scan/diagnostics';
import { guessFoil } from '@/lib/scan/foil';
import {
  cardFromScan,
  fetchPrintingsByName,
  pickPrinting,
  type ScryfallPrinting,
} from '@/lib/scan/resolve';
import {
  createSessionController,
  type ScannerPhase,
  type SessionController,
  type SessionSnapshot,
} from '@/lib/scan/session/controller';
import { Image, RefreshCw } from '@/ui/components/icons';

type UiPhase = ScannerPhase | 'pick' | 'error';

const phaseHint = (phase: UiPhase, message: string): string => {
  if (phase === 'error') return message;
  if (phase === 'pick') return 'Pick a printing';
  return message;
};

const CornerOverlay = ({
  corners,
  video,
}: {
  corners: SessionSnapshot['corners'];
  video: HTMLVideoElement | null;
}) => {
  if (!corners || !video?.videoWidth) return null;
  const pts = [
    corners.topLeft,
    corners.topRight,
    corners.bottomRight,
    corners.bottomLeft,
  ];
  // liveLoop analysis frames are capped at 640 wide — corners are in that space.
  const aw = Math.min(video.videoWidth, 640);
  const ah = video.videoHeight * (aw / video.videoWidth);
  const points = pts.map(p => `${(p.x / aw) * 100}%,${(p.y / ah) * 100}%`).join(' ');
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      preserveAspectRatio="none"
      viewBox="0 0 100 100"
    >
      <polygon
        fill="rgba(56,189,248,0.12)"
        points={points}
        stroke="rgb(125,211,252)"
        strokeWidth="0.6"
      />
    </svg>
  );
};

export const ScanScreen = ({
  onAdd,
}: {
  onAdd: (card: CollectionCard) => Promise<void>;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionCam = useRef<CameraSession | null>(null);
  const controller = useRef<SessionController | null>(null);
  const loop = useRef<LiveLoop | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const foundKey = useRef<string | null>(null);
  const uiPhaseRef = useRef<UiPhase>('searching');

  const [uiPhase, setUiPhase] = useState<UiPhase>('searching');
  const [snap, setSnap] = useState<SessionSnapshot | null>(null);
  const [message, setMessage] = useState('Starting camera…');
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [printings, setPrintings] = useState<ScryfallPrinting[] | null>(null);
  const [diagnostics, setDiagnostics] = useState<ScanDiagnostics | null>(null);
  const [showDebug, setShowDebug] = useState(false);

  const setPhase = (p: UiPhase) => {
    uiPhaseRef.current = p;
    setUiPhase(p);
  };

  const resolveAndAdd = async (name: string, s: SessionSnapshot, auto: boolean) => {
    setBusy(true);
    try {
      const list = await fetchPrintingsByName(name);
      const collector = s.recognition?.collector;
      const printing =
        (collector && list.length ? pickPrinting(list, collector) : null) ??
        (list.length === 1 ? list[0] : null);

      if (!printing) {
        setPrintings(list.length ? list : null);
        setPhase('pick');
        setMessage(
          list.length
            ? `${name} — pick a printing`
            : `Matched “${name}” but no printings loaded.`,
        );
        return;
      }

      const hint = guessFoil(collector ?? { foilMarker: null, raw: '' }, null);
      const canFoil = printing.finishes.includes('foil');
      const card = cardFromScan(printing, {
        ...hint,
        foil: canFoil ? hint.foil : false,
      });
      await onAdd(card);
      setFlash(`Added ${printing.name}`);
      window.setTimeout(() => setFlash(null), 1600);
      if (!auto) {
        foundKey.current = null;
        controller.current?.reset();
        setPhase('searching');
        setMessage('Place a card in view');
      }
      // When auto, the session stays in FOUND until the card leaves.
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let alive = true;

    void (async () => {
      try {
        const [cam, names, art] = await Promise.all([
          openCamera(video),
          loadCardIndex(),
          loadArtworkIndex(),
        ]);
        if (!alive) {
          cam.stop();
          return;
        }
        sessionCam.current = cam;
        const ctrl = createSessionController({
          artwork: art.matcher,
          artworkIndex: art.art,
          nameIndex: names.index,
          ocr: tesseractRecognizer,
          textIndex: art.text,
        });
        controller.current = ctrl;
        const live = startLiveLoop(video, ctrl, s => {
          setSnap(s);
          setMessage(s.message);
          if (s.phase === 'searching') foundKey.current = null;
          if (s.phase === 'found' && s.fused?.card) {
            const key = s.fused.card.oracleId;
            if (foundKey.current !== key) {
              foundKey.current = key;
              void resolveAndAdd(s.fused.card.name, s, true);
              return;
            }
          }
          if (uiPhaseRef.current !== 'pick') setPhase(s.phase);
        });
        loop.current = live;
        live.start();
        setMessage('Place a card in view');
        setPhase('searching');
      } catch (err) {
        setPhase('error');
        setMessage(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      alive = false;
      loop.current?.stop();
      sessionCam.current?.stop();
      sessionCam.current = null;
      void disposeOcr();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetScan = () => {
    foundKey.current = null;
    setPrintings(null);
    setFlash(null);
    controller.current?.reset();
    setPhase('searching');
    setMessage('Place a card in view');
    setDiagnostics(null);
  };

  const onPickPhoto = async (file: File) => {
    setBusy(true);
    try {
      const capture = await imageFromFile(file);
      const ctrl = controller.current;
      if (!ctrl) return;
      loop.current?.stop();
      const s = await ctrl.recognizeStill(capture.frame);
      setSnap(s);
      setMessage(s.message);
      if (s.fused?.card) await resolveAndAdd(s.fused.card.name, s, false);
      else setPhase(s.phase);
      loop.current?.start();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const manualStill = async () => {
    const video = videoRef.current;
    const cam = sessionCam.current;
    const ctrl = controller.current;
    if (!video || !cam || !ctrl) return;
    setBusy(true);
    try {
      const capture = await capturePreparedCard(video, {
        height: video.clientHeight,
        left: 0,
        top: 0,
        width: video.clientWidth,
      });
      loop.current?.stop();
      const s = await ctrl.recognizeStill(capture.frame);
      setSnap(s);
      setDiagnostics({
        ...emptyDiagnostics(),
        corners: capture.card.corners,
        detectionScore: capture.card.score,
        source: capture.card.source,
      });
      if (s.fused?.card) await resolveAndAdd(s.fused.card.name, s, false);
      else {
        setPhase(s.phase);
        setMessage(s.message);
      }
      loop.current?.start();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const candidates = snap?.fused?.candidates ?? [];

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-black text-white">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <video
          ref={videoRef}
          autoPlay
          className="h-full w-full object-cover"
          muted
          playsInline
        />
        <CornerOverlay corners={snap?.corners ?? null} video={videoRef.current} />

        <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent px-3 pb-8 pt-3">
          <div className="text-sm font-medium">{phaseHint(uiPhase, message)}</div>
          {snap?.fused?.status === 'printing-ambiguous' && (
            <div className="text-xs text-amber-200">Card identified — printing uncertain</div>
          )}
          {snap?.fused?.status === 'card-ambiguous' && (
            <div className="text-xs text-amber-200">Card identity uncertain</div>
          )}
          {flash && (
            <div className="mt-2 rounded bg-emerald-500/90 px-2 py-1 text-xs font-semibold text-black">
              {flash}
            </div>
          )}
          {snap?.quality && flags.scanDebug && (
            <div className="mt-1 text-[10px] text-white/60">
              q {snap.quality.score.toFixed(2)} · sharp {snap.quality.sharpness.toFixed(0)} · glare{' '}
              {(snap.quality.glare * 100).toFixed(0)}%
            </div>
          )}
        </div>

        {(uiPhase === 'ambiguous' || (uiPhase === 'pick' && !printings?.length)) &&
          candidates.length > 0 && (
            <div
              className="absolute inset-x-0 bottom-24 max-h-40 overflow-auto bg-black/80 px-2 py-2"
              data-scan-controls
            >
              <div className="mb-1 text-[10px] uppercase tracking-wide text-white/50">
                Candidates
              </div>
              {candidates.slice(0, 6).map(c => (
                <button
                  key={c.oracleId}
                  className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-white/10"
                  onClick={() => snap && void resolveAndAdd(c.name, snap, false)}
                  type="button"
                >
                  <span className="truncate">{c.name}</span>
                  <span className="tabular-nums text-white/50">{c.score.toFixed(2)}</span>
                </button>
              ))}
            </div>
          )}

        {uiPhase === 'pick' && printings && printings.length > 0 && (
          <div
            className="absolute inset-x-0 bottom-24 max-h-48 overflow-auto bg-black/85 px-2 py-2"
            data-scan-controls
          >
            <div className="mb-1 text-[10px] uppercase tracking-wide text-white/50">
              Printings
            </div>
            {printings.slice(0, 12).map(p => (
              <button
                key={p.id}
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-white/10"
                onClick={() => {
                  void (async () => {
                    await onAdd(
                      cardFromScan(p, {
                        confidence: 0.5,
                        foil: false,
                        reason: 'manual pick',
                      }),
                    );
                    setFlash(`Added ${p.name}`);
                    window.setTimeout(() => setFlash(null), 1600);
                    resetScan();
                  })();
                }}
                type="button"
              >
                <span className="truncate">
                  {p.setName} · #{p.collectorNumber}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        className="flex flex-none items-center gap-2 border-t border-white/10 bg-zinc-950 px-3 py-2"
        data-scan-controls
      >
        <button
          className="rounded-lg bg-white/10 p-2"
          onClick={resetScan}
          title="Reset"
          type="button"
        >
          <RefreshCw size={18} />
        </button>
        <button
          className="rounded-lg bg-white/10 p-2"
          onClick={() => fileRef.current?.click()}
          title="Photo library"
          type="button"
        >
          <Image size={18} />
        </button>
        <input
          ref={fileRef}
          accept="image/*"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) void onPickPhoto(f);
            e.target.value = '';
          }}
          type="file"
        />
        <button
          className="ml-auto rounded-lg bg-sky-500 px-3 py-2 text-sm font-semibold text-black disabled:opacity-50"
          disabled={busy || uiPhase === 'error'}
          onClick={() => void manualStill()}
          type="button"
        >
          Scan now
        </button>
        {flags.scanDebug && (
          <button
            className="rounded-lg bg-white/10 px-2 py-2 text-[10px]"
            onClick={() => setShowDebug(v => !v)}
            type="button"
          >
            Debug
          </button>
        )}
      </div>

      {flags.scanDebug && showDebug && diagnostics && (
        <ScanDebugPanel diagnostics={diagnostics} onClose={() => setShowDebug(false)} />
      )}
    </div>
  );
};
