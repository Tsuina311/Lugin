import { enqueueInboxUpload, type InboxFileRef } from './queue';
import { ALLOWED_FILES } from './protocol';
import { QUALITY_FILES } from '../captureQuality/persist';

export const enqueueCaptureQuality = async (args: {
  appStamp?: string | null;
  device?: string | null;
  dirUri: string;
  fixtureId: string;
  runtimeFingerprint?: string | null;
}) => {
  const root = args.dirUri.endsWith('/') ? args.dirUri : `${args.dirUri}/`;
  const files: InboxFileRef[] = QUALITY_FILES.filter(name => name in ALLOWED_FILES).map(name => ({
    kind: name.endsWith('.png') ? 'base64' : 'text',
    name,
    uri: `${root}${name}`,
  }));
  return enqueueInboxUpload({
    appStamp: args.appStamp,
    device: args.device,
    files,
    runtimeFingerprint: args.runtimeFingerprint,
    scannerPhase: 'capture-quality',
    traceId: args.fixtureId.slice(0, 80),
    traceType: 'capture-quality',
  });
};
