import { enqueueInboxUpload, type InboxFileRef } from './queue';
import { makeTraceId, sanitizeId } from './protocol';

export const enqueueBenchmarkInboxScan = async (args: {
  appStamp?: string | null;
  device?: string | null;
  pngUri?: string | null;
  reportUri: string;
  runtimeFingerprint?: string | null;
  scannerPhase?: string | null;
  seq: number;
  sessionId: string;
}) => {
  const files: InboxFileRef[] = [{ kind: 'text', name: 'report.json', uri: args.reportUri }];
  if (args.pngUri) {
    files.push({ kind: 'base64', name: 'recognition.png', uri: args.pngUri });
  }
  const sessionId = sanitizeId(args.sessionId, `bench-${String(args.seq).padStart(4, '0')}`);
  return enqueueInboxUpload({
    appStamp: args.appStamp,
    device: args.device,
    files,
    runtimeFingerprint: args.runtimeFingerprint,
    scannerPhase: args.scannerPhase ?? 'found',
    sessionId,
    traceId: makeTraceId(args.seq),
    traceType: 'benchmark',
  });
};
