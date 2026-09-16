/**
 * Binder live HUD — per-card polygons + progress. No recognition.
 */

import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useMemo } from 'react';

import type { BinderOverlayCard, BinderPageHud, BinderTrack } from '@/lib/scan/binder';
import type { CardCorners } from '../sharedCore';
import { scanImageToPngDataUri } from '../debug/scanImagePng';

type OverlayLayout = {
  height: number;
  width: number;
  /** Map analysis/source-normalized corners → overlay pixels. */
  mapQuad: (q: CardCorners) => { x: number; y: number }[];
};

type Props = {
  hud: BinderPageHud;
  overlays: BinderOverlayCard[];
  layout: OverlayLayout | null;
  snapshotInFlight: boolean;
  message: string;
  pageIndex: number;
  onNextPage: () => void;
  onFinishPage: () => void;
  onTapTrack: (binderTrackId: number) => void;
  inspectTrack: BinderTrack | null;
  onCloseInspect: () => void;
  candidateSource: string;
  showDebug?: boolean;
  /** Dev diagnostics */
  showUpload?: boolean;
  uploadBusy?: boolean;
  uploadIncomplete?: boolean;
  uploadMessage?: string | null;
  autoUploadOnPageDone?: boolean;
  onUploadDiagnostics?: () => void;
  onRetryUpload?: () => void;
  onToggleAutoUpload?: () => void;
};

const polyPoints = (pts: { x: number; y: number }[]): string =>
  pts.map(p => `${p.x},${p.y}`).join(' ');

