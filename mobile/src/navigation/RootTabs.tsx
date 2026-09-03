import { useState } from 'react';

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CameraScanScreen } from '../screens/CameraScanScreen';
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
            body="Owned cards, quantities, foil, cost basis, and valuation will reuse the portable collection domain — after the camera gate."
            title="Collection"
          />
        ) : null}
        {tab === 'decks' ? (
          <StubScreen
            body="Deck lists and ManaBox export reuse existing portable deck logic. Cardmarket wants/cart stay in the Chrome extension."
            title="Decks"
          />
        ) : null}
        {tab === 'scan' ? <CameraScanScreen /> : null}
        {tab === 'settings' ? <SettingsScreen /> : null}
      </View>

      <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        {TABS.map(t => {
          const active = tab === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => setTab(t.id)}
              style={[styles.tab, active && styles.tabActive]}
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
  body: {
    flex: 1,
  },
  root: {
    backgroundColor: '#0B1220',
    flex: 1,
  },
  tab: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    paddingVertical: 10,
  },
  tabActive: {
    backgroundColor: 'rgba(61,126,255,0.18)',
  },
  tabBar: {
    backgroundColor: '#101826',
    borderTopColor: 'rgba(255,255,255,0.12)',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    paddingTop: 8,
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
