import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootTabs } from './src/navigation/RootTabs';
import { UpdateProvider } from './src/updates/UpdateProvider';

export default function App() {
  return (
    <SafeAreaProvider>
      <UpdateProvider>
        <StatusBar style="light" />
        <RootTabs />
      </UpdateProvider>
    </SafeAreaProvider>
  );
}
