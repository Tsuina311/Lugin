// The phone's whole data layer: read the document the desktop wrote, once.
//
// There is no local store and no sync engine here on purpose. This build only
// reads, so the honest model is a fetch with a refresh button — no reconciliation
// to get wrong, and nothing that can push a half-formed phone state over the
// desktop's collection. `LocalRepository` and the engine come back when editing
// does.

import { useCallback, useEffect, useState } from 'react';

import { AuthError } from '@/core/sync/auth';
import { createDriveRepository } from '@/core/sync/drive';
import type { ApplicationData } from '@/core/sync/model';
import { UnsupportedSchemaError } from '@/core/sync/repository';
import { webGoogleAuth } from '@/platform/web/googleAuth';

export type SyncStatus =
  /** No client id in this build; sync can't be attempted. */
  | 'not-configured'
  /** No usable token: waiting for the user to tap connect. */
  | 'disconnected'
  /** A flow or a fetch is running. */
  | 'busy'
  /** Connected, but the user has never synced from the desktop. */
  | 'empty'
  | 'ready'
  | 'error';

export interface SyncedData {
  connect: () => void;
  data: ApplicationData | null;
  disconnect: () => void;
  error: string | null;
  refresh: () => void;
  status: SyncStatus;
  /** When the desktop last wrote, not when we last read. */
  updatedAt: string | null;
}

const repository = createDriveRepository({ token: webGoogleAuth });

const describe = (error: unknown): string => {
  if (error instanceof UnsupportedSchemaError) {
    return 'The desktop extension is newer than this app. Update it here to read the data.';
  }
  if (error instanceof AuthError) return error.message;
  return error instanceof Error ? error.message : 'Something went wrong';
};

export const useSyncedData = (): SyncedData => {
  const configured = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);
  const [status, setStatus] = useState<SyncStatus>(
    !configured ? 'not-configured' : webGoogleAuth.isConnected() ? 'busy' : 'disconnected',
  );
  const [data, setData] = useState<ApplicationData | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async (): Promise<void> => {
    setError(null);
    setStatus('busy');
    try {
      const snapshot = await repository.load();
      if (!snapshot) {
        setStatus('empty');
        return;
      }
      setData(snapshot.state.data);
      setUpdatedAt(snapshot.state.updatedAt);
      setStatus('ready');
    } catch (err) {
      // An expired token isn't a failure worth an error screen — it's the
      // connect button coming back, because renewing needs a tap.
      if (err instanceof AuthError && err.failure === 'no-session') {
        setStatus('disconnected');
        return;
      }
      setError(describe(err));
      setStatus('error');
    }
  }, []);

  // A token in session storage means this is a reload rather than a first visit,
  // so the data can come back without asking for anything.
  useEffect(() => {
    if (configured && webGoogleAuth.isConnected()) void read();
  }, [configured, read]);

  const connect = useCallback((): void => {
    setError(null);
    setStatus('busy');
    // Kept inside the click's call stack as far as possible: the popup is only
    // allowed because a person just tapped.
    webGoogleAuth.connect().then(
      () => void read(),
      (err: unknown) => {
        if (err instanceof AuthError && err.failure === 'cancelled') {
          setStatus('disconnected');
          return;
        }
        setError(describe(err));
        setStatus('error');
      },
    );
  }, [read]);

  const disconnect = useCallback((): void => {
    void webGoogleAuth.disconnect().finally(() => {
      setData(null);
      setUpdatedAt(null);
      setError(null);
      setStatus('disconnected');
    });
  }, []);

  return {
    connect,
    data,
    disconnect,
    error,
    refresh: () => void read(),
    status,
    updatedAt,
  };
};
