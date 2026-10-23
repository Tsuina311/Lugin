export type DeckBrowseSort = 'mana' | 'name' | 'owned' | 'type';
export type DeckBrowseView = 'grid' | 'list';

export interface DeckBrowseState {
  mana: number | null;
  query: string;
  sort: DeckBrowseSort;
  type: string | null;
  view: DeckBrowseView;
}

export interface DeckBrowseFacts {
  cmc?: number;
  land?: boolean;
  name: string;
  owned?: number;
  tags?: readonly string[];
  typeLine?: string;
}

export const DEFAULT_DECK_BROWSE: DeckBrowseState = {
  mana: null,
  query: '',
  sort: 'name',
  type: null,
  view: 'list',
};

export const applyDeckBrowse = <T>(
  items: readonly T[],
  factsOf: (item: T) => DeckBrowseFacts,
  state: DeckBrowseState,
): T[] => {
  const needle = state.query.trim().toLocaleLowerCase();
  const filtered = items.filter(item => {
    const facts = factsOf(item);
    if (state.mana != null) {
      if (facts.cmc == null) return false;
      if (state.mana === 7 ? facts.cmc < 7 : Math.floor(facts.cmc) !== state.mana) return false;
    }
    if (state.type && !facts.typeLine?.toLocaleLowerCase().includes(state.type.toLocaleLowerCase())) {
      return false;
    }
    if (needle) {
      const haystack = [facts.name, facts.typeLine, ...(facts.tags ?? [])]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
  return filtered.sort((a, b) => {
    const left = factsOf(a);
    const right = factsOf(b);
    if (state.sort === 'mana') {
      if (left.land !== right.land) return left.land ? 1 : -1;
      return (left.cmc ?? 998) - (right.cmc ?? 998) || left.name.localeCompare(right.name);
    }
    if (state.sort === 'owned') {
      return (right.owned ?? 0) - (left.owned ?? 0) || left.name.localeCompare(right.name);
    }
    if (state.sort === 'type') {
      return (
        (left.typeLine ?? 'Unknown').localeCompare(right.typeLine ?? 'Unknown') ||
        left.name.localeCompare(right.name)
      );
    }
    return left.name.localeCompare(right.name);
  });
};
