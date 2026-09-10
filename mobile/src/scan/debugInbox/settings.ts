import { isBenchmarkToolsEnabled } from '../benchmark/isBenchmarkEnabled';
import { applyReceiverInput, normalizeReceiverUrl } from './protocol';

export type InboxSettings = {
  replayWorker: boolean;
  token: string;
  url: string;
};

const FILE = 'lugin-debug-inbox/settings.json';

let cached: InboxSettings = { replayWorker: false, token: '', url: '' };
let loaded = false;

const fs = async () => import('expo-file-system/legacy');

const settingsUri = async (): Promise<string | null> => {
  const FileSystem = await fs();
  const root = FileSystem.documentDirectory;
  if (!root) return null;
  const dir = `${root}lugin-debug-inbox/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return `${root}${FILE}`;
};

export const getInboxSettings = (): InboxSettings => cached;

export const isInboxConfigured = (): boolean =>
  Boolean(cached.url && cached.token && isBenchmarkToolsEnabled());

export const loadInboxSettings = async (): Promise<InboxSettings> => {
  if (!isBenchmarkToolsEnabled()) {
    cached = { replayWorker: false, token: '', url: '' };
    loaded = true;
    return cached;
  }
  if (loaded) return cached;
  try {
    const FileSystem = await fs();
    const uri = await settingsUri();
    if (!uri) return cached;
    const raw = await FileSystem.readAsStringAsync(uri);
    const parsed = JSON.parse(raw) as Partial<InboxSettings>;
    cached = {
      replayWorker: parsed.replayWorker === true,
      token: typeof parsed.token === 'string' ? parsed.token : '',
      url: typeof parsed.url === 'string' ? parsed.url : '',
    };
  } catch {
    cached = { replayWorker: false, token: '', url: '' };
  }
  loaded = true;
  return cached;
};

export const saveInboxSettings = async (
  next: Partial<InboxSettings> & Pick<InboxSettings, 'token' | 'url'>,
): Promise<InboxSettings> => {
  const url = normalizeReceiverUrl(next.url) ?? next.url.trim();
  cached = {
    replayWorker: next.replayWorker === undefined ? cached.replayWorker : next.replayWorker === true,
    token: next.token.trim(),
    url,
  };
  loaded = true;
  if (!isBenchmarkToolsEnabled()) return cached;
  const FileSystem = await fs();
  const uri = await settingsUri();
  if (!uri) return cached;
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(cached));
  return cached;
};

/** Paste a pairing URL or a bare receiver URL. Token is never logged. */
export const applyInboxPairInput = async (raw: string): Promise<InboxSettings> => {
  const parsed = applyReceiverInput(raw);
  const next: InboxSettings = {
    replayWorker: cached.replayWorker,
    token: parsed.token ?? cached.token,
    url: parsed.url ?? cached.url,
  };
  return saveInboxSettings(next);
};
