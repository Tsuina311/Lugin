// The user's own Google Drive as the sync repository.
//
// Everything lives in `appDataFolder`, a per-application hidden folder: the user
// can see how much space it uses and delete it, but no other app — and no page
// they visit — can read it, and it never shows up among their files. That's the
// whole reason for the `drive.appdata` scope, which is the narrowest thing
// Google offers that still gives us somewhere to put a few thousand cards.
//
// `fetch` and the token provider are injected, so this file is as portable as
// the model it carries: on a phone it's the same code with a different token
// source.

import type { TokenProvider } from './auth';
import type { DomainKey, Revision, SyncedApplicationState } from './model';
import {
  ConflictError,
  UnsupportedSchemaError,
  type RemoteSnapshot,
  type SyncRepository,
} from './repository';
import { readSyncedState, serialize } from './serialize';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER = 'appDataFolder';

/** The one document. Everything else in the folder is a conflict copy. */
export const STATE_FILE = 'app-state.json';

/** Drive's own change counter for a file: our revision. */
interface FileInfo {
  id: string;
  version: string;
}

export interface DriveOptions {
  /** Injected so tests can answer without a network, and phones can swap it. */
  http?: typeof fetch;
  token: TokenProvider;
}

export class DriveError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DriveError';
  }
}

export const createDriveRepository = ({
  http = fetch,
  token,
}: DriveOptions): SyncRepository => {
  // Saves us a lookup per operation. Only ever a cache: if Drive says the file
  // is gone, we forget it and search again rather than insisting.
  let known: FileInfo | null = null;

  /**
   * A Drive call with the user's token.
   *
   * A 401 gets exactly one retry with a freshly minted token: access tokens
   * last an hour and a background sync will routinely wake up holding a stale
   * one, which shouldn't look like a failure to the user.
   */
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

  const find = async (): Promise<FileInfo | null> => {
    const query = new URLSearchParams({
      fields: 'files(id,version)',
      orderBy: 'modifiedTime desc',
      pageSize: '1',
      q: `name = '${STATE_FILE}' and trashed = false`,
      spaces: FOLDER,
    });
    const response = await call(`${FILES}?${query}`);
    if (!response.ok) await failed(response, 'Looking up the stored data');
    const body = (await response.json()) as { files?: FileInfo[] };
    known = body.files?.[0] ?? null;
    return known;
  };

  /** Create or overwrite the document, returning the revision it now has. */
  const upload = async (
    state: SyncedApplicationState,
    file: FileInfo | null,
  ): Promise<RemoteSnapshot> => {
    const body = serialize(state);
    const response = file
      ? await call(`${UPLOAD}/${file.id}?uploadType=media&fields=id,version`, {
          body,
          headers: { 'Content-Type': 'application/json' },
          method: 'PATCH',
        })
      : await call(`${UPLOAD}?uploadType=multipart&fields=id,version`, {
          body: multipart({ name: STATE_FILE, parents: [FOLDER] }, body),
          headers: { 'Content-Type': `multipart/related; boundary=${BOUNDARY}` },
          method: 'POST',
        });
    if (!response.ok) await failed(response, 'Saving');
    const saved = (await response.json()) as FileInfo;
    known = saved;
    return { revision: saved.version, state };
  };

  const read = async (file: FileInfo): Promise<RemoteSnapshot | null> => {
    const response = await call(`${FILES}/${file.id}?alt=media`);
    if (response.status === 404) {
      known = null;
      return null;
    }
    if (!response.ok) await failed(response, 'Reading the stored data');

    const parsed = readSyncedState(await response.text());
    if (!parsed.ok) {
      if (parsed.reason === 'unsupported-schema') throw new UnsupportedSchemaError(parsed.found);
      // Refusing beats guessing: an unreadable document means this device keeps
      // working from its own data and writes nothing over the top.
      throw new DriveError(0, `The stored data couldn't be read (${parsed.detail})`);
    }
    return { revision: file.version, state: parsed.state };
  };

  return {
    async archiveConflict(domain: DomainKey, value: unknown, at: string): Promise<void> {
      // Named so the folder reads as a history when someone goes looking, and
      // kept as its own file so restoring one never risks the live document.
      const name = `conflict-${domain}-${at.replace(/[:.]/g, '-')}.json`;
      const response = await call(`${UPLOAD}?uploadType=multipart&fields=id`, {
        body: multipart({ name, parents: [FOLDER] }, JSON.stringify({ at, domain, value })),
        headers: { 'Content-Type': `multipart/related; boundary=${BOUNDARY}` },
        method: 'POST',
      });
      if (!response.ok) await failed(response, 'Keeping a copy of the replaced version');
    },

    async load(): Promise<RemoteSnapshot | null> {
      const file = await find();
      return file ? read(file) : null;
    },

    async save(state: SyncedApplicationState, base: Revision | null): Promise<RemoteSnapshot> {
      // Drive has no conditional write, so the check is a read immediately
      // before the write. That leaves a race two devices could both slip
      // through — hence the conflict copies, which make the rare loss
      // recoverable rather than pretending it can't happen.
      const file = await find();
      const current = file?.version ?? null;
      if (current !== base) throw new ConflictError(file ? await read(file) : null);
      return upload(state, file);
    },
  };
};

const BOUNDARY = 'lugin-sync-boundary';

/** Drive wants metadata and content in one request when creating a file. */
const multipart = (metadata: Record<string, unknown>, content: string): string =>
  [
    `--${BOUNDARY}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${BOUNDARY}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    content,
    `--${BOUNDARY}--`,
    '',
  ].join('\r\n');
