// Deck Benchmark local persistence (dev / benchmarkTools only).

import type { DeckBenchmarkBundle, DeckBenchmarkCardRecord } from '@/lib/scan/deckBenchmark';
import { deckCardFileStem } from '@/lib/scan/deckBenchmark';
import type { ScanImage } from '../sharedCore';
import { bytesToBase64, scanImageToPngBytes } from '../debug/scanImagePng';
import { isBenchmarkToolsEnabled } from '../benchmark/isBenchmarkEnabled';

type LegacyFS = typeof import('expo-file-system/legacy');

const ROOT = 'lugin-deck-benchmark/';
const ACTIVE = 'active-run.json';

const fs = async (): Promise<LegacyFS> => import('expo-file-system/legacy');

export const deckBenchmarkRoot = async (): Promise<string> => {
  const FileSystem = await fs();
  const root = FileSystem.documentDirectory;
  if (!root) throw new Error('documentDirectory unavailable');
  const dir = `${root}${ROOT}`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
};

export const deckRunDir = async (fixtureId: string): Promise<string> => {
  const FileSystem = await fs();
  const dir = `${await deckBenchmarkRoot()}${fixtureId}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
};

const writeJson = async (uri: string, value: unknown) => {
  const FileSystem = await fs();
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(value, null, 2));
};

export const persistDeckActiveMeta = async (fixtureId: string | null) => {
  if (!isBenchmarkToolsEnabled()) return;
  const FileSystem = await fs();
  const uri = `${await deckBenchmarkRoot()}${ACTIVE}`;
  if (!fixtureId) {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) await FileSystem.deleteAsync(uri, { idempotent: true });
    return;
  }
  await writeJson(uri, { fixtureId });
};

export const loadDeckActiveMeta = async (): Promise<{ fixtureId: string } | null> => {
  if (!isBenchmarkToolsEnabled()) return null;
  try {
    const FileSystem = await fs();
    const uri = `${await deckBenchmarkRoot()}${ACTIVE}`;
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    return JSON.parse(await FileSystem.readAsStringAsync(uri)) as { fixtureId: string };
  } catch {
    return null;
  }
};

export const saveDeckBundle = async (bundle: DeckBenchmarkBundle): Promise<string> => {
  const dir = await deckRunDir(bundle.fixtureId);
  await writeJson(`${dir}summary.json`, bundle);
  return dir;
};

export const loadDeckBundle = async (fixtureId: string): Promise<DeckBenchmarkBundle | null> => {
  try {
    const FileSystem = await fs();
    const uri = `${await deckRunDir(fixtureId)}summary.json`;
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    return JSON.parse(await FileSystem.readAsStringAsync(uri)) as DeckBenchmarkBundle;
  } catch {
    return null;
  }
};

export const listDeckRuns = async (): Promise<
  Array<{ fixtureId: string; cards: number; target: number; phase: string }>
> => {
  if (!isBenchmarkToolsEnabled()) return [];
  const FileSystem = await fs();
  const root = await deckBenchmarkRoot();
  const entries = await FileSystem.readDirectoryAsync(root);
  const out: Array<{ fixtureId: string; cards: number; target: number; phase: string }> = [];
  for (const name of entries) {
    if (name === ACTIVE || name.endsWith('.json')) continue;
    const bundle = await loadDeckBundle(name);
    if (!bundle) continue;
    out.push({
      fixtureId: bundle.fixtureId,
      cards: bundle.cards.length,
      target: bundle.targetCount,
      phase: bundle.phase,
    });
  }
  return out.sort((a, b) => b.fixtureId.localeCompare(a.fixtureId));
};

export const saveDeckCardArtifacts = async (args: {
  fixtureId: string;
  record: DeckBenchmarkCardRecord;
  source?: ScanImage | null;
  cardWarp?: ScanImage | null;
  title?: ScanImage | null;
  art?: ScanImage | null;
  footer?: ScanImage | null;
  detector?: ScanImage | null;
}): Promise<DeckBenchmarkCardRecord> => {
  const FileSystem = await fs();
  const dir = await deckRunDir(args.fixtureId);
  const stem = deckCardFileStem(args.record.benchmarkIndex);
  const files = { ...args.record.files, metadata: `${stem}-metadata.json` };

  const writePng = async (name: string, img: ScanImage) => {
    const png = scanImageToPngBytes(img, img.width);
    await FileSystem.writeAsStringAsync(`${dir}${name}`, bytesToBase64(png), {
      encoding: FileSystem.EncodingType.Base64,
    });
    return name;
  };

  if (args.source) files.source = await writePng(`${stem}-source.png`, args.source);
  if (args.cardWarp) files.cardWarp = await writePng(`${stem}-card.png`, args.cardWarp);
  if (args.title) files.title = await writePng(`${stem}-title.png`, args.title);
  if (args.art) files.art = await writePng(`${stem}-art.png`, args.art);
  if (args.footer) files.footer = await writePng(`${stem}-footer.png`, args.footer);
  if (args.detector) files.detector = await writePng(`${stem}-detector.png`, args.detector);

  const record: DeckBenchmarkCardRecord = { ...args.record, files };
  await writeJson(`${dir}${files.metadata}`, record);
  return record;
};

export const deleteDeckRunLocal = async (fixtureId: string): Promise<void> => {
  const FileSystem = await fs();
  const dir = await deckRunDir(fixtureId);
  await FileSystem.deleteAsync(dir, { idempotent: true });
  const meta = await loadDeckActiveMeta();
  if (meta?.fixtureId === fixtureId) await persistDeckActiveMeta(null);
};
