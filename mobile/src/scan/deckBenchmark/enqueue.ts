import { enqueueInboxUpload, type InboxFileRef } from '../debugInbox/queue';
import { ALLOWED_FILES } from '../debugInbox/protocol';
import type { DeckBenchmarkBundle } from '@/lib/scan/deckBenchmark';

/** Upload summary + card artifacts in chunks under one session id. */
export const enqueueDeckBenchmark = async (args: {
  appStamp?: string | null;
  device?: string | null;
  dirUri: string;
  bundle: DeckBenchmarkBundle;
  runtimeFingerprint?: string | null;
}) => {
  const root = args.dirUri.endsWith('/') ? args.dirUri : `${args.dirUri}/`;
  const sessionId = args.bundle.fixtureId.slice(0, 80);

  const enqueueNames = async (traceId: string, names: string[]) => {
    const files: InboxFileRef[] = names
      .filter(name => name in ALLOWED_FILES)
      .map(name => ({
        kind: name.endsWith('.png') || name.endsWith('.jpg') ? 'base64' : 'text',
        name,
        uri: `${root}${name}`,
      }));
    if (!files.length) return { queued: false, reason: 'no-files' as const };
    return enqueueInboxUpload({
      appStamp: args.appStamp,
      device: args.device,
      files,
      runtimeFingerprint: args.runtimeFingerprint,
      scannerPhase: 'deck-benchmark',
      sessionId,
      traceId: traceId.slice(0, 80),
      traceType: 'deck-benchmark',
    });
  };

  const summary = await enqueueNames(args.bundle.fixtureId, ['summary.json']);
  const chunkSize = 8;
  for (let i = 0; i < args.bundle.cards.length; i += chunkSize) {
    const slice = args.bundle.cards.slice(i, i + chunkSize);
    const names: string[] = [];
    for (const c of slice) {
      for (const v of Object.values(c.files)) {
        if (typeof v === 'string') names.push(v);
      }
    }
    await enqueueNames(`${args.bundle.fixtureId}-c${String(i).padStart(3, '0')}`, names);
  }
  return summary;
};
