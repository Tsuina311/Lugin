import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/** True while the app is in the foreground. */
export const useAppActive = (): boolean => {
  const [active, setActive] = useState(() => AppState.currentState === 'active');

  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      setActive(state === 'active');
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, []);

  return active;
};
