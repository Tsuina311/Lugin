import { Component, useEffect, type ReactNode } from 'react';

import { StatusBar } from 'expo-status-bar';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { libraryStore } from './src/data/libraryStore';
import { RootTabs } from './src/navigation/RootTabs';
import { usePairLink } from './src/scan/debugInbox/pairLink';
import { UpdateProvider } from './src/updates/UpdateProvider';

type BoundaryState = { message: string | null };

class AppBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { message: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { message: error.message };
  }

  render() {
    if (this.state.message) {
      return (
        <View style={styles.crash}>
          <Text style={styles.crashTitle}>The phone app hit an error</Text>
          <Text style={styles.crashBody}>{this.state.message}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  usePairLink();
  useEffect(() => {
    void libraryStore.boot();
    const subscription = Linking.addEventListener('url', ({ url }) => {
      void libraryStore.completeAuthUrl(url);
    });
    void Linking.getInitialURL().then(url => {
      if (url) void libraryStore.completeAuthUrl(url);
    });
    return () => subscription.remove();
  }, []);
  return (
    <AppBoundary>
      <SafeAreaProvider>
        <UpdateProvider>
          <StatusBar style="light" />
          <RootTabs />
        </UpdateProvider>
      </SafeAreaProvider>
    </AppBoundary>
  );
}

const styles = StyleSheet.create({
  crash: {
    backgroundColor: '#0B1220',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  crashBody: {
    color: '#C5D0DE',
    fontSize: 16,
    lineHeight: 22,
  },
  crashTitle: {
    color: '#F4F7FB',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
  },
});
