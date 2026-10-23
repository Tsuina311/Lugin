import { Modal, Pressable, StyleSheet, Text, useWindowDimensions } from 'react-native';

import { FlippableCardImage } from './FlippableCardImage';

export const CardPreviewModal = ({
  candidates,
  faceImages,
  name,
  onAdd,
  onClose,
  onOtherEdition,
  placeholderCandidates,
}: {
  candidates: readonly string[];
  faceImages?: readonly string[];
  name: string;
  onAdd?: () => void;
  onClose: () => void;
  onOtherEdition?: () => void;
  placeholderCandidates?: readonly string[];
}) => {
  const window = useWindowDimensions();
  const ratio = 680 / 488;
  const actionable = Boolean(onAdd || onOtherEdition);
  const height = Math.min(
    window.height - (actionable ? 170 : 100),
    (window.width - 36) * ratio,
    544,
  );
  const width = height / ratio;

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible>
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable
          accessibilityLabel={`Close image for ${name}`}
          onPress={onClose}
          style={styles.card}
        >
          <FlippableCardImage
            candidates={candidates}
            faceImages={faceImages}
            name={name}
            placeholderCandidates={placeholderCandidates}
            style={[styles.image, { height, width }]}
          />
        </Pressable>
        {actionable ? (
          <Pressable onPress={event => event.stopPropagation()} style={styles.actions}>
            {onOtherEdition ? (
              <Pressable onPress={onOtherEdition} style={styles.secondary}>
                <Text style={styles.secondaryText}>Other edition</Text>
              </Pressable>
            ) : null}
            {onAdd ? (
              <Pressable onPress={onAdd} style={styles.primary}>
                <Text style={styles.primaryText}>Add</Text>
              </Pressable>
            ) : null}
          </Pressable>
        ) : (
          <Text style={styles.hint}>Tap the card or outside to close</Text>
        )}
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 10, marginTop: 12, width: '100%' },
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.84)',
    flex: 1,
    justifyContent: 'center',
    padding: 18,
  },
  card: {
    borderRadius: 14,
    elevation: 12,
    overflow: 'hidden',
  },
  hint: { color: '#AAB6C9', fontSize: 12, marginTop: 12 },
  image: { backgroundColor: '#1C2636', borderRadius: 14 },
  primary: {
    alignItems: 'center',
    backgroundColor: '#3D7EFF',
    borderRadius: 9,
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  primaryText: { color: '#FFFFFF', fontWeight: '800' },
  secondary: {
    alignItems: 'center',
    backgroundColor: '#1C2636',
    borderRadius: 9,
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  secondaryText: { color: '#E8EEF7', fontWeight: '700' },
});
