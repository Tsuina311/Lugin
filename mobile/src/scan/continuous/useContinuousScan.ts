/**
 * Continuous Single Scan hook — ManaBox-class automatic identity.
 * Snapshot-first CLIP ∥ OCR. Does NOT mutate collection.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CameraRef } from 'react-native-vision-camera';

import {
  appendOcrObservation,
  appendVisualObservation,
  applyPublishToSession,
  decideCardChange,
  emptyContinuousSession,
  isRecognitionEligible,
  startNewTrack,
  tryPublish,
  unlockForChange,
  type ContinuousIdentity,
  type ContinuousPhase,
  type ContinuousSession,
} from '@/lib/scan/continuous';
import type { CardNameIndex } from '@/lib/scan/matchName';
import type { CardCorners } from '@/lib/scan/types';

import type { HiResSpaces } from '../hiresCapture';
import {
  clearLockedVisualHandle,
  getVisualInitInfo,
  getVisualRecognizerState,
  initializeVisualRecognizer,
  lockVisualHandle,
  warmUpVisualRecognizer,
  type VisualRecognizerState,
} from '../visualRecognizer';
import { runContinuousAttempt } from './attempt';

/** Duty cycle while unresolved — 2–4 Hz (250–500 ms). */
export const CONTINUOUS_DUTY_MIN_MS = 250;
export const CONTINUOUS_DUTY_MAX_MS = 500;
export const CONTINUOUS_RECENT_STRIP = 5;

export type ContinuousFeatureFlags = {
  continuousScanEnabled: boolean;
  nativeClipEnabled: boolean;
};

export type ContinuousScanUi = {
  active: boolean;
  phase: ContinuousPhase;
  publishedName: string | null;
  confidence: number;
  recentIdentities: ContinuousIdentity[];
  visualState: VisualRecognizerState;
  message: string;
  lastDutyMs: number | null;
  lastIdentityMs: number | null;
  lastEncoderMs: number | null;
  lastSearchMs: number | null;
  lastOcrMs: number | null;
  clipQueries: number;
  droppedTriggers: number;
  modelLoadMs: number | null;
  indexLoadMs: number | null;
  warmMs: number | null;
};

export type UseContinuousScanArgs = {
  flags?: Partial<ContinuousFeatureFlags>;
  liveCorners: CardCorners | null;
  liveScore?: number | null;
  analysisSize: { width: number; height: number } | null;
  spaces: HiResSpaces | null;
  cameraRef: { current: CameraRef | null };
  nameIndex: CardNameIndex | null;
  enabled?: boolean;
  /** CLIP-only vs CLIP+OCR. Default true (CLIP+OCR). */
  runOcr?: boolean;
};

const defaultFlags = (): ContinuousFeatureFlags => ({
  continuousScanEnabled: false,
  nativeClipEnabled: false,
});

const idleUi = (): ContinuousScanUi => ({
  active: false,
  phase: 'NO_CARD',
  publishedName: null,
  confidence: 0,
  recentIdentities: [],
  visualState: getVisualRecognizerState(),
  message: '',
  lastDutyMs: null,
  lastIdentityMs: null,
  lastEncoderMs: null,
  lastSearchMs: null,
  lastOcrMs: null,
  clipQueries: 0,
  droppedTriggers: 0,
  modelLoadMs: null,
  indexLoadMs: null,
  warmMs: null,
});

