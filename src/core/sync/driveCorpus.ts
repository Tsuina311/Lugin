// Visible Google Drive storage for scanner development samples.
//
// Layout (user-visible My Drive):
//   Lugin / Scanner Corpus / contributor-<id> / YYYY-MM / <sampleId> /
//     image.jpg
//     metadata.json
//
// Reuses TokenProvider + the same OAuth client as collection sync. Does not
// touch appDataFolder or embed Google identity into sample metadata.

import type { TokenProvider } from './auth';
import { DriveError } from './drive';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const ROOT = 'Lugin';
const CORPUS = 'Scanner Corpus';

export interface DriveCorpusOptions {
  http?: typeof fetch;
  token: TokenProvider;
}

export interface CorpusUploadInput {
  contributorId: string;
  createdAt: string;
  image: ArrayBuffer | null;
  meta: unknown;
  mimeType: 'image/jpeg' | 'image/webp' | null;
  sampleId: string;
}

export interface CorpusUploadResult {
  alreadyExisted: boolean;
  folderId: string;
  sampleId: string;
}

export interface DriveCorpusRepository {
  /** Ensure Lugin/Scanner Corpus exists; return a Drive UI link when possible. */
  ensureCorpusRootLink(): Promise<string | null>;
  /** Upload one sample folder idempotently (skip if sampleId folder exists). */
  uploadSample(input: CorpusUploadInput): Promise<CorpusUploadResult>;
}

interface FileRef {
  id: string;
  name?: string;
  webViewLink?: string;
}

const escapeQuery = (value: string): string => value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'');

const monthFolder = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

const imageFileName = (mime: 'image/jpeg' | 'image/webp'): string =>
  mime === 'image/webp' ? 'image.webp' : 'image.jpg';

export const createDriveCorpusRepository = ({
  http = fetch,
  token,
}: DriveCorpusOptions): DriveCorpusRepository => {
  const folderCache = new Map<string, string>();

  const call = async (url: string, init: RequestInit = {}, retry = true): Promise<Response> => {
    const access = await token.getToken({ refresh: !retry });
    const response = await http(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${access}` },
    });
    if (response.status === 401 && retry) return call(url, init, false);
    return response;
  };

  const failed = async (response: Response, what: string): Promise<never> => {
    const body = await response.text().catch(() => '');
    throw new DriveError(response.status, `${what} failed (${response.status}) ${body}`.trim());
  };

  const findChild = async (parentId: string, name: string): Promise<FileRef | null> => {
    const q = [
      `name = '${escapeQuery(name)}'`,
      `'${parentId}' in parents`,
      'trashed = false',
    ].join(' and ');
    const query = new URLSearchParams({
      fields: 'files(id,name,webViewLink)',
      pageSize: '1',
      q,
      spaces: 'drive',
    });
    const response = await call(`${FILES}?${query}`);
    if (!response.ok) await failed(response, 'Looking up Drive folder');
    const body = (await response.json()) as { files?: FileRef[] };
    return body.files?.[0] ?? null;
  };

  const createFolder = async (parentId: string, name: string): Promise<FileRef> => {
    const response = await call(`${FILES}?fields=id,name,webViewLink`, {
      body: JSON.stringify({
        mimeType: FOLDER_MIME,
        name,
        parents: [parentId],
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!response.ok) await failed(response, 'Creating Drive folder');
    return (await response.json()) as FileRef;
  };

  const ensureChild = async (parentId: string, name: string): Promise<string> => {
    const cacheKey = `${parentId}/${name}`;
    const cached = folderCache.get(cacheKey);
    if (cached) return cached;
    const existing = await findChild(parentId, name);
    if (existing) {
      folderCache.set(cacheKey, existing.id);
      return existing.id;
    }
    const created = await createFolder(parentId, name);
    folderCache.set(cacheKey, created.id);
    return created.id;
  };

  const ensureCorpusRoot = async (): Promise<{ id: string; link: string | null }> => {
    const luginId = await ensureChild('root', ROOT);
    const corpusId = await ensureChild(luginId, CORPUS);
    const linkCacheKey = `link:${corpusId}`;
    const cachedLink = folderCache.get(linkCacheKey);
    if (cachedLink) return { id: corpusId, link: cachedLink };
    const response = await call(`${FILES}/${corpusId}?fields=id,webViewLink`);
    if (!response.ok) await failed(response, 'Reading Scanner Corpus folder');
    const info = (await response.json()) as FileRef;
    if (info.webViewLink) folderCache.set(linkCacheKey, info.webViewLink);
    return { id: corpusId, link: info.webViewLink ?? null };
  };

  const uploadBytes = async (
    parentId: string,
    name: string,
    contentType: string,
    bytes: ArrayBuffer | string,
  ): Promise<void> => {
    const existing = await findChild(parentId, name);
    if (existing) {
      // Idempotent: leave the first write in place.
      return;
    }

    const boundary = `lugin_corpus_${Math.random().toString(36).slice(2)}`;
    const meta = JSON.stringify({
      mimeType: contentType,
      name,
      parents: [parentId],
    });
    const preamble = new TextEncoder().encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
    );
    const epilogue = new TextEncoder().encode(`\r\n--${boundary}--`);
    const content =
      typeof bytes === 'string' ? new TextEncoder().encode(bytes) : new Uint8Array(bytes);
    const body = new Uint8Array(preamble.length + content.length + epilogue.length);
    body.set(preamble, 0);
    body.set(content, preamble.length);
    body.set(epilogue, preamble.length + content.length);

    const response = await call(`${UPLOAD}?uploadType=multipart&fields=id`, {
      body,
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      method: 'POST',
    });
    if (!response.ok) await failed(response, `Uploading ${name}`);
  };

  return {
    async ensureCorpusRootLink(): Promise<string | null> {
      const root = await ensureCorpusRoot();
      return root.link;
    },

    async uploadSample(input: CorpusUploadInput): Promise<CorpusUploadResult> {
      const sampleId = input.sampleId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
      if (sampleId.length < 8) {
        throw new DriveError(400, 'Invalid sample id');
      }
      const contributor = input.contributorId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
      if (contributor.length < 8) {
        throw new DriveError(400, 'Invalid contributor id');
      }

      const root = await ensureCorpusRoot();
      const contribFolder = await ensureChild(root.id, `contributor-${contributor}`);
      const month = await ensureChild(contribFolder, monthFolder(input.createdAt));

      const existing = await findChild(month, sampleId);
      if (existing) {
        return { alreadyExisted: true, folderId: existing.id, sampleId };
      }

      const sampleFolder = await createFolder(month, sampleId);
      await uploadBytes(
        sampleFolder.id,
        'metadata.json',
        'application/json',
        JSON.stringify(input.meta),
      );
      if (input.image && input.mimeType) {
        await uploadBytes(
          sampleFolder.id,
          imageFileName(input.mimeType),
          input.mimeType,
          input.image,
        );
      }
      return { alreadyExisted: false, folderId: sampleFolder.id, sampleId };
    },
  };
};
