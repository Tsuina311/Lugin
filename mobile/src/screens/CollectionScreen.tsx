import { useEffect, useMemo, useState } from 'react';

import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  loadCollectionView,
  saveCollectionView,
  type CollectionViewShape,
} from '../data/collectionViewPreference';
import { libraryStore } from '../data/libraryStore';
import { useLibrary } from '../data/useLibrary';
import { CardThumb, collectionImageCandidates } from '../ui/CardThumb';
import { FlippableCardImage } from '../ui/FlippableCardImage';
import { peekCardImageCandidates, preloadCardImageCandidates } from '../ui/cardImageCache';

import { cardImageCandidates } from '@/lib/cardImage';
import { cardKey } from '@/lib/cardName';
import { buildCollection } from '@/lib/collection';
import type { CollectionCard } from '@/lib/collection';
import { printingIdentity } from '@/lib/collectionEdit';
import {
  cardPrintArtKey as artKey,
  cardPrintSupportsFoil as supportsFoil,
  cardPrintSupportsNonfoil as supportsPlain,
  collectionCardFromPrint,
  ownedCardPrintScore,
} from '@/lib/collectionPrintPicker';
import {
  collectionViewRows,
  type CollectionPrintingLine,
  type CollectionViewRow,
} from '@/lib/collectionView';
import { collectionValue, money, priceOf } from '@/lib/prices';
import { fetchCardPrints, type CardPrint } from '@/lib/prints';
import { searchCards } from '@/lib/search';

