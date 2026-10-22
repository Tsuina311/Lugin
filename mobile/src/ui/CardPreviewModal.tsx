import { Modal, Pressable, StyleSheet, Text, useWindowDimensions } from 'react-native';

import { CardThumb } from './CardThumb';

export const CardPreviewModal = ({
  candidates,
  name,
  onClose,
}: {
  candidates: readonly string[];
  name: string;
  onClose: () => void;
}) => {
  const window = useWindowDimensions();
  const ratio = 680 / 488;
  const height = Math.min(window.height - 100, (window.width - 36) * ratio, 544);
  const width = height / ratio;

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible>
      <Pressable onPress={onClose} style={styles.backdrop}>
        <Pressable
          accessibilityLabel={`Close image for ${name}`}
          onPress={onClose}
          style={styles.card}
        >
          <CardThumb candidates={candidates} style={[styles.image, { height, width }]} />
        </Pressable>
        <Text style={styles.hint}>Tap the card or outside to close</Text>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
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
});
