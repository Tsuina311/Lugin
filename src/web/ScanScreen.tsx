// Continuous card scanner: live camera → detect → lock → multi-signal recognize.
//
// Shutter is optional (photo library / manual still). The normal path watches
// the video, waits for a stable card, and identifies automatically.
// Optional Development Capture (explicit consent) queues selective frames to
// the user's Google Drive Scanner Corpus folder — never continuous video,
// never without opt-in, never auto-shared with the developer.

import { useEffect, useRef, useState } from 'react';

import { loadArtworkIndex } from './artworkIndexStore';
import { loadCardIndex } from './cardIndexStore';
import { CameraDebugPanel } from './scan/CameraDebugPanel';
import { CardOutline } from './scan/CardOutline';
import { ScanDebugPanel } from './scan/ScanDebugPanel';
import {
  capturePreparedCard,
  imageFromFile,
  openCamera,
  type CameraDiagnostics,
  type CameraSession,
} from './scan/camera';
import { CaptureConsentDialog } from './scan/corpus/CaptureConsentDialog';
import { CapturePreviewModal } from './scan/corpus/CapturePreviewModal';
import {
  createCorpusCaptureController,
  type CorpusCaptureController,
} from './scan/corpus/captureController';
import {
  getCorpusConsent,
  getCorpusStats,
  isCorpusCaptureEnabled,
  setCorpusConsent,
} from './scan/corpus/consent';
import { downloadPendingCorpusExport } from './scan/corpus/exportBundle';
import { clearPendingCorpus, countPendingCorpus } from './scan/corpus/queue';
import { sanitizeVideoFrame } from './scan/corpus/sanitize';
import {
  corpusDriveConnected,
  corpusUploadConfigured,
  isCorpusUploadPaused,
  openCorpusDriveFolder,
  pumpCorpusUploads,
  setCorpusUploadPaused,
} from './scan/corpus/uploader';
import { startLiveLoop, type LiveLoop } from './scan/liveLoop';
import { disposeOcr, tesseractRecognizer } from './scan/tesseractRecognizer';
import { syncStore } from './syncStore';

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
type ManualReport = 'detection-failure' | 'false-positive' | null;

const phaseHint = (phase: UiPhase, message: string): string => {
  if (phase === 'error') return message;
  if (phase === 'pick') return 'Pick a printing';
  if (phase === 'searching') return message || 'Place a card in view';
  if (phase === 'detected') return 'Hold steady';
  if (phase === 'focusing') return message || 'Focusing…';
  if (phase === 'locking') return 'Card locked';
  if (phase === 'recognizing') return 'Recognizing…';
  if (phase === 'found') return message;
  if (phase === 'ambiguous') return 'Card identity uncertain';
  return message;
};

