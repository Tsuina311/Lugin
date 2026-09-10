import type { PreparedDebugBundle } from '../saveDebugBundle';
import { enqueueInboxUpload, type InboxFileRef } from './queue';
import { sanitizeId } from './protocol';

export const enqueuePreparedReport = async (args: {
  appStamp?: string | null;
  bundle: PreparedDebugBundle;
  device?: string | null;
  runtimeFingerprint?: string | null;
  scannerPhase?: string | null;
  sessionId?: string | null;
}) => {
  const files: InboxFileRef[] = [];
  if (args.bundle.jsonUri) {
    files.push({ kind: 'text', name: 'report.json', uri: args.bundle.jsonUri });
  }
  if (args.bundle.reportUri) {
    files.push({ kind: 'text', name: 'report.txt', uri: args.bundle.reportUri });
  }
  if (args.bundle.pngUri) {
    files.push({ kind: 'base64', name: 'recognition.png', uri: args.bundle.pngUri });
  }
  if (args.bundle.detectorPngUri) {
    files.push({ kind: 'base64', name: 'detector.png', uri: args.bundle.detectorPngUri });
  }
  const slug = sanitizeId(`rep-${args.bundle.slug.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 60)}`);
  return enqueueInboxUpload({
    appStamp: args.appStamp,
    device: args.device,
    files,
    runtimeFingerprint: args.runtimeFingerprint,
    scannerPhase: args.scannerPhase,
    sessionId: args.sessionId,
    traceId: slug,
    traceType: 'recognition',
  });
};
