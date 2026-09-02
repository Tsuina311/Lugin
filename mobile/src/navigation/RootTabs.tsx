import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraProofScreen } from '../screens/CameraProofScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { StubScreen } from '../screens/StubScreen';

type Tab = 'collection' | 'decks' | 'scan' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'collection', label: 'Collection' },
  { id: 'decks', label: 'Decks' },
  { id: 'scan', label: 'Scan' },
  { id: 'settings', label: 'Settings' },
];

export function RootTabs() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('scan');

  return (
    <View style={styles.root}>
      <View style={styles.body}>
        {tab === 'collection' ? (
          <StubScreen
            title="Collection"
            body="Owned cards, quantities, foil, cost basis, and valuation will reuse the portable collection domain — after the camera gate."
          />
        ) : null}
        {tab === 'decks' ? (
          <StubScreen
            title="Decks"
            body="Deck lists and ManaBox export reuse existing portable deck logic. Cardmarket wants/cart stay in the Chrome extension."
          />
        ) : null}
        {tab === 'scan' ? <CameraProofScreen /> : null}
        {tab === 'settings' ? <SettingsScreen /> : null}
      </View>

      <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <Pressable
              key={t.id}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setTab(t.id)}
            >
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0B1220',
  },
  body: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#101826',
    paddingTop: 8,
    paddingHorizontal: 8,
    gap: 4,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: 'rgba(61,126,255,0.18)',
  },
  tabLabel: {
    color: '#8A97AD',
    fontSize: 12,
    fontWeight: '600',
  },
  tabLabelActive: {
    color: '#E8EEF7',
  },
});
