import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import * as Updates from 'expo-updates';
import { AppState, type AppStateStatus } from 'react-native';

export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'error';

type UpdateContextValue = {
  applyUpdate: () => Promise<void>;
  /** True when a scanner/import session must not be interrupted. */
  blockReload: boolean;
  channel: string | null;
  checkForUpdate: (opts?: { applyIfSafe?: boolean }) => Promise<void>;
  createdAt: Date | null;
  detail: string | null;
  error: string | null;
  isEnabled: boolean;
  phase: UpdatePhase;
  runtimeVersion: string | null;
  setBlockReload: (blocked: boolean) => void;
  updateId: string | null;
};

const UpdateContext = createContext<UpdateContextValue | null>(null);

const unavailableDetail = (
  check: Awaited<ReturnType<typeof Updates.checkForUpdateAsync>>,
): string => {
  if (check.isAvailable || !('reason' in check)) return 'No update published for this install.';
  switch (check.reason) {
    case Updates.UpdateCheckResultNotAvailableReason.UPDATE_PREVIOUSLY_FAILED:
      return 'The last update crashed on launch. This phone will not try that same update again.';
    case Updates.UpdateCheckResultNotAvailableReason.UPDATE_REJECTED_BY_SELECTION_POLICY:
      return 'An update is published, but it is older than the copy already running.';
    case Updates.UpdateCheckResultNotAvailableReason.NO_UPDATE_AVAILABLE_ON_SERVER:
      return 'No update is published for this install.';
    default:
      return `No update (${check.reason}).`;
  }
};

/**
 * Development OTA lifecycle:
 * - cold start: check + fetch; apply if nothing blocks reload
 * - resume: background check/fetch; never force-reload (banner / Settings Apply)
 * - Settings: Check / Apply
 */
export function UpdateProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<UpdatePhase>('idle');
  const [detail, setDetail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = Updates.useUpdates();
  const pendingRef = useRef(live.isUpdatePending);
  pendingRef.current = live.isUpdatePending;
  const [blockReload, setBlockReload] = useState(false);
  const blockRef = useRef(blockReload);
  blockRef.current = blockReload;
  const coldStartDone = useRef(false);
  const autoApplied = useRef(false);

  const isEnabled = Updates.isEnabled;

  const applyUpdate = useCallback(async () => {
    if (!Updates.isEnabled) return;
    if (blockRef.current) {
      setPhase('ready');
      return;
    }
    await Updates.reloadAsync();
  }, []);

  const checkForUpdate = useCallback(async (opts?: { applyIfSafe?: boolean }) => {
    if (!Updates.isEnabled) {
      setError('Updates disabled in this binary (Metro / Expo Go). Use an installed EAS or TestFlight build.');
      setPhase('error');
      return;
    }
    setPhase('checking');
    setDetail(null);
    setError(null);
    try {
      const check = await Updates.checkForUpdateAsync();
      if (!check.isAvailable) {
        // Launch already downloaded it. Check reports "nothing new" and the
        // Apply button never armed, so the phone stayed on the embedded copy.
        if (pendingRef.current) {
          setDetail('Update downloaded. Apply it to restart.');
          setPhase('ready');
          if (opts?.applyIfSafe && !blockRef.current) await Updates.reloadAsync();
          return;
        }
        setDetail(unavailableDetail(check));
        setPhase('idle');
        return;
      }
      setPhase('downloading');
      const fetched = await Updates.fetchUpdateAsync();
      if (!fetched.isNew) {
        setDetail('Update downloaded. Apply it to restart.');
        setPhase('ready');
        if (opts?.applyIfSafe && !blockRef.current) await Updates.reloadAsync();
        return;
      }
      setDetail('Update downloaded. Apply it to restart.');
      setPhase('ready');
      if (opts?.applyIfSafe && !blockRef.current) {
        await Updates.reloadAsync();
      }
    } catch (err) {
      setPhase('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await checkForUpdate({ applyIfSafe: true });
      coldStartDone.current = true;
    })();
  }, [checkForUpdate]);

  // Native launch can finish the download after the check already returned.
  useEffect(() => {
    if (!live.isUpdatePending || blockRef.current || autoApplied.current) return;
    autoApplied.current = true;
    setDetail('Update downloaded. Restarting…');
    setPhase('ready');
    void Updates.reloadAsync();
  }, [live.isUpdatePending]);

  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === 'active' && coldStartDone.current) {
        void checkForUpdate({ applyIfSafe: false });
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [checkForUpdate]);

  const value = useMemo<UpdateContextValue>(
    () => ({
      applyUpdate,
      blockReload,
      channel: Updates.channel,
      checkForUpdate,
      createdAt: Updates.createdAt,
      detail,
      error,
      isEnabled,
      phase,
      runtimeVersion: Updates.runtimeVersion,
      setBlockReload,
      updateId: Updates.updateId,
    }),
    [phase, detail, error, isEnabled, blockReload, checkForUpdate, applyUpdate],
  );

  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>;
}

export function useAppUpdates(): UpdateContextValue {
  const ctx = useContext(UpdateContext);
  if (!ctx) throw new Error('useAppUpdates requires UpdateProvider');
  return ctx;
}
