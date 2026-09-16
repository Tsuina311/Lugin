/**
 * Verified Scan result panel — debug pipeline.
 * Primary actions stay above the fold (buttons were clipping off-screen).
 * Upload is NOT automatic — tap Upload & Next / Skip & Next.
 */

import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { FusedResult, ScanIdentityStatus, SessionSnapshot } from './sharedCore';
import type { VerifiedScanPhase } from '@/lib/scan/verifiedScan';
import {
  formatChannelTimingLine,
  getRecognitionChannel,
  RECOGNITION_CHANNEL_LABELS,
  channelTimingFromRecognize,
} from '@/lib/scan/recognitionChannel';

type Props = {
  inboxPaired?: boolean;
  onRetake: () => void;
  onRetryRecognition: () => void;
  /** Upload diagnostics (finalizes when terminal) and advance. */
  onUploadNext: () => void;
  onWarpLoaded?: () => void;
  snapshot: SessionSnapshot | null;
  uploadStatus?: string | null;
  verifiedPhase: VerifiedScanPhase;
  warpUri: string | null;
};

const statusLine = (
  phase: VerifiedScanPhase,
  fused: FusedResult | undefined,
): string => {
  if (phase === 'captured') return 'CAPTURED';
  if (phase === 'identifying') return 'Identifying…';
  if (phase === 'failed') return "Couldn't identify automatically";
  switch (fused?.status) {
    case 'identified':
      return '✓ Identified';
    case 'printing-ambiguous':
      return 'Printing ambiguous';
    case 'card-ambiguous':
      return 'Card ambiguous';
    case 'insufficient-confidence':
      return "Couldn't identify automatically";
    default:
      return phase === 'result' ? 'Result ready' : 'Identifying…';
  }
};

const printingNeedsCheck = (status: ScanIdentityStatus | undefined): boolean =>
  status === 'printing-ambiguous' || status === 'card-ambiguous' || status === 'insufficient-confidence';