export const ScanScreen = ({
  onAdd,
}: {
  onAdd: (card: CollectionCard) => Promise<void>;
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionCam = useRef<CameraSession | null>(null);
  const controller = useRef<SessionController | null>(null);
  const corpus = useRef<CorpusCaptureController | null>(null);
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
  const [needConsent, setNeedConsent] = useState(() => getCorpusConsent() == null);
  const [captureOn, setCaptureOn] = useState(() => isCorpusCaptureEnabled());
  const [pendingCount, setPendingCount] = useState(0);
  const [contributed, setContributed] = useState(() => getCorpusStats().contributed);
  const [showCaptureMenu, setShowCaptureMenu] = useState(false);
  const [manualReport, setManualReport] = useState<ManualReport>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadsPaused, setUploadsPaused] = useState(() => isCorpusUploadPaused());
  const [camDiag, setCamDiag] = useState<CameraDiagnostics | null>(null);
  const [showCamDebug, setShowCamDebug] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const setPhase = (p: UiPhase) => {
    uiPhaseRef.current = p;
    setUiPhase(p);
  };

  const refreshCorpusCounts = async () => {
    setPendingCount(await countPendingCorpus());
    setContributed(getCorpusStats().contributed);
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
    const capture = createCorpusCaptureController();
    corpus.current = capture;
    capture.setVideo(video);

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
        void cam.diagnostics().then(d => {
          if (alive) setCamDiag(d);
        });
        const ctrl = createSessionController({
          artwork: art.matcher,
          artworkIndex: art.art,
          nameIndex: names.index,
          ocr: tesseractRecognizer,
          textIndex: art.text,
        });
        controller.current = ctrl;
        capture.setActive(isCorpusCaptureEnabled());
        const live = startLiveLoop(
          video,
          ctrl,
          s => {
            setSnap(s);
            setMessage(s.message);
            capture.setNormalizedCard(ctrl.lastNormalized());
            capture.onSnapshot(s);
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
          },
          {
            requestFocusNorm: (x, y) => {
              void sessionCam.current?.focusAtNorm(x, y);
            },
          },
        );
        loop.current = live;
        live.start();
        setMessage('Place a card in view');
        setPhase('searching');
        void refreshCorpusCounts();
        void pumpCorpusUploads();
      } catch (err) {
        setPhase('error');
        setMessage(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      alive = false;
      capture.setActive(false);
      capture.dispose();
      corpus.current = null;
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

  const applyConsent = (answer: 'accepted' | 'declined') => {
    setCorpusConsent(answer);
    setNeedConsent(false);
    const on = answer === 'accepted';
    setCaptureOn(on);
    corpus.current?.setActive(on);
  };

  const turnCaptureOff = () => {
    setCorpusConsent('declined');
    setCaptureOn(false);
    corpus.current?.setActive(false);
    setShowCaptureMenu(false);
  };

  const turnCaptureOn = () => {
    setCorpusConsent('accepted');
    setCaptureOn(true);
    corpus.current?.setActive(true);
    setShowCaptureMenu(false);
  };

  const beginManualReport = async (kind: ManualReport) => {
    if (!kind || !videoRef.current?.videoWidth) return;
    setManualReport(kind);
    setPreviewUrl(null);
    try {
      const frame = await sanitizeVideoFrame(videoRef.current);
      setPreviewUrl(URL.createObjectURL(frame.blob));
    } catch {
      setManualReport(null);
    }
  };

  const confirmManualReport = async () => {
    if (!manualReport || !corpus.current) return;
    setBusy(true);
    try {
      if (manualReport === 'detection-failure') {
        await corpus.current.reportDetectionFailure();
      } else {
        await corpus.current.reportFalsePositive();
      }
      setFlash('Sample saved for development');
      window.setTimeout(() => setFlash(null), 1600);
      await refreshCorpusCounts();
    } finally {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setManualReport(null);
      setBusy(false);
    }
  };

  const discardManualReport = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setManualReport(null);
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
      corpus.current?.setNormalizedCard(ctrl.lastNormalized());
      corpus.current?.onSnapshot(s);
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
      corpus.current?.setNormalizedCard(ctrl.lastNormalized());
      corpus.current?.onSnapshot(s);
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

  const onPickCandidate = async (name: string) => {
    if (!snap) return;
    const predicted = snap.fused?.card?.name;
    if (captureOn && predicted && predicted !== name) {
      await corpus.current?.reportRecognitionCorrected({
        correctedName: name,
        correctedOracleId: `name:${name}`,
        normalized: controller.current?.lastNormalized() ?? null,
      });
      void refreshCorpusCounts();
    }
    await resolveAndAdd(name, snap, false);
  };

  const onPickPrinting = async (p: ScryfallPrinting) => {
    const predictedId = snap?.recognition?.collector
      ? undefined
      : snap?.fused?.candidates[0]?.possiblePrintingIds[0];
    if (captureOn && predictedId && predictedId !== p.id) {
      await corpus.current?.reportPrintingCorrected({
        correctedPrintingId: p.id,
        normalized: controller.current?.lastNormalized() ?? null,
      });
    } else if (captureOn && snap?.fused?.status === 'printing-ambiguous') {
      await corpus.current?.reportPrintingCorrected({
        correctedPrintingId: p.id,
        normalized: controller.current?.lastNormalized() ?? null,
      });
    }
    await onAdd(
      cardFromScan(p, {
        confidence: 0.5,
        foil: false,
        reason: 'manual pick',
      }),
    );
    setFlash(`Added ${p.name}`);
    window.setTimeout(() => setFlash(null), 1600);
    void refreshCorpusCounts();
    resetScan();
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
          onClick={e => {
            if (!sessionCam.current?.supportsTapFocus()) return;
            void sessionCam.current.focusAt(e.clientX, e.clientY).then(ok => {
              if (ok) {
                setFlash('Focusing…');
                window.setTimeout(() => setFlash(null), 900);
              }
            });
          }}
          playsInline
        />
        <CardOutline
          analysisSize={snap?.analysisSize ?? null}
          corners={snap?.corners ?? null}
          phase={
            uiPhase === 'pick' || uiPhase === 'error'
              ? 'searching'
              : (uiPhase as ScannerPhase)
          }
          video={videoRef.current}
        />

        <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent px-3 pb-10 pt-3">
          <div className="text-sm font-medium">{phaseHint(uiPhase, message)}</div>
          {uiPhase === 'searching' && !snap?.corners && (
            <div className="mt-0.5 text-xs text-white/55">No card detected yet</div>
          )}
          {snap?.fused?.status === 'printing-ambiguous' && (
            <div className="text-xs text-amber-200">Card identified — printing uncertain</div>
          )}
          {snap?.fused?.status === 'card-ambiguous' && (
            <div className="text-xs text-amber-200">Card identity uncertain</div>
          )}
          {captureOn && (
            <button
              className="pointer-events-auto mt-2 rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-100"
              onClick={() => setShowCaptureMenu(v => !v)}
              type="button"
            >
              Development capture ON
              {contributed > 0 ? ` · ${contributed} saved to Drive` : ''}
              {pendingCount > 0 ? ` · ${pendingCount} pending` : ''}
            </button>
          )}
          {flash && (
            <div className="mt-2 rounded bg-emerald-500/90 px-2 py-1 text-xs font-semibold text-black">
              {flash}
            </div>
          )}
          {flags.scanDebug && snap && (
            <div className="mt-1 space-y-0.5 text-[10px] text-white/60">
              <div>
                det {snap.detection.ms.toFixed(0)}ms · track {snap.trackFrames} · motion{' '}
                {snap.motion.toFixed(3)}
                {snap.quality
                  ? ` · sharp ${snap.quality.sharpness.toFixed(0)} · q ${snap.quality.score.toFixed(2)}`
                  : ''}
              </div>
              {camDiag && (
                <div>
                  cam {camDiag.video.width}×{camDiag.video.height}
                  {camDiag.settings.focusMode ? ` · focus ${camDiag.settings.focusMode}` : ''}
                  {camDiag.settings.frameRate
                    ? ` · ${camDiag.settings.frameRate.toFixed(0)}fps`
                    : ''}
                </div>
              )}
              {corpus.current?.getDebug()[0] && (
                <div>
                  CORPUS {corpus.current.getDebug()[0].event}: {corpus.current.getDebug()[0].note}
                </div>
              )}
            </div>
          )}
        </div>

        {showCaptureMenu && captureOn && (
          <div
            className="absolute inset-x-2 top-16 z-10 space-y-2 rounded-lg bg-zinc-900/95 p-3 text-sm"
            data-scan-controls
          >
            <div className="space-y-1 text-xs text-white/55">
              <p>
                Scanner development samples are stored in your Google Drive. They
                are not automatically shared with the Lugin developer.
              </p>
              <p>
                {corpusUploadConfigured()
                  ? corpusDriveConnected()
                    ? 'Google Drive connected — pending samples upload when online.'
                    : 'Google Drive not connected — samples queue locally until you connect.'
                  : 'Google is not configured in this build — samples stay local only.'}
              </p>
            </div>
            <button
              className="w-full rounded bg-white/10 px-2 py-1.5 text-left"
              onClick={() => void beginManualReport('detection-failure')}
              type="button"
            >
              Scanner can&apos;t find this card
            </button>
            <button
              className="w-full rounded bg-white/10 px-2 py-1.5 text-left"
              onClick={() => void beginManualReport('false-positive')}
              type="button"
            >
              Wrong outline
            </button>
            {!corpusDriveConnected() && corpusUploadConfigured() && (
              <button
                className="w-full rounded bg-sky-500/20 px-2 py-1.5 text-left text-sky-100"
                onClick={() => {
                  syncStore.connect();
                  setTimeout(() => void pumpCorpusUploads(), 800);
                }}
                type="button"
              >
                Connect Google Drive
              </button>
            )}
            <button
              className="w-full rounded bg-white/10 px-2 py-1.5 text-left disabled:opacity-40"
              disabled={!corpusDriveConnected()}
              onClick={() => void openCorpusDriveFolder()}
              type="button"
            >
              Open Scanner Corpus folder
            </button>
            <button
              className="w-full rounded bg-white/10 px-2 py-1.5 text-left"
              onClick={() => {
                void downloadPendingCorpusExport().then(n => {
                  setFlash(
                    n > 0
                      ? `Exported ${n} pending sample${n === 1 ? '' : 's'}`
                      : 'No pending samples to export',
                  );
                  window.setTimeout(() => setFlash(null), 2200);
                });
              }}
              type="button"
            >
              Export pending samples
            </button>
            <button
              className="w-full rounded bg-white/10 px-2 py-1.5 text-left"
              onClick={() => {
                const next = !uploadsPaused;
                setCorpusUploadPaused(next);
                setUploadsPaused(next);
                if (!next) void pumpCorpusUploads();
              }}
              type="button"
            >
              {uploadsPaused ? 'Resume Drive uploads' : 'Pause Drive uploads'}
            </button>
            <button
              className="w-full rounded bg-white/10 px-2 py-1.5 text-left"
              onClick={() => {
                void clearPendingCorpus().then(() => refreshCorpusCounts());
              }}
              type="button"
            >
              Delete pending captures ({pendingCount})
            </button>
            <button
              className="w-full rounded bg-rose-500/20 px-2 py-1.5 text-left text-rose-100"
              onClick={turnCaptureOff}
              type="button"
            >
              Turn development capture off
            </button>
          </div>
        )}

        {!captureOn && !needConsent && (
          <button
            className="absolute right-2 top-2 z-10 rounded bg-black/50 px-2 py-1 text-[10px] text-white/60"
            onClick={turnCaptureOn}
            type="button"
          >
            Help improve scanning
          </button>
        )}

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
                  onClick={() => void onPickCandidate(c.name)}
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
                onClick={() => void onPickPrinting(p)}
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
          <>
            <button
              className="rounded-lg bg-white/10 px-2 py-2 text-[10px]"
              onClick={() => {
                void sessionCam.current?.diagnostics().then(setCamDiag);
                setShowCamDebug(v => !v);
              }}
              type="button"
            >
              Cam
            </button>
            <button
              className="rounded-lg bg-white/10 px-2 py-2 text-[10px]"
              onClick={() => setShowDebug(v => !v)}
              type="button"
            >
              Debug
            </button>
          </>
        )}
      </div>

      {flags.scanDebug && showCamDebug && camDiag && (
        <CameraDebugPanel
          diagnostics={camDiag}
          onClose={() => setShowCamDebug(false)}
          onSelectDevice={id => {
            void sessionCam.current?.switchDevice(id).then(async () => {
              const d = await sessionCam.current?.diagnostics();
              if (d) setCamDiag(d);
            });
          }}
          onToggleTorch={() => {
            const next = !torchOn;
            void sessionCam.current?.setTorch(next).then(ok => {
              if (ok) setTorchOn(next);
            });
          }}
          torchOn={torchOn}
        />
      )}
      {needConsent && (
        <CaptureConsentDialog
          onAccept={() => applyConsent('accepted')}
          onDecline={() => applyConsent('declined')}
        />
      )}

      {manualReport && (
        <CapturePreviewModal
          busy={busy}
          onDiscard={discardManualReport}
          onSend={() => void confirmManualReport()}
          previewUrl={previewUrl}
          title={
            manualReport === 'detection-failure'
              ? 'Report: card not detected'
              : 'Report: wrong outline'
          }
        />
      )}

      {flags.scanDebug && showDebug && diagnostics && (
        <ScanDebugPanel diagnostics={diagnostics} onClose={() => setShowDebug(false)} />
      )}
    </div>
  );
};