export function CollectionScreen() {
  const insets = useSafeAreaInsets();
  const library = useLibrary();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [remoteSuggestions, setRemoteSuggestions] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [view, setView] = useState<CollectionViewShape>('list');
  const [viewLoaded, setViewLoaded] = useState(false);
  const cards = library.data?.collection.value?.cards ?? [];
  const collection = useMemo(
    () => buildCollection(cards, library.data?.collection.value?.source ?? '', 'list'),
    [cards, library.data?.collection.value?.source],
  );
  const worth = useMemo(
    () => collectionValue(cards, library.prices.snapshot),
    [cards, library.prices.snapshot],
  );
  const allRows = useMemo(() => collectionViewRows(collection), [collection]);
  const rows = useMemo(() => {
    const needle = cardKey(query.trim());
    return needle ? allRows.filter(row => cardKey(row.name).includes(needle)) : allRows;
  }, [allRows, query]);
  const suggestionNeedle = query.trim();
  const canSuggest = suggestionNeedle.length >= 2;
  useEffect(() => {
    if (!canSuggest) {
      setRemoteSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchCards({ text: suggestionNeedle }, 10).then(
        response => {
          if (!cancelled) setRemoteSuggestions(response.cards.map(card => card.name));
        },
        () => {
          if (!cancelled) setRemoteSuggestions([]);
        },
      );
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [canSuggest, suggestionNeedle]);
  const suggestions = useMemo(() => {
    if (!canSuggest) return [];
    const key = cardKey(suggestionNeedle);
    const local = allRows.filter(row => cardKey(row.name).includes(key)).map(row => row.name);
    const seen = new Set<string>();
    const names: string[] = [];
    for (const name of [...local, ...remoteSuggestions]) {
      const id = cardKey(name);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      names.push(name);
    }
    return names
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .slice(0, 10);
  }, [allRows, canSuggest, remoteSuggestions, suggestionNeedle]);
  const exactSuggestion = suggestions.find(name => cardKey(name) === cardKey(suggestionNeedle));
  const addSuggestion = exactSuggestion ?? (suggestions.length === 1 ? suggestions[0] : null);
  const firstPictures = useMemo(
    () => rows.slice(0, view === 'box' ? 6 : 12).map(row => row.candidates),
    [rows, view],
  );
  const pictureBatchKey = firstPictures.map(group => group.join('\0')).join('\u0001');
  const [readyPictureBatch, setReadyPictureBatch] = useState<string | null>(null);
  const picturesReady =
    pictureBatchKey.length === 0 ||
    readyPictureBatch === pictureBatchKey ||
    firstPictures.every(group => group.length === 0 || peekCardImageCandidates(group));

  useEffect(() => {
    if (picturesReady || !pictureBatchKey) return;
    let cancelled = false;
    void Promise.all(firstPictures.map(preloadCardImageCandidates)).then(() => {
      if (!cancelled) setReadyPictureBatch(pictureBatchKey);
    });
    return () => {
      cancelled = true;
    };
  }, [firstPictures, pictureBatchKey, picturesReady]);

  useEffect(() => {
    let cancelled = false;
    void loadCollectionView().then(saved => {
      if (!cancelled) {
        setView(saved);
        setViewLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (viewLoaded) void saveCollectionView(view);
  }, [view, viewLoaded]);

  const open = cards.find(card => printingIdentity(card) === selected) ?? null;
  const toggleExpanded = (key: string) => {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <Pressable
      onPress={() => {
        if (open) setSelected(null);
      }}
      style={[styles.root, { paddingTop: insets.top + 12 }]}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Collection</Text>
        <Text numberOfLines={1} style={styles.headerMeta}>
          {collection.totalCards.toLocaleString()} cards
          {worth.copies > 0 ? ` · ${money(worth.cents)}` : ''}
          {query ? ` · ${rows.length.toLocaleString()} matching` : ''}
        </Text>
      </View>
      {library.status === 'choose-sync' ? <SyncLine /> : null}
      <View style={styles.searchRow}>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setQuery}
          placeholder="Search your collection"
          placeholderTextColor="#6E7B91"
          style={[styles.input, styles.searchInput]}
          value={query}
        />
        <Pressable
          accessibilityLabel="Add this card"
          disabled={!addSuggestion}
          onPress={() => {
            if (addSuggestion) setAdding(addSuggestion);
          }}
          style={[styles.addButton, styles.searchAdd, !addSuggestion && styles.buttonDisabled]}
        >
          <Text style={styles.searchAddLabel}>+</Text>
        </Pressable>
        <CollectionViewToggle onChange={setView} value={view} />
      </View>
      {suggestions.length > 0 ? (
        <ScrollView
          contentContainerStyle={styles.suggestions}
          horizontal
          keyboardShouldPersistTaps="always"
          showsHorizontalScrollIndicator={false}
          style={styles.suggestionScroll}
        >
          {suggestions.map(name => {
            const owned = collection.byKey[cardKey(name)]?.total ?? 0;
            return (
              <Pressable
                key={name}
                onPress={(event: GestureResponderEvent) => {
                  event.stopPropagation();
                  setQuery(name);
                  setAdding(name);
                }}
                style={[styles.suggestion, owned > 0 && styles.suggestionOwned]}
              >
                <Text
                  numberOfLines={1}
                  style={[styles.suggestionLabel, owned > 0 && styles.suggestionLabelOwned]}
                >
                  {name}
                  {owned > 0 ? ` · ${owned}` : ''}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      {picturesReady ? (
        <FlatList
          key={view}
          ListEmptyComponent={
            <Text style={styles.empty}>
              {library.status === 'boot'
                ? 'Opening the library…'
                : query
                  ? `Nothing in your collection matches “${query}”.`
                  : 'No cards yet. Add one, scan one, or connect Drive.'}
            </Text>
          }
          columnWrapperStyle={view === 'box' ? styles.gridColumns : undefined}
          data={rows}
          initialNumToRender={view === 'box' ? 6 : 12}
          keyExtractor={row => row.key}
          keyboardShouldPersistTaps="handled"
          numColumns={view === 'box' ? 2 : 1}
          renderItem={({ item }) =>
            view === 'box' ? (
              <CollectionGridCard
                onOpen={() => setSelected(printingIdentity(item.representative))}
                row={item}
              />
            ) : (
              <CollectionListRow
                expanded={expanded.has(item.key)}
                onOpen={card => setSelected(printingIdentity(card))}
                onToggle={() => toggleExpanded(item.key)}
                row={item}
              />
            )
          }
          style={styles.list}
          windowSize={5}
        />
      ) : (
        <View style={styles.list}>
          <Text style={styles.empty}>Preparing card pictures…</Text>
        </View>
      )}
      {open ? <Detail card={open} onClose={() => setSelected(null)} /> : null}
      {adding ? (
        <AddCardModal
          name={adding}
          onAdded={() => {
            setAdding(null);
            setQuery('');
          }}
          onClose={() => setAdding(null)}
        />
      ) : null}
    </Pressable>
  );
}

const SyncLine = () => {
  return (
    <View style={styles.syncRow}>
      <Text style={styles.sync}>Phone and Drive both have a library</Text>
      <View style={styles.syncActions}>
        <Pressable
          onPress={() => void libraryStore.replacePhoneWithDrive()}
          style={styles.syncButton}
        >
          <Text style={styles.syncButtonLabel}>Use Drive</Text>
        </Pressable>
        <Pressable onPress={() => void libraryStore.uploadPhoneCopy()} style={styles.syncButton}>
          <Text style={styles.syncButtonLabel}>Upload phone</Text>
        </Pressable>
      </View>
    </View>
  );
};

const printImageCandidates = (print: CardPrint): string[] =>
  cardImageCandidates({
    collectorNumber: print.collectorNumber,
    imageUrl: print.imageUrl,
    productId: print.cardmarketId != null ? String(print.cardmarketId) : undefined,
    scryfallId: print.id,
    setCode: print.setCode,
  });

const AddCardModal = ({
  name,
  onAdded,
  onClose,
}: {
  name: string;
  onAdded: () => void;
  onClose: () => void;
}) => {
  const library = useLibrary();
  const collectionCards = library.data?.collection.value?.cards;
  const ownedCards = useMemo(
    () => (collectionCards ?? []).filter(card => cardKey(card.name) === cardKey(name)),
    [collectionCards, name],
  );
  const [prints, setPrints] = useState<CardPrint[]>([]);
  const [selectedArt, setSelectedArt] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [foil, setFoil] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchCardPrints(name).then(
      found => {
        if (cancelled) return;
        const ordered = [...found].sort(
          (a, b) => ownedCardPrintScore(b, ownedCards) - ownedCardPrintScore(a, ownedCards),
        );
        setPrints(ordered);
        const first = ordered[0] ?? null;
        setSelectedArt(first ? artKey(first) : null);
        setSelectedId(first?.id ?? null);
        setFoil(first ? !supportsPlain(first) && supportsFoil(first) : false);
        setLoading(false);
      },
      reason => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
        setLoading(false);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [name, ownedCards]);

  const arts = useMemo(() => {
    const unique = new Map<string, CardPrint>();
    for (const print of prints) {
      const key = artKey(print);
      if (!unique.has(key)) unique.set(key, print);
    }
    return [...unique.entries()].map(([key, print]) => ({ key, print }));
  }, [prints]);
  const editions = useMemo(
    () => prints.filter(print => !selectedArt || artKey(print) === selectedArt),
    [prints, selectedArt],
  );
  const selected = editions.find(print => print.id === selectedId) ?? null;
  const chooseArt = (key: string) => {
    const first = prints.find(print => artKey(print) === key) ?? null;
    setSelectedArt(key);
    setSelectedId(first?.id ?? null);
    setFoil(first ? !supportsPlain(first) && supportsFoil(first) : false);
  };
  const choose = (print: CardPrint) => {
    setSelectedId(print.id);
    if (foil && !supportsFoil(print)) setFoil(false);
    if (!foil && !supportsPlain(print)) setFoil(true);
  };
  const add = () => {
    if (!selected || saving) return;
    setSaving(true);
    void libraryStore
      .addCollectionCard(collectionCardFromPrint(name, selected, foil))
      .then(onAdded, reason => {
        setError(reason instanceof Error ? reason.message : String(reason));
        setSaving(false);
      });
  };

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible>
      <Pressable onPress={onClose} style={styles.modalBackdrop}>
        <Pressable
          onPress={(event: GestureResponderEvent) => event.stopPropagation()}
          style={styles.addModal}
        >
          <Text numberOfLines={2} style={styles.addModalTitle}>
            {name}
          </Text>
          <Text style={styles.addModalHint}>Choose the edition you own</Text>
          {loading ? (
            <ActivityIndicator color="#9EC1FF" size="large" style={styles.addModalLoading} />
          ) : error ? (
            <Text selectable style={styles.addModalError}>
              {error}
            </Text>
          ) : prints.length === 0 ? (
            <Text style={styles.addModalHint}>No exact card or editions found.</Text>
          ) : (
            <>
              {arts.length > 1 ? (
                <>
                  <Text style={styles.pickerSectionLabel}>Choose art</Text>
                  <ScrollView
                    contentContainerStyle={styles.artChoices}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.artChoiceScroll}
                  >
                    {arts.map(art => (
                      <Pressable
                        key={art.key}
                        accessibilityLabel={`Choose artwork from ${art.print.setName}`}
                        onPress={() => chooseArt(art.key)}
                        style={[
                          styles.artChoice,
                          prints.some(
                            print =>
                              artKey(print) === art.key &&
                              ownedCardPrintScore(print, ownedCards) > 0,
                          ) && styles.artChoiceOwned,
                          art.key === selectedArt && styles.artChoicePicked,
                        ]}
                      >
                        <CardThumb
                          candidates={printImageCandidates(art.print)}
                          style={styles.artChoiceImage}
                        />
                        {prints.some(
                          print =>
                            artKey(print) === art.key && ownedCardPrintScore(print, ownedCards) > 0,
                        ) ? (
                          <Text style={styles.artOwnedLabel}>Owned</Text>
                        ) : null}
                      </Pressable>
                    ))}
                  </ScrollView>
                </>
              ) : null}
              <Text style={styles.pickerSectionLabel}>Choose edition</Text>
              <FlatList
                data={editions}
                initialNumToRender={8}
                keyExtractor={print => print.id}
                renderItem={({ item }) => {
                  const picked = item.id === selectedId;
                  return (
                    <Pressable
                      onPress={() => choose(item)}
                      style={[styles.printChoice, picked && styles.printChoicePicked]}
                    >
                      <View style={styles.rowText}>
                        <Text numberOfLines={1} style={styles.printChoiceName}>
                          {item.setName}
                        </Text>
                        <Text style={styles.meta}>
                          {item.setCode.toUpperCase()} · #{item.collectorNumber}
                          {item.releasedAt ? ` · ${item.releasedAt.slice(0, 4)}` : ''}
                        </Text>
                      </View>
                      {picked ? <Text style={styles.printChoiceCheck}>✓</Text> : null}
                    </Pressable>
                  );
                }}
                style={styles.printChoices}
                windowSize={5}
              />
            </>
          )}
          {selected ? (
            <View style={styles.finishPicker}>
              <Pressable
                disabled={!supportsPlain(selected)}
                onPress={() => setFoil(false)}
                style={[
                  styles.finishChoice,
                  !foil && styles.finishChoicePicked,
                  !supportsPlain(selected) && styles.buttonDisabled,
                ]}
              >
                <Text style={styles.finishChoiceLabel}>☆ Nonfoil</Text>
              </Pressable>
              <Pressable
                disabled={!supportsFoil(selected)}
                onPress={() => setFoil(true)}
                style={[
                  styles.finishChoice,
                  foil && styles.finishChoicePicked,
                  !supportsFoil(selected) && styles.buttonDisabled,
                ]}
              >
                <Text style={[styles.finishChoiceLabel, styles.finishStarFoil]}>★ Foil</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={styles.addModalActions}>
            <Pressable onPress={onClose} style={styles.syncButton}>
              <Text style={styles.syncButtonLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              disabled={!selected || saving}
              onPress={add}
              style={[
                styles.addButton,
                styles.confirmAdd,
                (!selected || saving) && styles.buttonDisabled,
              ]}
            >
              <Text style={styles.addLabel}>{saving ? 'Adding…' : 'Add to collection'}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const QuantityStepper = ({
  onChange,
  quantity,
}: {
  onChange: (quantity: number) => void;
  quantity: number;
}) => (
  <View style={styles.inlineStepper}>
    <Pressable
      accessibilityLabel="One fewer"
      hitSlop={4}
      onPress={(event: GestureResponderEvent) => {
        event.stopPropagation();
        onChange(quantity - 1);
      }}
      style={styles.inlineStep}
    >
      <Text style={styles.inlineStepLabel}>−</Text>
    </Pressable>
    <Text style={styles.inlineQuantity}>{quantity}</Text>
    <Pressable
      accessibilityLabel="One more"
      hitSlop={4}
      onPress={(event: GestureResponderEvent) => {
        event.stopPropagation();
        onChange(quantity + 1);
      }}
      style={styles.inlineStep}
    >
      <Text style={styles.inlineStepLabel}>+</Text>
    </Pressable>
  </View>
);

const CollectionListRow = ({
  expanded,
  onOpen,
  onToggle,
  row,
}: {
  expanded: boolean;
  onOpen: (card: CollectionCard) => void;
  onToggle: () => void;
  row: CollectionViewRow;
}) => {
  const library = useLibrary();
  const canExpand = row.printings.length > 1;
  const open = canExpand && expanded;
  const price = library.prices.snapshot
    ? priceOf(row.representative, library.prices.snapshot)
    : null;
  return (
    <View>
      <Pressable
        onPress={(event: GestureResponderEvent) => {
          event.stopPropagation();
          onOpen(row.representative);
        }}
        style={styles.row}
      >
        {canExpand ? (
          <Pressable
            accessibilityLabel={
              open ? `Hide printings of ${row.name}` : `Show printings of ${row.name}`
            }
            onPress={(event: GestureResponderEvent) => {
              event.stopPropagation();
              onToggle();
            }}
            style={styles.expandButton}
          >
            <Text style={[styles.expandLabel, open && styles.expandLabelOpen]}>›</Text>
          </Pressable>
        ) : (
          <View style={styles.expandButton} />
        )}
        <CardThumb candidates={row.candidates} style={styles.thumb} />
        <View style={styles.rowText}>
          <View style={styles.rowNameLine}>
            <Text numberOfLines={1} style={[styles.name, styles.rowName]}>
              {row.name}
            </Text>
            <Text
              accessibilityLabel={row.foil > 0 ? `${row.foil} foil copies` : 'Nonfoil'}
              style={[styles.finishStar, row.foil > 0 && styles.finishStarFoil]}
            >
              {row.foil > 0 ? '★' : '☆'}
            </Text>
          </View>
        </View>
        <View style={styles.rowStats}>
          {price ? <Text style={styles.rowPrice}>{money(price.cents)}</Text> : null}
          {open ? (
            <Text style={styles.qty}>×{row.total}</Text>
          ) : (
            <QuantityStepper
              onChange={quantity => void libraryStore.setQuantity(row.key, quantity, row.name)}
              quantity={row.total}
            />
          )}
        </View>
      </Pressable>
      {open ? (
        <View style={styles.printings}>
          {row.printings.map(printing => (
            <CollectionPrintingRow
              key={printing.identity}
              onOpen={() => onOpen(printing.card)}
              printing={printing}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
};

const CollectionPrintingRow = ({
  onOpen,
  printing,
}: {
  onOpen: () => void;
  printing: CollectionPrintingLine;
}) => (
  <Pressable
    onPress={(event: GestureResponderEvent) => {
      event.stopPropagation();
      onOpen();
    }}
    style={styles.printingRow}
  >
    <CardThumb candidates={printing.candidates} style={styles.printingThumb} />
    <View style={styles.rowText}>
      <Text numberOfLines={1} style={styles.printingName}>
        {printing.edition}
      </Text>
      <Text
        accessibilityLabel={printing.foil ? 'Foil' : 'Nonfoil'}
        style={[styles.finishStar, printing.foil && styles.finishStarFoil]}
      >
        {printing.foil ? '★' : '☆'}
      </Text>
    </View>
    <QuantityStepper
      onChange={quantity => void libraryStore.setPrintingQuantity(printing.identity, quantity)}
      quantity={printing.quantity}
    />
  </Pressable>
);

const CollectionGridCard = ({ onOpen, row }: { onOpen: () => void; row: CollectionViewRow }) => {
  const library = useLibrary();
  const price = library.prices.snapshot
    ? priceOf(row.representative, library.prices.snapshot)
    : null;
  return (
    <View style={styles.gridCard}>
      <Pressable
        onPress={(event: GestureResponderEvent) => {
          event.stopPropagation();
          onOpen();
        }}
      >
        <CardThumb candidates={row.candidates} style={styles.gridImage} />
      </Pressable>
      <Text numberOfLines={1} style={styles.gridName}>
        {row.name}
      </Text>
      <View style={styles.gridMeta}>
        <Text style={[styles.finishStar, row.foil > 0 && styles.finishStarFoil]}>
          {row.foil > 0 ? '★' : '☆'}
          {row.foil > 0 ? ` ${row.foil}` : ''}
        </Text>
        {price ? <Text style={styles.rowPrice}>{money(price.cents)}</Text> : null}
      </View>
      <QuantityStepper
        onChange={quantity => void libraryStore.setQuantity(row.key, quantity, row.name)}
        quantity={row.total}
      />
    </View>
  );
};

const CollectionViewToggle = ({
  onChange,
  value,
}: {
  onChange: (view: CollectionViewShape) => void;
  value: CollectionViewShape;
}) => (
  <View accessibilityLabel="Collection layout" style={styles.viewToggle}>
    {(['list', 'box'] as const).map(shape => (
      <Pressable
        key={shape}
        accessibilityLabel={shape === 'list' ? 'Show as rows' : 'Show as card images'}
        accessibilityState={{ selected: value === shape }}
        onPress={() => onChange(shape)}
        style={[styles.viewButton, value === shape && styles.viewButtonActive]}
      >
        <Text style={[styles.viewIcon, value === shape && styles.viewIconActive]}>
          {shape === 'list' ? '☷' : '▦'}
        </Text>
      </Pressable>
    ))}
  </View>
);

const Detail = ({ card, onClose }: { card: CollectionCard; onClose: () => void }) => {
  const library = useLibrary();
  const identity = printingIdentity(card);
  const override = library.data?.printings.value?.[cardKey(card.name)];
  const remove = () =>
    Alert.alert('Remove card', `Remove every copy of ${card.name}?`, [
      { style: 'cancel', text: 'Cancel' },
      {
        onPress: () => {
          void libraryStore.deletePrinting(identity);
          onClose();
        },
        style: 'destructive',
        text: 'Remove all',
      },
    ]);
  return (
    <Pressable
      accessibilityLabel={`${card.name} details`}
      onPress={(event: GestureResponderEvent) => event.stopPropagation()}
      style={styles.detail}
    >
      <Pressable accessibilityLabel="Close card preview" onPress={onClose}>
        <FlippableCardImage
          candidates={collectionImageCandidates(card, override)}
          name={card.name}
          style={styles.detailImage}
        />
      </Pressable>
      <View style={styles.stepper}>
        <Text
          accessibilityLabel={card.foil ? 'Foil' : 'Nonfoil'}
          style={[styles.detailFinish, card.foil && styles.finishStarFoil]}
        >
          {card.foil ? '★' : '☆'}
        </Text>
        <Pressable
          accessibilityLabel="Remove one copy"
          onPress={() => void libraryStore.setPrintingQuantity(identity, card.quantity - 1)}
          style={styles.step}
        >
          <Text style={styles.stepLabel}>−</Text>
        </Pressable>
        <View style={styles.detailQuantity}>
          <Text style={styles.qty}>{card.quantity}</Text>
        </View>
        <Pressable
          accessibilityLabel="Add one copy"
          onPress={() => void libraryStore.setPrintingQuantity(identity, card.quantity + 1)}
          style={styles.step}
        >
          <Text style={styles.stepLabel}>+</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Remove every copy"
          onPress={remove}
          style={[styles.step, styles.trashButton]}
        >
          <TrashIcon />
        </Pressable>
      </View>
    </Pressable>
  );
};

const TrashIcon = () => (
  <View
    accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
    style={styles.trashIcon}
  >
    <View style={styles.trashHandle} />
    <View style={styles.trashLid} />
    <View style={styles.trashCan} />
  </View>
);

const styles = StyleSheet.create({
  addButton: {
    backgroundColor: '#3D7EFF',
    borderRadius: 8,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  addLabel: { color: '#fff', fontWeight: '700' },
  addModal: {
    backgroundColor: '#121A28',
    borderColor: '#243044',
    borderRadius: 18,
    borderWidth: 1,
    maxHeight: '86%',
    padding: 14,
    width: '92%',
  },
  addModalActions: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
    marginTop: 12,
  },
  addModalError: { color: '#E06A6A', marginVertical: 18, textAlign: 'center' },
  addModalHint: { color: '#8A97AD', fontSize: 13, marginBottom: 10, textAlign: 'center' },
  addModalLoading: { marginVertical: 36 },
  addModalTitle: {
    color: '#F4F7FB',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  artChoice: {
    borderColor: 'transparent',
    borderRadius: 9,
    borderWidth: 2,
    padding: 2,
    position: 'relative',
  },
  artChoiceImage: {
    backgroundColor: '#1C2636',
    borderRadius: 6,
    height: 112,
    width: 80,
  },
  artChoiceOwned: { borderColor: '#37A668' },
  artChoicePicked: { borderColor: '#3D7EFF' },
  artChoiceScroll: { flexGrow: 0, marginBottom: 10, maxHeight: 120 },
  artChoices: { gap: 8, paddingHorizontal: 1 },
  artOwnedLabel: {
    backgroundColor: 'rgba(11,18,32,0.9)',
    bottom: 5,
    color: '#71D49B',
    fontSize: 10,
    fontWeight: '700',
    left: 5,
    paddingHorizontal: 4,
    paddingVertical: 2,
    position: 'absolute',
  },
  buttonDisabled: { opacity: 0.4 },
  confirmAdd: { minHeight: 38 },
  detail: {
    alignItems: 'center',
    backgroundColor: '#121A28',
    borderColor: '#243044',
    borderRadius: 16,
    borderWidth: 1,
    bottom: 8,
    left: '50%',
    marginLeft: -128,
    paddingBottom: 10,
    paddingHorizontal: 8,
    paddingTop: 8,
    position: 'absolute',
    shadowColor: '#000',
    shadowOffset: { height: -4, width: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    width: 256,
    zIndex: 10,
  },
  detailFinish: {
    color: '#8A97AD',
    fontSize: 22,
    lineHeight: 24,
    textAlign: 'center',
    width: 24,
  },
  detailImage: {
    backgroundColor: '#1C2636',
    borderRadius: 10,
    height: 335,
    width: 240,
  },
  detailQuantity: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    minWidth: 36,
  },
  empty: { color: '#8A97AD', marginTop: 24, textAlign: 'center' },
  expandButton: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 24,
  },
  expandLabel: { color: '#8A97AD', fontSize: 22, transform: [{ rotate: '0deg' }] },
  expandLabelOpen: { transform: [{ rotate: '90deg' }] },
  finishChoice: {
    alignItems: 'center',
    borderColor: '#243044',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 9,
  },
  finishChoiceLabel: { color: '#C5D0DE', fontSize: 13, fontWeight: '700' },
  finishChoicePicked: { backgroundColor: 'rgba(61,126,255,0.18)', borderColor: '#3D7EFF' },
  finishPicker: { flexDirection: 'row', gap: 8, marginTop: 10 },
  finishStar: { color: '#8A97AD', fontSize: 13, lineHeight: 15 },
  finishStarFoil: { color: '#F4C95D' },
  gridCard: {
    flex: 1,
    gap: 5,
    marginBottom: 14,
    maxWidth: '49%',
  },
  gridColumns: { gap: 10 },
  gridImage: {
    aspectRatio: 488 / 680,
    backgroundColor: '#1C2636',
    borderRadius: 8,
    width: '100%',
  },
  gridMeta: { flexDirection: 'row', justifyContent: 'space-between' },
  gridName: { color: '#F4F7FB', fontSize: 13, fontWeight: '700' },
  header: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  headerMeta: { color: '#8A97AD', flex: 1, fontSize: 12, textAlign: 'right' },
  inlineQuantity: {
    color: '#F4F7FB',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
    textAlign: 'center',
    width: 22,
  },
  inlineStep: {
    alignItems: 'center',
    borderRadius: 6,
    height: 30,
    justifyContent: 'center',
    width: 28,
  },
  inlineStepLabel: { color: '#C5D0DE', fontSize: 19, lineHeight: 21 },
  inlineStepper: {
    alignItems: 'center',
    backgroundColor: '#121A28',
    borderRadius: 8,
    flexDirection: 'row',
  },
  input: {
    backgroundColor: '#121A28',
    borderRadius: 8,
    color: '#F4F7FB',
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  list: { flex: 1 },
  meta: { color: '#8A97AD', fontSize: 12 },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(4,8,15,0.78)',
    flex: 1,
    justifyContent: 'center',
  },
  name: { color: '#F4F7FB', fontSize: 16, fontWeight: '700' },
  pickerSectionLabel: {
    color: '#C5D0DE',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
    marginTop: 2,
  },
  printChoice: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 6,
    padding: 7,
  },
  printChoiceCheck: { color: '#9EC1FF', fontSize: 20, fontWeight: '700' },
  printChoiceImage: {
    backgroundColor: '#1C2636',
    borderRadius: 4,
    height: 70,
    width: 50,
  },
  printChoiceName: { color: '#F4F7FB', fontSize: 14, fontWeight: '700' },
  printChoicePicked: {
    backgroundColor: 'rgba(61,126,255,0.12)',
    borderColor: '#3D7EFF',
  },
  printChoices: { flexGrow: 0, maxHeight: 390 },
  printingName: { color: '#C5D0DE', fontSize: 13 },
  printingRow: {
    alignItems: 'center',
    borderBottomColor: 'rgba(36,48,68,0.65)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 9,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  printingThumb: { backgroundColor: '#1C2636', borderRadius: 3, height: 38, width: 27 },
  printings: {
    backgroundColor: 'rgba(18,26,40,0.72)',
    borderLeftColor: '#243044',
    borderLeftWidth: 2,
    marginLeft: 18,
  },
  qty: { color: '#F4F7FB', fontSize: 16, fontVariant: ['tabular-nums'], fontWeight: '700' },
  root: { backgroundColor: '#0B1220', flex: 1, paddingHorizontal: 16 },
  row: {
    alignItems: 'center',
    borderBottomColor: '#1C2636',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 8,
  },
  rowName: { flex: 1 },
  rowNameLine: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  rowPrice: { color: '#9EC1FF', fontSize: 13, fontWeight: '700' },
  rowStats: { alignItems: 'flex-end', gap: 3 },
  rowText: { flex: 1, gap: 2 },
  searchAdd: { alignItems: 'center', height: 42, paddingHorizontal: 0, width: 42 },
  searchAddLabel: { color: '#FFFFFF', fontSize: 26, lineHeight: 28 },
  searchInput: { flex: 1, marginBottom: 0 },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  step: {
    alignItems: 'center',
    backgroundColor: '#1C2636',
    borderRadius: 8,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  stepLabel: { color: '#F4F7FB', fontSize: 20 },
  stepper: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    marginTop: 10,
  },
  suggestion: {
    borderColor: '#243044',
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: 220,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  suggestionLabel: { color: '#C5D0DE', fontSize: 12 },
  suggestionLabelOwned: { color: '#71D49B' },
  suggestionOwned: {
    backgroundColor: 'rgba(55,166,104,0.12)',
    borderColor: 'rgba(55,166,104,0.45)',
  },
  suggestionScroll: { flexGrow: 0, marginBottom: 8 },
  suggestions: { gap: 6 },
  sync: { color: '#9EC1FF', fontSize: 12 },
  syncActions: { flexDirection: 'row', gap: 8 },
  syncButton: {
    backgroundColor: '#1C2636',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  syncButtonLabel: { color: '#E8EEF7', fontSize: 12, fontWeight: '700' },
  syncRow: { gap: 8, marginBottom: 8 },
  thumb: { backgroundColor: '#1C2636', borderRadius: 4, height: 46, width: 32 },
  title: { color: '#F4F7FB', fontSize: 22, fontWeight: '700' },
  trashButton: { backgroundColor: 'rgba(224,106,106,0.14)', marginLeft: 4 },
  trashCan: {
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    borderColor: '#E06A6A',
    borderTopWidth: 0,
    borderWidth: 2,
    height: 13,
    width: 12,
  },
  trashHandle: {
    backgroundColor: '#E06A6A',
    borderRadius: 1,
    height: 2,
    marginBottom: 1,
    width: 6,
  },
  trashIcon: { alignItems: 'center', height: 20, justifyContent: 'center', width: 20 },
  trashLid: { backgroundColor: '#E06A6A', borderRadius: 1, height: 2, width: 16 },
  value: { color: '#F4F7FB', fontSize: 14, fontWeight: '600' },
  version: { color: '#9EC1FF', fontSize: 16, fontWeight: '700' },
  viewButton: {
    alignItems: 'center',
    height: 42,
    justifyContent: 'center',
    width: 40,
  },
  viewButtonActive: { backgroundColor: '#3D7EFF' },
  viewIcon: { color: '#8A97AD', fontSize: 21 },
  viewIconActive: { color: '#FFFFFF' },
  viewToggle: {
    borderColor: '#243044',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    overflow: 'hidden',
  },
});
