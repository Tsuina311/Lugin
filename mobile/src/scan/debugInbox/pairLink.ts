import { useEffect } from 'react';
import { Linking } from 'react-native';

import { isBenchmarkToolsEnabled } from '../benchmark/isBenchmarkEnabled';
import { applyReceiverInput } from './protocol';
import { testInboxConnection } from './queue';
import { applyInboxPairInput } from './settings';

/** Camera-app scan of lugin://pair-debug?… opens this app and lands here. */
export const consumePairUrl = async (raw: string | null): Promise<boolean> => {
  if (!raw || !isBenchmarkToolsEnabled()) return false;
  if (!applyReceiverInput(raw).url) return false;
  await applyInboxPairInput(raw);
  await testInboxConnection();
  return true;
};

export const usePairLink = (): void => {
  useEffect(() => {
    if (!isBenchmarkToolsEnabled()) return;
    let alive = true;
    let last = '';
    const onUrl = (url: string | null) => {
      if (!alive || !url || url === last) return;
      last = url;
      void consumePairUrl(url);
    };
    void Linking.getInitialURL().then(onUrl);
    const sub = Linking.addEventListener('url', event => onUrl(event.url));
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
};
