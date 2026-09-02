import { AppState, type AppStateStatus } from 'react-native';
import * as Updates from 'expo-updates';
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

export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'error';

type UpdateContextValue = {
  phase: UpdatePhase;
  error: string | null;
  isEnabled: boolean;
  channel: string | null;
  updateId: string | null;
  createdAt: Date | null;
  runtimeVersion: string | null;
  /** True when a scanner/import session must not be interrupted. */
  blockReload: boolean;
  setBlockReload: (blocked: boolean) => void;
  checkForUpdate: (opts?: { applyIfSafe?: boolean }) => Promise<void>;
  applyUpdate: () => Promise<void>;
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
      phase,
      error,
      isEnabled,
      channel: Updates.channel,
      updateId: Updates.updateId,
      createdAt: Updates.createdAt,
      runtimeVersion: Updates.runtimeVersion,
      blockReload,
      setBlockReload,
      checkForUpdate,
      applyUpdate,
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
