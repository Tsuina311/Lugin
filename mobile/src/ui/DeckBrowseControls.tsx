import { useState } from 'react';

import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { DeckBrowseState } from '@/lib/deckBrowse';

const TYPE_FILTERS = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land'];
const MANA_FILTERS = [0, 1, 2, 3, 4, 5, 6, 7];

const activeFilterCount = (state: DeckBrowseState): number =>
  Number(Boolean(state.query.trim())) + Number(state.mana != null) + Number(Boolean(state.type));

export const DeckBrowseControls = ({
  inline = false,
  onChange,
  state,
}: {
  inline?: boolean;
  onChange: (state: DeckBrowseState) => void;
  state: DeckBrowseState;
}) => {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const filters = activeFilterCount(state);
  return (
    <>
      <View style={[styles.toolbar, inline && styles.toolbarInline]}>
        <Pressable
          accessibilityLabel="Filter cards"
          onPress={() => setFiltersOpen(true)}
          style={[styles.iconButton, filters > 0 && styles.iconButtonOn]}
        >
          <View style={styles.funnel}>
            <View style={styles.funnelTop} />
            <View style={styles.funnelStem} />
          </View>
          {filters > 0 ? <Text style={styles.badge}>{filters}</Text> : null}
        </Pressable>
        <Pressable
          accessibilityLabel={`Sort cards. Current sort: ${state.sort}`}
          onPress={() => setSortOpen(true)}
          style={[styles.iconButton, state.sort !== 'name' && styles.iconButtonOn]}
        >
          <Text style={styles.sortIcon}>⇅</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={state.view === 'list' ? 'Use card grid view' : 'Use list view'}
          onPress={() => onChange({ ...state, view: state.view === 'list' ? 'grid' : 'list' })}
          style={styles.iconButton}
        >
          <Text style={styles.viewIcon}>{state.view === 'list' ? '▦' : '☷'}</Text>
        </Pressable>
      </View>
      <Modal
        animationType="fade"
        onRequestClose={() => setFiltersOpen(false)}
        transparent
        visible={filtersOpen}
      >
        <Pressable onPress={() => setFiltersOpen(false)} style={styles.backdrop}>
          <Pressable onPress={event => event.stopPropagation()} style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Filter cards</Text>
              <Pressable
                onPress={() =>
                  onChange({ ...state, mana: null, query: '', type: null })
                }
              >
                <Text style={styles.reset}>Reset</Text>
              </Pressable>
            </View>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={query => onChange({ ...state, query })}
              placeholder="Name, tag or category"
              placeholderTextColor="#6E7B91"
              style={styles.input}
              value={state.query}
            />
            <Text style={styles.label}>MANA VALUE</Text>
            <ScrollView
              contentContainerStyle={styles.chips}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              <Chip
                active={state.mana == null}
                label="All"
                onPress={() => onChange({ ...state, mana: null })}
              />
              {MANA_FILTERS.map(mana => (
                <Chip
                  key={mana}
                  active={state.mana === mana}
                  label={mana === 7 ? '7+' : String(mana)}
                  onPress={() => onChange({ ...state, mana })}
                />
              ))}
            </ScrollView>
            <Text style={styles.label}>CARD TYPE</Text>
            <View style={styles.chips}>
              <Chip
                active={state.type == null}
                label="All"
                onPress={() => onChange({ ...state, type: null })}
              />
              {TYPE_FILTERS.map(type => (
                <Chip
                  key={type}
                  active={state.type === type}
                  label={type}
                  onPress={() => onChange({ ...state, type })}
                />
              ))}
            </View>
            <Pressable onPress={() => setFiltersOpen(false)} style={styles.done}>
              <Text style={styles.doneText}>Show cards</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        animationType="fade"
        onRequestClose={() => setSortOpen(false)}
        transparent
        visible={sortOpen}
      >
        <Pressable onPress={() => setSortOpen(false)} style={styles.backdrop}>
          <Pressable onPress={event => event.stopPropagation()} style={styles.sortSheet}>
            <Text style={styles.sheetTitle}>Sort cards</Text>
            {(
              [
                ['name', 'Name'],
                ['mana', 'Mana value'],
                ['type', 'Card type'],
                ['owned', 'Owned first'],
              ] as const
            ).map(([id, label]) => (
              <Pressable
                key={id}
                onPress={() => {
                  onChange({ ...state, sort: id });
                  setSortOpen(false);
                }}
                style={[styles.sortChoice, state.sort === id && styles.sortChoiceOn]}
              >
                <Text style={styles.sortChoiceText}>{label}</Text>
                {state.sort === id ? <Text style={styles.check}>✓</Text> : null}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
};

const Chip = ({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) => (
  <Pressable onPress={onPress} style={[styles.chip, active && styles.chipOn]}>
    <Text style={[styles.chipText, active && styles.chipTextOn]}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.68)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  badge: {
    backgroundColor: '#3D7EFF',
    borderRadius: 8,
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '900',
    height: 15,
    lineHeight: 15,
    position: 'absolute',
    right: -4,
    textAlign: 'center',
    top: -4,
    width: 15,
  },
  check: { color: '#8CB4FF', fontSize: 17, fontWeight: '900' },
  chip: {
    borderColor: '#334158',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipOn: { backgroundColor: '#17345B', borderColor: '#3D7EFF' },
  chipText: { color: '#AAB6C9', fontSize: 11, fontWeight: '600' },
  chipTextOn: { color: '#BFD3FF' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  done: {
    alignItems: 'center',
    backgroundColor: '#3D7EFF',
    borderRadius: 9,
    marginTop: 18,
    paddingVertical: 11,
  },
  doneText: { color: '#FFFFFF', fontWeight: '800' },
  funnel: { alignItems: 'center', height: 17, justifyContent: 'center', width: 18 },
  funnelStem: { backgroundColor: '#DCE5F2', height: 6, width: 2 },
  funnelTop: {
    borderLeftColor: 'transparent',
    borderLeftWidth: 7,
    borderRightColor: 'transparent',
    borderRightWidth: 7,
    borderTopColor: '#DCE5F2',
    borderTopWidth: 7,
    height: 0,
    width: 0,
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: '#1C2636',
    borderRadius: 7,
    height: 28,
    justifyContent: 'center',
    width: 30,
  },
  iconButtonOn: { backgroundColor: '#17345B' },
  input: {
    backgroundColor: '#0D1522',
    borderColor: '#2B3850',
    borderRadius: 8,
    borderWidth: 1,
    color: '#F4F7FB',
    marginBottom: 14,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  label: {
    color: '#78879D',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 7,
    marginTop: 12,
  },
  reset: { color: '#8CB4FF', fontSize: 12, fontWeight: '700' },
  sheet: {
    backgroundColor: '#121A28',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    maxHeight: '82%',
    padding: 16,
    paddingBottom: 24,
  },
  sheetHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sheetTitle: { color: '#F4F7FB', fontSize: 17, fontWeight: '800' },
  sortChoice: {
    alignItems: 'center',
    borderRadius: 9,
    flexDirection: 'row',
    minHeight: 43,
    paddingHorizontal: 11,
  },
  sortChoiceOn: { backgroundColor: '#17345B' },
  sortChoiceText: { color: '#DCE5F2', flex: 1, fontSize: 14, fontWeight: '700' },
  sortIcon: { color: '#DCE5F2', fontSize: 18, fontWeight: '700' },
  sortSheet: {
    backgroundColor: '#121A28',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    paddingBottom: 24,
  },
  toolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'flex-end',
    marginBottom: 5,
    minHeight: 29,
  },
  toolbarInline: { marginBottom: 0, minHeight: 28 },
  viewIcon: { color: '#DCE5F2', fontSize: 17, fontWeight: '700' },
});