export const useContinuousScan = (args: UseContinuousScanArgs) => {
  const flags: ContinuousFeatureFlags = { ...defaultFlags(), ...args.flags };
  const enabled = Boolean(args.enabled && flags.continuousScanEnabled);
  const [ui, setUi] = useState<ContinuousScanUi>(idleUi);
  const sessionRef = useRef<ContinuousSession>(emptyContinuousSession());
  const busyRef = useRef(false);
  const lastTickRef = useRef(0);
  const lockedHandleRef = useRef(0);
  const lockedCornersRef = useRef<CardCorners | null>(null);
  const embDiffStreakRef = useRef(0);
  const clipQueriesRef = useRef(0);
  const droppedRef = useRef(0);

  useEffect(() => {
    if (!enabled || !flags.nativeClipEnabled) return;
    let cancelled = false;
    void (async () => {
      const s = await initializeVisualRecognizer();
      if (cancelled) return;
      const init = getVisualInitInfo();
      setUi(prev => ({
        ...prev,
        visualState: s,
        modelLoadMs: init?.modelLoadMs ?? null,
        indexLoadMs: init?.indexLoadMs ?? null,
        message: s === 'READY' ? 'CLIP READY' : s === 'ERROR' ? init?.error ?? 'CLIP ERROR' : s,
      }));
      if (s === 'READY') {
        const warm = await warmUpVisualRecognizer();
        if (cancelled) return;
        setUi(prev => ({
          ...prev,
          warmMs: warm?.warmMs ?? null,
          message: 'CLIP READY',
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, flags.nativeClipEnabled]);

  const publishUi = useCallback(
    (session: ContinuousSession, patch: Partial<ContinuousScanUi> = {}) => {
      setUi(prev => ({
        ...prev,
        active: enabled,
        phase: session.phase,
        publishedName: session.activeTrack?.publishedIdentity?.name ?? null,
        confidence: session.activeTrack?.confidence ?? 0,
        recentIdentities: session.recentIdentities.slice(-CONTINUOUS_RECENT_STRIP),
        visualState: getVisualRecognizerState(),
        clipQueries: clipQueriesRef.current,
        droppedTriggers: droppedRef.current,
        ...patch,
      }));
    },
    [enabled],
  );

  const tick = useCallback(
    (now = performance.now()) => {
      if (!enabled) return;
      const session = sessionRef.current;
      const corners = args.liveCorners;
      const frame = args.analysisSize;
      if (!frame) return;

      const eligible = isRecognitionEligible({
        corners,
        frame,
        score: args.liveScore,
      });

      if (!eligible.eligible || !corners) {
        session.missFrames += 1;
        if (session.activeTrack?.locked) {
          const decision = decideCardChange({
            embeddingSimilarity: session.activeTrack.lastEmbeddingSimilarity,
            missFrames: session.missFrames,
            corners: null,
            lockedCorners: lockedCornersRef.current,
            frame,
            embeddingDiffStreak: embDiffStreakRef.current,
          });
          if (decision.startNewTrack) {
            const unlocked = unlockForChange(session.activeTrack);
            sessionRef.current = startNewTrack(
              { ...session, activeTrack: unlocked, phase: 'CARD_CHANGE' },
              now,
            );
            lockedHandleRef.current = 0;
            lockedCornersRef.current = null;
            embDiffStreakRef.current = 0;
            void clearLockedVisualHandle();
            publishUi(sessionRef.current, { message: decision.reason });
          }
        } else if (session.missFrames >= 8) {
          sessionRef.current = { ...session, phase: 'NO_CARD', activeTrack: null };
          publishUi(sessionRef.current, { message: 'no_card' });
        }
        return;
      }

      session.missFrames = 0;

      if (!session.activeTrack) {
        sessionRef.current = startNewTrack(session, now);
        publishUi(sessionRef.current, { message: 'candidate' });
        return;
      }

      if (session.activeTrack.locked) {
        const decision = decideCardChange({
          embeddingSimilarity: session.activeTrack.lastEmbeddingSimilarity,
          missFrames: 0,
          corners,
          lockedCorners: lockedCornersRef.current,
          frame,
          embeddingDiffStreak: embDiffStreakRef.current,
        });
        if (decision.suppressDuplicate) {
          lockedCornersRef.current = corners;
          publishUi(session, { message: 'locked' });
          return;
        }
        if (decision.startNewTrack) {
          const unlocked = unlockForChange(session.activeTrack);
          sessionRef.current = startNewTrack(
            { ...session, activeTrack: unlocked, phase: 'CARD_CHANGE' },
            now,
          );
          lockedHandleRef.current = 0;
          lockedCornersRef.current = null;
          embDiffStreakRef.current = 0;
          void clearLockedVisualHandle();
          publishUi(sessionRef.current, { message: decision.reason });
          return;
        }
        lockedCornersRef.current = corners;
        return;
      }

      const since = now - lastTickRef.current;
      if (since < CONTINUOUS_DUTY_MIN_MS) return;
      if (busyRef.current) {
        droppedRef.current += 1;
        return;
      }
      if (!args.spaces || !flags.nativeClipEnabled) {
        publishUi(sessionRef.current, {
          message: !flags.nativeClipEnabled ? 'nativeClipEnabled=false' : 'no_spaces',
        });
        return;
      }
      if (getVisualRecognizerState() !== 'READY') {
        publishUi(sessionRef.current, {
          message: `CLIP ${getVisualRecognizerState()}`,
          visualState: getVisualRecognizerState(),
        });
        return;
      }

      lastTickRef.current = now;
      sessionRef.current = { ...session, phase: 'RECOGNIZING' };
      publishUi(sessionRef.current, { lastDutyMs: since, message: 'SEARCHING…' });

      const ownerGen = session.activeTrack.generation;
      const seed = corners;
      const spaces = args.spaces;
      busyRef.current = true;
      clipQueriesRef.current += 1;

      void (async () => {
        try {
          const attempt = await runContinuousAttempt({
            cameraRef: args.cameraRef,
            liveSeed: seed,
            spaces,
            nameIndex: args.nameIndex,
            runOcr: args.runOcr !== false,
          });

          const cur = sessionRef.current.activeTrack;
          if (!cur || cur.generation !== ownerGen || cur.locked) return;

          let track = cur;
          if (attempt.visual) {
            track = appendVisualObservation(track, {
              at: performance.now(),
              name: attempt.visual.name,
              oracleId: attempt.visual.oracleId ?? null,
              score: attempt.visual.score,
              margin: attempt.visual.margin ?? null,
              embedding: null,
            });
          }
          if (attempt.ocr) {
            track = appendOcrObservation(track, {
              at: performance.now(),
              name: attempt.ocr.name,
              oracleId: attempt.ocr.oracleId ?? null,
              score: attempt.ocr.score,
              exact: attempt.ocr.exact ?? false,
            });
          }

          const result = tryPublish(track, ownerGen, performance.now());
          if (!result.owned) return;

          const ocrMs =
            attempt.timing.ocrDoneAt > attempt.timing.ocrStartedAt
              ? attempt.timing.ocrDoneAt - attempt.timing.ocrStartedAt
              : null;

          if (result.published) {
            sessionRef.current = applyPublishToSession(
              sessionRef.current,
              result.track,
              CONTINUOUS_RECENT_STRIP,
            );
            lockedCornersRef.current = seed;
            if (attempt.embeddingHandle > 0) {
              lockedHandleRef.current = attempt.embeddingHandle;
              void lockVisualHandle(attempt.embeddingHandle);
            }
            publishUi(sessionRef.current, {
              message: result.reason,
              lastIdentityMs: attempt.timing.totalMs,
              lastEncoderMs: attempt.timing.encoderMs,
              lastSearchMs: attempt.timing.searchMs,
              lastOcrMs: ocrMs,
            });
          } else {
            sessionRef.current = {
              ...sessionRef.current,
              activeTrack: result.track,
              phase: 'RECOGNIZING',
            };
            publishUi(sessionRef.current, {
              message: result.reason || 'SEARCHING…',
              lastIdentityMs: attempt.timing.totalMs,
              lastEncoderMs: attempt.timing.encoderMs,
              lastSearchMs: attempt.timing.searchMs,
              lastOcrMs: ocrMs,
            });
          }
        } catch (err) {
          publishUi(sessionRef.current, {
            message: err instanceof Error ? err.message : String(err),
          });
        } finally {
          busyRef.current = false;
        }
      })();
    },
    [
      args.analysisSize,
      args.cameraRef,
      args.liveCorners,
      args.liveScore,
      args.nameIndex,
      args.runOcr,
      args.spaces,
      enabled,
      flags.nativeClipEnabled,
      publishUi,
    ],
  );

  const debugInjectEvidence = useCallback(
    (argsInj: {
      visual?: { name: string; oracleId?: string | null; score: number; margin?: number | null };
      ocr?: { name: string; oracleId?: string | null; score: number; exact?: boolean };
    }) => {
      let session = sessionRef.current;
      if (!session.activeTrack) session = startNewTrack(session);
      let track = session.activeTrack!;
      if (argsInj.visual) {
        track = appendVisualObservation(track, {
          at: performance.now(),
          name: argsInj.visual.name,
          oracleId: argsInj.visual.oracleId ?? null,
          score: argsInj.visual.score,
          margin: argsInj.visual.margin ?? null,
          embedding: null,
        });
      }
      if (argsInj.ocr) {
        track = appendOcrObservation(track, {
          at: performance.now(),
          name: argsInj.ocr.name,
          oracleId: argsInj.ocr.oracleId ?? null,
          score: argsInj.ocr.score,
          exact: argsInj.ocr.exact ?? false,
        });
      }
      const published = tryPublish(track, track.generation);
      if (published.published) {
        session = applyPublishToSession(
          { ...session, activeTrack: published.track },
          published.track,
          CONTINUOUS_RECENT_STRIP,
        );
      } else {
        session = { ...session, activeTrack: published.track, phase: 'RECOGNIZING' };
      }
      sessionRef.current = session;
      publishUi(session, { message: published.reason });
    },
    [publishUi],
  );

  const reset = useCallback(() => {
    sessionRef.current = emptyContinuousSession();
    lockedHandleRef.current = 0;
    lockedCornersRef.current = null;
    embDiffStreakRef.current = 0;
    busyRef.current = false;
    void clearLockedVisualHandle();
    setUi(idleUi());
  }, []);

  return {
    ui,
    tick,
    reset,
    debugInjectEvidence,
    peekSession: () => sessionRef.current,
    flags,
  };
};
