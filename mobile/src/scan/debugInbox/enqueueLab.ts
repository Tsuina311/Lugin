import { enqueueInboxUpload, type InboxFileRef } from './queue';
import { ALLOWED_FILES } from './protocol';

const LAB_FILES = [
  'fixture.json',
  'recognition-quad.json',
  'lab-compare.json',
  'lab-live-orch.json',
  'source-highres.png',
  'detector-input.png',
  'baseline-warp.png',
  'current-warp.png',
  'title-crop-baseline.png',
  'title-crop-current.png',
] as const;

export const enqueueLabFixture = async (args: {
  appStamp?: string | null;
  device?: string | null;
  dirUri: string;
  fixtureId: string;
  runtimeFingerprint?: string | null;
}) => {
  const root = args.dirUri.endsWith('/') ? args.dirUri : `${args.dirUri}/`;
  const files: InboxFileRef[] = LAB_FILES.filter(name => name in ALLOWED_FILES).map(name => ({
    kind: name.endsWith('.png') ? 'base64' : 'text',
    name,
    uri: `${root}${name}`,
  }));
  return enqueueInboxUpload({
    appStamp: args.appStamp,
    device: args.device,
    files,
    runtimeFingerprint: args.runtimeFingerprint,
    scannerPhase: 'scanner-lab',
    traceId: args.fixtureId.slice(0, 80),
    traceType: 'lab',
  });
};
