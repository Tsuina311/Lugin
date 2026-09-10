import { enqueueInboxUpload, type InboxFileRef } from '../debugInbox/queue';
import { ALLOWED_FILES } from '../debugInbox/protocol';
import type { BinderBenchmarkBundle } from '@/lib/scan/binderBenchmark';

export const enqueueBinderBenchmark = async (args: {
  appStamp?: string | null;
  device?: string | null;
  dirUri: string;
  bundle: BinderBenchmarkBundle;
  runtimeFingerprint?: string | null;
}) => {
  const root = args.dirUri.endsWith('/') ? args.dirUri : `${args.dirUri}/`;
  const sessionId = args.bundle.fixtureId.slice(0, 80);

  const allNames = new Set<string>(['summary.json']);
  for (const page of args.bundle.pages) {
    allNames.add(`p${String(page.pageIndex).padStart(2, '0')}-metadata.json`);
    for (const fr of page.frames) allNames.add(fr.file);
  }

  const names = [...allNames].filter(n => n in ALLOWED_FILES);
  // Chunk to stay under inbox bundle size
  const chunkSize = 24;
  let first: Awaited<ReturnType<typeof enqueueInboxUpload>> | null = null;
  for (let i = 0; i < names.length; i += chunkSize) {
    const slice = names.slice(i, i + chunkSize);
    const files: InboxFileRef[] = slice.map(name => ({
      kind: name.endsWith('.jpg') || name.endsWith('.png') ? 'base64' : 'text',
      name,
      uri: `${root}${name}`,
    }));
    const res = await enqueueInboxUpload({
      appStamp: args.appStamp,
      device: args.device,
      files,
      runtimeFingerprint: args.runtimeFingerprint,
      scannerPhase: 'binder-benchmark',
      sessionId,
      traceId: `${args.bundle.fixtureId}-${i}`.slice(0, 80),
      traceType: 'binder-benchmark',
    });
    if (!first) first = res;
  }
  return first ?? { queued: false, reason: 'no-files' as const };
};
