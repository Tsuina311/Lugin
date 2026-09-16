import { useEffect, useMemo, useState } from 'react';

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isBenchmarkToolsEnabled } from '../scan/benchmark';
import { CameraScanScreen } from '../screens/CameraScanScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { StubScreen } from '../screens/StubScreen';

type Tab = 'collection' | 'decks' | 'scan' | 'binder' | 'geometry' | 'settings';

export function RootTabs() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('scan');
  const [cameraSurface, setCameraSurface] = useState<'scan' | 'binder' | 'geometry'>('scan');
  const benchEnabled = isBenchmarkToolsEnabled();

  const tabs = useMemo(() => {
    const list: { id: Tab; label: string }[] = [
      { id: 'collection', label: 'Collection' },
      { id: 'decks', label: 'Decks' },
      { id: 'scan', label: 'Single Scan' },
      { id: 'binder', label: 'Binder' },
    ];
    if (benchEnabled) {
      list.push({ id: 'geometry', label: 'Geometry' });
    }
    list.push({ id: 'settings', label: 'Settings' });
    return list;
  }, [benchEnabled]);

  useEffect(() => {
    if (tab === 'scan' || tab === 'binder' || tab === 'geometry') {
      setCameraSurface(tab === 'binder' ? 'binder' : tab === 'geometry' ? 'geometry' : 'scan');
    }
  }, [tab]);

  // Keep one camera instance across Single Scan ↔ Binder ↔ Geometry ↔ Settings.
  const cameraVisible =
    tab === 'scan' || tab === 'binder' || (benchEnabled && tab === 'geometry');
  const keepCameraMounted = cameraVisible || tab === 'settings';

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
        {keepCameraMounted ? (
          <View
            style={cameraVisible ? styles.cameraFill : styles.cameraHidden}
            pointerEvents={cameraVisible ? 'auto' : 'none'}
          >
            <CameraScanScreen
              surface={cameraSurface}
              onOpenBinder={() => setTab('binder')}
              onOpenGeometry={() => setTab('geometry')}
              onOpenScan={() => setTab('scan')}
            />
          </View>
        ) : null}
        {tab === 'settings' ? <SettingsScreen /> : null}
      </View>

      <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        {tabs.map(t => {
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
  cameraFill: {
    flex: 1,
  },
  cameraHidden: {
    height: 0,
    overflow: 'hidden',
    width: 0,
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
    backgroundColor: '#0B1220',
    borderTopColor: '#1C2636',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 6,
    paddingTop: 6,
  },
  tabLabel: {
    color: '#8A97AD',
    fontSize: 11,
    fontWeight: '600',
  },
  tabLabelActive: {
    color: '#F4F7FB',
  },
});
