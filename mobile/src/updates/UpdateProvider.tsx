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
  error: string | null;
  isEnabled: boolean;
  phase: UpdatePhase;
  runtimeVersion: string | null;
  setBlockReload: (blocked: boolean) => void;
  updateId: string | null;
};

const UpdateContext = createContext<UpdateContextValue | null>(null);

/**
 * Development OTA lifecycle:
 * - cold start: check + fetch; apply if nothing blocks reload
 * - resume: background check/fetch; never force-reload (banner / Settings Apply)
 * - Settings: Check / Apply
 */
export function UpdateProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<UpdatePhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [blockReload, setBlockReload] = useState(false);
  const blockRef = useRef(blockReload);
  blockRef.current = blockReload;
  const coldStartDone = useRef(false);

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
      setError('Updates disabled in this binary (Metro / Expo Go). Use a development APK build.');
      setPhase('error');
      return;
    }
    setPhase('checking');
    setError(null);
    try {
      const check = await Updates.checkForUpdateAsync();
      if (!check.isAvailable) {
        setPhase('idle');
        return;
      }
      setPhase('downloading');
      const fetched = await Updates.fetchUpdateAsync();
      if (!fetched.isNew) {
        setPhase('idle');
        return;
      }
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
      error,
      isEnabled,
      phase,
      runtimeVersion: Updates.runtimeVersion,
      setBlockReload,
      updateId: Updates.updateId,
    }),
    [phase, error, isEnabled, blockReload, checkForUpdate, applyUpdate],
  );

  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>;
}

export function useAppUpdates(): UpdateContextValue {
  const ctx = useContext(UpdateContext);
  if (!ctx) throw new Error('useAppUpdates requires UpdateProvider');
  return ctx;
}
