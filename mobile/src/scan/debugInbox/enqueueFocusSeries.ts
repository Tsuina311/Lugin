import { enqueueInboxUpload, type InboxFileRef } from './queue';
import { ALLOWED_FILES } from './protocol';
import { FOCUS_SERIES_FILES } from '../focusSeries/persist';

export const enqueueFocusSeries = async (args: {
  appStamp?: string | null;
  device?: string | null;
  dirUri: string;
  fixtureId: string;
  runtimeFingerprint?: string | null;
}) => {
  const root = args.dirUri.endsWith('/') ? args.dirUri : `${args.dirUri}/`;
  const files: InboxFileRef[] = FOCUS_SERIES_FILES.filter(name => name in ALLOWED_FILES).map(name => ({
    kind: name.endsWith('.png') ? 'base64' : 'text',
    name,
    uri: `${root}${name}`,
  }));
  return enqueueInboxUpload({
    appStamp: args.appStamp,
    device: args.device,
    files,
    runtimeFingerprint: args.runtimeFingerprint,
    scannerPhase: 'focus-series',
    traceId: args.fixtureId.slice(0, 80),
    traceType: 'focus-series',
  });
};
