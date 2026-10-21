import { Component, useEffect, type ReactNode } from 'react';

import { StatusBar } from 'expo-status-bar';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { libraryStore } from './src/data/libraryStore';
import { RootTabs } from './src/navigation/RootTabs';
import { PHONE_VERSION } from './src/phoneVersion';
import { usePairLink } from './src/scan/debugInbox/pairLink';
import { UpdateProvider } from './src/updates/UpdateProvider';

type BoundaryState = { message: string | null; stack: string | null };

class AppBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { message: null, stack: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { message: error.message, stack: error.stack ?? null };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    const stack = [error.stack, info.componentStack].filter(Boolean).join('\n');
    this.setState({ message: error.message, stack: stack || null });
  }

  render() {
    if (this.state.message) {
      return (
        <View style={styles.crash}>
          <Text style={styles.crashTitle}>The phone app hit an error</Text>
          <Text style={styles.crashVersion}>{PHONE_VERSION}</Text>
          <ScrollView style={styles.crashScroll}>
            <Text selectable style={styles.crashBody}>
              {this.state.message}
            </Text>
            {this.state.stack ? (
              <Text selectable style={styles.crashStack}>
                {this.state.stack}
              </Text>
            ) : null}
          </ScrollView>
          <Pressable onPress={() => this.setState({ message: null, stack: null })} style={styles.crashRetry}>
            <Text style={styles.crashRetryLabel}>Try again</Text>
          </Pressable>
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
  crashRetry: {
    alignItems: 'center',
    backgroundColor: '#1C2636',
    borderRadius: 8,
    marginTop: 16,
    paddingVertical: 12,
  },
  crashRetryLabel: {
    color: '#E8EEF7',
    fontSize: 16,
    fontWeight: '700',
  },
  crashScroll: {
    flexGrow: 0,
    maxHeight: 360,
  },
  crashStack: {
    color: '#8A97AD',
    fontSize: 12,
    lineHeight: 16,
    marginTop: 12,
  },
  crashVersion: {
    color: '#9EC1FF',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  crashTitle: {
    color: '#F4F7FB',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
  },
});