export function BinderHud({
  hud,
  overlays,
  layout,
  snapshotInFlight,
  message,
  pageIndex,
  onNextPage,
  onFinishPage,
  onTapTrack,
  inspectTrack,
  onCloseInspect,
  candidateSource,
  showDebug = false,
  showUpload = false,
  uploadBusy = false,
  uploadIncomplete = false,
  uploadMessage = null,
  autoUploadOnPageDone = false,
  onUploadDiagnostics,
  onRetryUpload,
  onToggleAutoUpload,
}: Props) {
  const inspectUri = useMemo(() => {
    if (!inspectTrack?.best?.warp) return null;
    try {
      return scanImageToPngDataUri(inspectTrack.best.warp, 360);
    } catch {
      return null;
    }
  }, [inspectTrack]);

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {layout
        ? overlays.map(o => {
            const pts = layout.mapQuad(o.quad);
            if (pts.length < 4) return null;
            const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
            const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
            const acquired = o.acquired;
            return (
              <Pressable
                key={o.binderTrackId}
                onPress={() => onTapTrack(o.binderTrackId)}
                style={[
                  styles.polyHit,
                  {
                    left: Math.min(...pts.map(p => p.x)) - 4,
                    top: Math.min(...pts.map(p => p.y)) - 4,
                    width: Math.max(...pts.map(p => p.x)) - Math.min(...pts.map(p => p.x)) + 8,
                    height: Math.max(...pts.map(p => p.y)) - Math.min(...pts.map(p => p.y)) + 8,
                  },
                ]}
              >
                <View
                  style={[
                    styles.polyBox,
                    {
                      borderColor: acquired ? '#3DDC84' : '#F5C542',
                      backgroundColor: acquired ? 'rgba(61,220,132,0.28)' : 'rgba(245,197,66,0.08)',
                    },
                  ]}
                >
                  {acquired ? <Text style={styles.check}>✓</Text> : null}
                </View>
                {/* keep centers for accessibility; polyPoints unused without SVG */}
                {showDebug ? (
                  <Text style={[styles.debugId, { left: cx, top: cy }]}>{o.binderTrackId}</Text>
                ) : null}
              </Pressable>
            );
          })
        : null}

      <View style={styles.hudTop} pointerEvents="box-none">
        <Text style={styles.title}>BINDER</Text>
        <Text style={styles.progress}>
          {hud.acquiredCount} / {Math.max(hud.trackedCount, hud.acquiredCount)} ready
        </Text>
        <Text style={styles.hint}>{hud.hint}</Text>
        {snapshotInFlight ? <Text style={styles.meta}>Capturing page…</Text> : null}
        {message ? <Text style={styles.meta}>{message}</Text> : null}
        {showDebug ? (
          <Text style={styles.meta}>
            page {pageIndex + 1} · src {candidateSource} · tracks {overlays.length}
          </Text>
        ) : null}
      </View>

      <View style={styles.hudBottom} pointerEvents="box-none">
        <Pressable onPress={onFinishPage} style={styles.btnGhost}>
          <Text style={styles.btnGhostLabel}>Page Done</Text>
        </Pressable>
        <Pressable onPress={onNextPage} style={styles.btn}>
          <Text style={styles.btnLabel}>Next Page</Text>
        </Pressable>
      </View>

      {showUpload ? (
        <View style={styles.uploadRow} pointerEvents="box-none">
          <Pressable
            disabled={uploadBusy || !onUploadDiagnostics}
            hitSlop={10}
            onPress={() => onUploadDiagnostics?.()}
            style={[styles.btnGhost, styles.uploadBtn, (uploadBusy || !onUploadDiagnostics) && styles.btnOff]}
          >
            <Text style={styles.btnGhostLabel}>
              {uploadBusy ? 'Uploading…' : 'Upload Binder Diagnostics'}
            </Text>
          </Pressable>
          {uploadIncomplete ? (
            <Pressable
              disabled={uploadBusy || !onRetryUpload}
              hitSlop={10}
              onPress={() => onRetryUpload?.()}
              style={[styles.btnGhost, styles.uploadBtn, (uploadBusy || !onRetryUpload) && styles.btnOff]}
            >
              <Text style={styles.btnGhostLabel}>Retry Missing</Text>
            </Pressable>
          ) : null}
          <Pressable
            hitSlop={10}
            onPress={() => onToggleAutoUpload?.()}
            style={[styles.btnGhost, styles.uploadBtn]}
          >
            <Text style={styles.btnGhostLabel}>
              Auto-upload {autoUploadOnPageDone ? 'ON' : 'OFF'}
            </Text>
          </Pressable>
          {uploadMessage ? <Text style={styles.uploadMsg}>{uploadMessage}</Text> : null}
          <Text style={styles.uploadHint}>Or use Settings → Pending uploads</Text>
        </View>
      ) : null}

      <Modal visible={Boolean(inspectTrack)} transparent animationType="fade" onRequestClose={onCloseInspect}>
        <Pressable style={styles.modalBg} onPress={onCloseInspect}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              CARD {inspectTrack?.binderTrackId ?? '?'}
              {inspectTrack?.acquired ? ' · ready for ID' : ''}
            </Text>
            {inspectTrack?.best ? (
              <Text style={styles.modalMeta}>
                Quality {inspectTrack.best.quality.score.toFixed(2)} · Sharpness{' '}
                {Math.round(inspectTrack.best.sharpness)} · Glare{' '}
                {inspectTrack.best.quality.components.glare.toFixed(2)} · src frame{' '}
                {inspectTrack.best.sourceFrameId}
              </Text>
            ) : (
              <Text style={styles.modalMeta}>No capture yet</Text>
            )}
            {inspectUri ? (
              <Image source={{ uri: inspectUri }} style={styles.modalImage} resizeMode="contain" />
            ) : null}
            {showUpload && onUploadDiagnostics ? (
              <Pressable
                disabled={uploadBusy}
                onPress={onUploadDiagnostics}
                style={[styles.btn, uploadBusy && styles.btnOff]}
              >
                <Text style={styles.btnLabel}>
                  {uploadBusy ? 'Uploading…' : 'Upload this page'}
                </Text>
              </Pressable>
            ) : null}
            <Pressable onPress={onCloseInspect} style={styles.btnGhost}>
              <Text style={styles.btnGhostLabel}>Close</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

// silence unused helper in non-SVG path
void polyPoints;

const styles = StyleSheet.create({
  polyHit: { position: 'absolute' },
  polyBox: {
    flex: 1,
    borderWidth: 2,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: { color: '#E8FFF2', fontSize: 28, fontWeight: '800' },
  debugId: {
    position: 'absolute',
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  hudTop: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    gap: 2,
  },
  title: { color: '#F4F7FB', fontSize: 16, fontWeight: '800', letterSpacing: 1 },
  progress: { color: '#C5D0E0', fontSize: 18, fontWeight: '700' },
  hint: { color: '#F5C542', fontSize: 13, fontWeight: '700', marginTop: 4 },
  meta: { color: '#8A97AD', fontSize: 11 },
  hudBottom: {
    position: 'absolute',
    bottom: 24,
    left: 12,
    right: 12,
    flexDirection: 'row',
    gap: 10,
  },
  btn: {
    flex: 1,
    backgroundColor: '#3D7EFF',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnLabel: { color: '#fff', fontWeight: '700', fontSize: 15 },
  btnGhost: {
    flex: 1,
    borderColor: '#2A3548',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnGhostLabel: { color: '#C5D0E0', fontWeight: '600', fontSize: 15 },
  btnOff: { opacity: 0.45 },
  uploadRow: {
    position: 'absolute',
    bottom: 88,
    left: 12,
    right: 12,
    gap: 6,
    zIndex: 80,
    elevation: 80,
  },
  uploadBtn: { paddingVertical: 8 },
  uploadMsg: { color: '#9AA8BD', fontSize: 11 },
  uploadHint: { color: '#6E7B91', fontSize: 10 },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#0B1220',
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  modalTitle: { color: '#F4F7FB', fontSize: 18, fontWeight: '700' },
  modalMeta: { color: '#9AA8BD', fontSize: 13 },
  modalImage: { alignSelf: 'center', width: 220, height: 308, borderRadius: 8 },
});
