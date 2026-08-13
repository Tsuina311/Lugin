// A SyncRepository that is really the service worker.
//
// The engine shouldn't know that Drive is three messages away, so this puts the
// port back together on the overlay's side: send, await, and rebuild the errors
// the worker caught — structured cloning strips the classes, and the engine's
// retry depends on recognising a `ConflictError` for what it is.

import { AuthError } from '@/core/sync/auth';
import type { DomainKey, Revision, SyncedApplicationState } from '@/core/sync/model';
import {
  ConflictError,
  UnsupportedSchemaError,
  type RemoteSnapshot,
  type SyncRepository,
} from '@/core/sync/repository';
import type { RuntimeMessage, RuntimeResponse } from '@/lib/types';

const ask = async (message: RuntimeMessage): Promise<RuntimeResponse> => {
  const reply = (await chrome.runtime.sendMessage(message)) as RuntimeResponse | undefined;
  if (!reply) throw new Error('The extension’s background worker didn’t answer');
  if (reply.kind !== 'error') return reply;

  switch (reply.code) {
    case 'auth':
      throw new AuthError('refused', reply.error);
    case 'conflict':
      throw new ConflictError(null);
    case 'unsupported-schema':
      throw new UnsupportedSchemaError(0);
    default:
      throw new Error(reply.error);
  }
};

export const createRemoteRepository = (): SyncRepository => ({
  async archiveConflict(domain: DomainKey, value: unknown, at: string): Promise<void> {
    await ask({ at, domain, kind: 'drive:archive', value });
  },

  async load(): Promise<RemoteSnapshot | null> {
    const reply = await ask({ kind: 'drive:load' });
    return reply.kind === 'drive:snapshot' ? reply.snapshot : null;
  },

  async save(state: SyncedApplicationState, base: Revision | null): Promise<RemoteSnapshot> {
    const reply = await ask({ base, kind: 'drive:save', state });
    if (reply.kind !== 'drive:snapshot' || !reply.snapshot) {
      throw new Error('Saving didn’t come back with a revision');
    }
    return reply.snapshot;
  },
});

/** Whether the user has connected an account, as the worker remembers it. */
export const googleStatus = async (): Promise<boolean> => {
  const reply = await ask({ kind: 'google:status' });
  return reply.kind === 'google:status' && reply.connected;
};

export const connectGoogle = async (): Promise<boolean> => {
  const reply = await ask({ kind: 'google:connect' });
  return reply.kind === 'google:status' && reply.connected;
};

export const disconnectGoogle = async (): Promise<void> => {
  await ask({ kind: 'google:disconnect' });
};
