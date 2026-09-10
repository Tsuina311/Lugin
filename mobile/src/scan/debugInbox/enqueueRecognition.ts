import { enqueueInboxUpload, type InboxFileRef } from './queue';
import { ALLOWED_FILES } from './protocol';

const RECOGNITION_FILES = [
  'post-lock.json',
  'ocr-debug.json',
  'recognition-card.png',
  'title-crop-raw.png',
  'title-crop-ocr.png',
] as const;

/** One completed recognition-attempt directory. Not live frames. */
export const enqueueRecognitionDebug = async (args: {
  appStamp?: string | null;
  device?: string | null;
  dirUri: string;
  runtimeFingerprint?: string | null;
  scannerPhase?: string | null;
  sessionId?: string | null;
  traceId?: string | null;
}) => {
  const root = args.dirUri.endsWith('/') ? args.dirUri : `${args.dirUri}/`;
  const files: InboxFileRef[] = RECOGNITION_FILES.filter(name => name in ALLOWED_FILES).map(name => ({
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
    traceType: 'ocr-debug',
  });
};
