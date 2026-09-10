import { enqueueInboxUpload, type InboxFileRef } from './queue';
import { ALLOWED_FILES } from './protocol';

export const enqueueSwapTest = async (args: {
  appStamp?: string | null;
  device?: string | null;
  dirUri: string;
  files: string[];
  fixtureId: string;
  runtimeFingerprint?: string | null;
}) => {
  const root = args.dirUri.endsWith('/') ? args.dirUri : `${args.dirUri}/`;
  const files: InboxFileRef[] = args.files
    .filter(name => name in ALLOWED_FILES)
    .map(name => ({
      kind: name.endsWith('.png') ? 'base64' : 'text',
      name,
      uri: `${root}${name}`,
    }));
  return enqueueInboxUpload({
    appStamp: args.appStamp,
    device: args.device,
    files,
    runtimeFingerprint: args.runtimeFingerprint,
    scannerPhase: 'swap-test',
    traceId: args.fixtureId.slice(0, 80),
    traceType: 'swap-test',
  });
};