export function VerifiedScanPanel({
  inboxPaired = true,
  onRetake,
  onRetryRecognition,
  onUploadNext,
  onWarpLoaded,
  snapshot,
  uploadStatus = null,
  verifiedPhase,
  warpUri,
}: Props) {
  const fused = snapshot?.fused;
  const printing = fused?.printing ?? null;
  const name = fused?.card?.name ?? printing?.name ?? null;
  const setLine = printing
    ? `${printing.setName ?? printing.setCode.toUpperCase()} · #${printing.collectorNumber}`
    : null;
  const uncertain = printingNeedsCheck(fused?.status) || (!printing && Boolean(name));
  const identifying = verifiedPhase === 'captured' || verifiedPhase === 'identifying';
  const failed = verifiedPhase === 'failed' || fused?.status === 'insufficient-confidence';
  const hasResult = verifiedPhase === 'result' || failed;
  const channel = getRecognitionChannel();
  const channelTiming = snapshot?.recognition?.timings
    ? channelTimingFromRecognize(channel, snapshot.recognition.timings)
    : null;
  // Always allow Skip once a capture exists — never wait for identity.
  const skipEnabled =
    Boolean(warpUri) ||
    verifiedPhase === 'captured' ||
    verifiedPhase === 'identifying' ||
    verifiedPhase === 'result' ||
    failed;

  return (
    <View style={styles.wrap}>
      <Text style={styles.eyebrow}>
        DEBUG · SINGLE SCAN · Rec {RECOGNITION_CHANNEL_LABELS[channel]}
      </Text>

      {/* Actions first — always on screen (was clipping under bottom chips). */}
      <View style={styles.actions}>
        <Pressable
          disabled={!skipEnabled}
          hitSlop={12}
          onPress={onUploadNext}
          style={[hasResult ? styles.btn : styles.btnSecondary, !skipEnabled && styles.btnOff]}
        >
          <Text style={hasResult ? styles.btnLabel : styles.btnSecondaryLabel}>
            {hasResult ? 'Upload & Next' : 'Skip & Next · keep diagnosing'}
          </Text>
        </Pressable>

        <View style={styles.actionRow}>
          {failed ? (
            <Pressable hitSlop={8} onPress={onRetryRecognition} style={styles.btnGhostHalf}>
              <Text style={styles.btnGhostLabel}>Retry</Text>
            </Pressable>
          ) : null}
          <Pressable hitSlop={8} onPress={onRetake} style={styles.btnGhostHalf}>
            <Text style={styles.btnGhostLabel}>Retake</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <View style={styles.heroRow}>
          {warpUri ? (
            <Image
              source={{ uri: warpUri }}
              style={styles.cardImage}
              resizeMode="contain"
              onLoad={() => onWarpLoaded?.()}
            />
          ) : (
            <View style={[styles.cardImage, styles.cardPlaceholder]}>
              <Text style={styles.placeholderLabel}>CARD</Text>
            </View>
          )}
          <View style={styles.heroText}>
            {name ? (
              <Text style={styles.name} numberOfLines={3}>
                {name}
              </Text>
            ) : identifying ? (
              <Text style={styles.namePending}>Identifying…</Text>
            ) : (
              <Text style={styles.namePending}>—</Text>
            )}
            {setLine ? (
              <Text style={[styles.printing, uncertain && styles.printingWarn]} numberOfLines={2}>
                {setLine}
              </Text>
            ) : name && uncertain ? (
              <Text style={styles.printingWarn}>PRINTING UNCERTAIN</Text>
            ) : null}
            <Text style={styles.status}>{statusLine(verifiedPhase, fused)}</Text>
          </View>
        </View>

        {channelTiming ? (
          <Text style={styles.channelTiming}>{formatChannelTimingLine(channelTiming)}</Text>
        ) : (
          <Text style={styles.hint}>
            Channel: {RECOGNITION_CHANNEL_LABELS[channel]} (timing after ID)
          </Text>
        )}
        {!inboxPaired ? (
          <Text style={styles.warn}>Inbox not paired — Settings → Debug receiver</Text>
        ) : (
          <Text style={styles.hint}>
            Not auto-upload — tap Upload/Skip above. Encode finishes in background.
          </Text>
        )}
        {uploadStatus ? <Text style={styles.uploadStatus}>{uploadStatus}</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: 'rgba(8,12,20,0.94)',
    borderRadius: 16,
    padding: 12,
    gap: 8,
    maxHeight: '72%',
  },
  eyebrow: {
    color: '#8A97AD',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
  },
  actions: { gap: 8 },
  actionRow: { flexDirection: 'row', gap: 8 },
  scroll: { flexGrow: 0, maxHeight: 220 },
  scrollContent: { gap: 6, paddingBottom: 4 },
  heroRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  heroText: { flex: 1, gap: 4, minWidth: 0 },
  cardImage: {
    width: 72,
    height: 100,
    borderRadius: 6,
    backgroundColor: '#121A28',
  },
  cardPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  placeholderLabel: { color: '#C5D0E0', fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  name: { color: '#F4F7FB', fontSize: 16, fontWeight: '700' },
  namePending: { color: '#9AA8BD', fontSize: 15, fontWeight: '600' },
  printing: { color: '#C5D0E0', fontSize: 13 },
  printingWarn: { color: '#F5C542', fontSize: 12, fontWeight: '700' },
  status: { color: '#9AA8BD', fontSize: 12, marginTop: 2 },
  channelTiming: { color: '#7CB8FF', fontSize: 11, fontWeight: '600' },
  hint: { color: '#6B7A90', fontSize: 11 },
  warn: { color: '#F5C542', fontSize: 12, fontWeight: '700' },
  uploadStatus: { color: '#7CB8FF', fontSize: 12, fontWeight: '600' },
  btn: {
    backgroundColor: '#3D7EFF',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnSecondary: {
    backgroundColor: '#1A2436',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnSecondaryLabel: { color: '#E8F0FF', fontSize: 15, fontWeight: '700' },
  btnOff: { opacity: 0.4 },
  btnLabel: { color: '#fff', fontSize: 16, fontWeight: '700' },
  btnGhostHalf: {
    flex: 1,
    borderColor: '#2A3548',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  btnGhostLabel: { color: '#C5D0E0', fontSize: 13, fontWeight: '600' },
});
