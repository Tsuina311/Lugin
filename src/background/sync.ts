// The worker's half of syncing: authorise, and talk to Drive.
//
// The reconciliation itself deliberately stays in the overlay, where the data
// and the stores are. This side is a courier — it holds the only two things a
// content script can't have, the identity API and a cross-origin fetch that
// isn't the page's.

import { googleAuth } from './googleAuth';

import { AuthError } from '@/core/sync/auth';
import { createDriveRepository } from '@/core/sync/drive';
import { ConflictError, UnsupportedSchemaError } from '@/core/sync/repository';
import type { RuntimeMessage, RuntimeResponse } from '@/lib/types';

const drive = createDriveRepository({ token: googleAuth });

/** Turn an error into something the overlay can act on, not just display. */
const asResponse = (err: unknown): RuntimeResponse => {
  if (err instanceof ConflictError) return { code: 'conflict', error: err.message, kind: 'error' };
  if (err instanceof UnsupportedSchemaError) {
    return { code: 'unsupported-schema', error: err.message, kind: 'error' };
  }
  if (err instanceof AuthError) return { code: 'auth', error: err.message, kind: 'error' };
  return { error: err instanceof Error ? err.message : String(err), kind: 'error' };
};

/**
 * Handle a sync message, or return null if it isn't one of ours.
 *
 * Kept as a plain async function so the worker's listener stays a router.
 */
export const handleSyncMessage = (message: RuntimeMessage): Promise<RuntimeResponse> | null => {
  switch (message.kind) {
    case 'drive:archive':
      return drive
        .archiveConflict(message.domain, message.value, message.at)
        .then((): RuntimeResponse => ({ kind: 'ok' }))
        .catch(asResponse);

    case 'drive:load':
      return drive
        .load()
        .then((snapshot): RuntimeResponse => ({ kind: 'drive:snapshot', snapshot }))
        .catch(asResponse);

    case 'drive:save':
      return drive
        .save(message.state, message.base)
        .then((snapshot): RuntimeResponse => ({ kind: 'drive:snapshot', snapshot }))
        .catch(asResponse);

    case 'google:connect':
      return googleAuth
        .connect()
        .then((connected): RuntimeResponse => ({ connected, kind: 'google:status' }))
        .catch(asResponse);

    case 'google:disconnect':
      return googleAuth
        .disconnect()
        .then((): RuntimeResponse => ({ connected: false, kind: 'google:status' }))
        .catch(asResponse);

    case 'google:status':
      return googleAuth
        .isConnected()
        .then((connected): RuntimeResponse => ({ connected, kind: 'google:status' }))
        .catch(asResponse);

    default:
      return null;
  }
};
