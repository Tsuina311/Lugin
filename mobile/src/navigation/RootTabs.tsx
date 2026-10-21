import { memo, useEffect, useMemo, useState } from 'react';

import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLibrary } from '../data/useLibrary';
import { isBenchmarkToolsEnabled } from '../scan/benchmark';
import { CameraScanScreen } from '../screens/CameraScanScreen';
import { CollectionScreen } from '../screens/CollectionScreen';
import { DeckScreens } from '../screens/DeckScreens';
import { SettingsScreen } from '../screens/SettingsScreen';
import { collectionImageCandidates } from '../ui/CardThumb';
import { preloadCardImageCandidates } from '../ui/cardImageCache';

import { capabilitiesFor } from '@/core/mobile/capabilities';
import { cardKey } from '@/lib/cardName';

type Tab = 'collection' | 'decks' | 'scan' | 'binder' | 'geometry' | 'settings';

// These screens build collection/deck indexes and prime visible card images.
// Keep their completed work when the tab bar itself rerenders.
const StableCollectionScreen = memo(CollectionScreen);
const StableDeckScreens = memo(DeckScreens);

export function RootTabs() {
  const insets = useSafeAreaInsets();
  const library = useLibrary();
  const capabilities = capabilitiesFor(Platform.OS === 'ios' ? 'native-ios' : 'native-android');
  const initialTab: Tab = capabilities.nativeScanner ? 'scan' : 'collection';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [mountedTabs, setMountedTabs] = useState<Set<Tab>>(() => new Set([initialTab]));
  const [cameraSurface, setCameraSurface] = useState<'scan' | 'binder' | 'geometry'>('scan');
  const benchEnabled = isBenchmarkToolsEnabled();

  const tabs = useMemo(() => {
    const list: { id: Tab; label: string }[] = [
      { id: 'collection', label: 'Collection' },
      { id: 'decks', label: 'Decks' },
    ];
    if (capabilities.nativeScanner) {
      list.push({ id: 'scan', label: 'Single Scan' });
      if (capabilities.binderScanner) list.push({ id: 'binder', label: 'Binder' });
      if (benchEnabled) {
        list.push({ id: 'geometry', label: 'Geometry' });
      }
    }
    list.push({ id: 'settings', label: 'Settings' });
    return list;
  }, [benchEnabled, capabilities.binderScanner, capabilities.nativeScanner]);

  useEffect(() => {
    if (tab === 'scan' || tab === 'binder' || tab === 'geometry') {
      setCameraSurface(tab === 'binder' ? 'binder' : tab === 'geometry' ? 'geometry' : 'scan');
    }
  }, [tab]);

  const collectionCards = library.data?.collection.value?.cards;
  const printings = library.data?.printings.value;
  useEffect(() => {
    if (!collectionCards?.length) return;
    const timer = setTimeout(() => {
      const firstPictures = collectionCards
        .slice(0, 12)
        .map(card => collectionImageCandidates(card, printings?.[cardKey(card.name)]));
      void Promise.all(firstPictures.map(preloadCardImageCandidates));
    }, 500);
    return () => clearTimeout(timer);
  }, [collectionCards, printings]);

  // Keep one camera instance across Single Scan ↔ Binder ↔ Geometry ↔ Settings.
  const cameraVisible = tab === 'scan' || tab === 'binder' || (benchEnabled && tab === 'geometry');
  const keepCameraMounted = capabilities.nativeScanner && (cameraVisible || tab === 'settings');
  const openTab = (next: Tab): void => {
    setMountedTabs(current => {
      if (current.has(next)) return current;
      const updated = new Set(current);
      updated.add(next);
      return updated;
    });
    setTab(next);
  };

  return (
    <View style={styles.root}>
      <View style={styles.body}>
        {mountedTabs.has('collection') ? (
          <View
            pointerEvents={tab === 'collection' ? 'auto' : 'none'}
            style={tab === 'collection' ? styles.screenFill : styles.screenHidden}
          >
            <StableCollectionScreen />
          </View>
        ) : null}
        {mountedTabs.has('decks') ? (
          <View
            pointerEvents={tab === 'decks' ? 'auto' : 'none'}
            style={tab === 'decks' ? styles.screenFill : styles.screenHidden}
          >
            <StableDeckScreens />
          </View>
        ) : null}
        {keepCameraMounted ? (
          <View
            pointerEvents={cameraVisible ? 'auto' : 'none'}
            style={cameraVisible ? styles.cameraFill : styles.cameraHidden}
          >
            <CameraScanScreen
              onOpenBinder={() => openTab('binder')}
              onOpenGeometry={() => openTab('geometry')}
              onOpenScan={() => openTab('scan')}
              surface={cameraSurface}
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
              onPress={() => openTab(t.id)}
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
  screenFill: {
    flex: 1,
  },
  screenHidden: {
    display: 'none',
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
