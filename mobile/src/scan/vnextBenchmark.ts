import type { VNextDebugSnapshot } from '@/lib/scan/vnext/debug';
import { normalizeExactTitle } from '@/lib/scan/matchName';

import {
  getActiveBenchmarkSession,
  isBenchmarkToolsEnabled,
} from './benchmark';

type LegacyFS = typeof import('expo-file-system/legacy');

export type VNextBenchmarkDecision = {
  slot: number;
  expected: { name: string; setCode: string; collectorNumber: string } | null;
  detectorMs: number;
  warpPreprocessMs: number;
  clipMs: number | null;
  gallerySearchMs: number | null;
  ocrMs: number | null;
  totalDecisionMs: number;
  visualTop1: { oracleId: string; name: string; score: number } | null;
  prototypeMargin: number | null;
  ocrRecoveryOracle: string | null;
  finalResult: { oracleId: string; name: string } | null;
  decisionReason: VNextDebugSnapshot['source'];
  outcome: 'correct' | 'wrong' | 'withheld' | 'unscored';
  recordedAt: string;
};

const fs = async (): Promise<LegacyFS> => import('expo-file-system/legacy');
let writes: Promise<void> = Promise.resolve();

const appendDecision = async (snapshot: VNextDebugSnapshot): Promise<void> => {
  if (!isBenchmarkToolsEnabled()) return;
  const session = getActiveBenchmarkSession();
  if (!session || session.endedAt) return;
  const FileSystem = await fs();
  const root = FileSystem.documentDirectory;
  if (!root) return;
  const dir = `${root}lugin-vnext-benchmark/${session.sessionId}/`;
  const uri = `${dir}decisions.json`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  let rows: VNextBenchmarkDecision[] = [];
  try {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) rows = JSON.parse(await FileSystem.readAsStringAsync(uri));
  } catch {
    rows = [];
  }
  const slot = rows.length + 1;
  const expected = session.expectedManifest?.[slot - 1] ?? null;
  const published = snapshot.prototypeTop5.find(
    hit => hit.oracleId === snapshot.finalPublishedOracle,
  ) ?? null;
  const outcome = !published
    ? 'withheld'
    : !expected
      ? 'unscored'
      : normalizeExactTitle(published.name) === normalizeExactTitle(expected.name)
        ? 'correct'
        : 'wrong';
  const timing = snapshot.timing;
  rows.push({
    slot,
    expected: expected
      ? {
          name: expected.name,
          setCode: expected.setCode,
          collectorNumber: expected.collectorNumber,
        }
      : null,
    detectorMs: timing?.candidateGenerationMs ?? 0,
    warpPreprocessMs:
      (timing?.warpMs ?? 0) +
      (timing?.artMs ?? 0) +
      (timing?.preprocessMs ?? 0),
    clipMs: timing?.clipMs ?? null,
    gallerySearchMs: timing?.searchMs ?? null,
    ocrMs: timing?.ocrMs ?? null,
    totalDecisionMs: timing?.totalMs ?? 0,
    visualTop1: snapshot.prototypeTop1,
    prototypeMargin: snapshot.prototypeMargin,
    ocrRecoveryOracle: snapshot.recoveredOracle,
    finalResult: published
      ? { oracleId: published.oracleId, name: published.name }
      : null,
    decisionReason: snapshot.source,
    outcome,
    recordedAt: new Date().toISOString(),
  });
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(rows, null, 2));
};

/** Fire-and-forget persistence; scanner decisions never wait on filesystem I/O. */
export const recordVNextBenchmarkDecision = (snapshot: VNextDebugSnapshot): void => {
  writes = writes.then(() => appendDecision(snapshot)).catch(() => undefined);
};
