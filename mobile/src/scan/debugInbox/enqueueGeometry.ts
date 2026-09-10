import { enqueueInboxUpload, type InboxFileRef } from './queue';
import { ALLOWED_FILES } from './protocol';

const GEOMETRY_FILES = [
  'geometry-trace.json',
  'detector-first.png',
  'detector-middle.png',
  'detector-last.png',
] as const;

export const enqueueGeometryTrace = async (args: {
  appStamp?: string | null;
  device?: string | null;
  dirUri: string;
  runtimeFingerprint?: string | null;
  scannerPhase?: string | null;
  sessionId?: string | null;
  traceId?: string | null;
}) => {
  const root = args.dirUri.endsWith('/') ? args.dirUri : `${args.dirUri}/`;
  const files: InboxFileRef[] = GEOMETRY_FILES.filter(name => name in ALLOWED_FILES).map(name => ({
    kind: name.endsWith('.png') ? 'base64' : 'text',
    name,
    uri: `${root}${name}`,
  }));
  return enqueueInboxUpload({
    appStamp: args.appStamp,
    device: args.device,
    files,
    runtimeFingerprint: args.runtimeFingerprint,
    scannerPhase: args.scannerPhase,
    sessionId: args.sessionId,
    traceId: args.traceId,
    traceType: 'geometry',
  });
};
