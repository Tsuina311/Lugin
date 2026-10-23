import { useEffect, useRef, useState } from 'react';

import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { CardThumb } from './CardThumb';

import { goldfishZoomUrl } from '@/lib/goldfishImages';
import { searchExactCard } from '@/lib/search';

export const FlippableCardImage = ({
  candidates,
  faceImages,
  name,
  placeholderCandidates = [],
  style,
}: {
  candidates: readonly string[];
  faceImages?: readonly string[];
  name: string;
  placeholderCandidates?: readonly string[];
  style: StyleProp<ViewStyle>;
}) => {
  const [faces, setFaces] = useState<readonly string[]>(
    faceImages && faceImages.length >= 2 ? faceImages : [],
  );
  const [back, setBack] = useState(false);
  const faceKey = faceImages?.join('\0') ?? '';
  const placeholderKey = placeholderCandidates.join('\0');
  const zoomCandidates = candidates.reduce<string[]>((out, url) => {
    const zoom = goldfishZoomUrl(url);
    if (!out.includes(zoom)) out.push(zoom);
    if (!out.includes(url)) out.push(url);
    return out;
  }, []);
  for (const url of placeholderCandidates) {
    if (url && !zoomCandidates.includes(url)) zoomCandidates.push(url);
  }
  const sharpKey = zoomCandidates.join('\0');
  const progressive = placeholderCandidates.length > 0;
  const [showPlaceholder, setShowPlaceholder] = useState(progressive);
  const sharpOpacity = useRef(new Animated.Value(progressive ? 0 : 1)).current;
  const revealed = useRef(!progressive);
  const removeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (removeTimer.current) clearTimeout(removeTimer.current);
    revealed.current = !progressive;
    setShowPlaceholder(progressive);
    sharpOpacity.setValue(progressive ? 0 : 1);
    return () => {
      if (removeTimer.current) clearTimeout(removeTimer.current);
      sharpOpacity.stopAnimation();
    };
  }, [placeholderKey, progressive, sharpKey, sharpOpacity]);

  const revealSharp = (url: string): void => {
    if (placeholderCandidates.includes(url)) return;
    if (revealed.current) return;
    revealed.current = true;
    Animated.timing(sharpOpacity, {
      duration: 180,
      toValue: 1,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) removeTimer.current = setTimeout(() => setShowPlaceholder(false), 120);
    });
  };

  useEffect(() => {
    let cancelled = false;
    setBack(false);
    if (faceImages && faceImages.length >= 2) {
      setFaces(faceImages);
      return;
    }
    setFaces([]);
    void searchExactCard(name).then(
      card => {
        if (!cancelled && card?.faceImages && card.faceImages.length >= 2) {
          setFaces(card.faceImages);
        }
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [faceKey, faceImages, name]);

  return (
    <View style={[styles.frame, style]}>
      {back && faces[1] ? (
        <CardThumb candidates={[faces[1]]} style={styles.image} />
      ) : progressive ? (
        <>
          {showPlaceholder ? (
            <CardThumb candidates={placeholderCandidates} style={styles.image} />
          ) : null}
          <Animated.View
            pointerEvents="none"
            style={[styles.sharpLayer, { opacity: sharpOpacity }]}
          >
            <CardThumb candidates={zoomCandidates} onReady={revealSharp} style={styles.image} />
          </Animated.View>
        </>
      ) : (
        <CardThumb candidates={zoomCandidates} style={styles.image} />
      )}
      {faces.length >= 2 ? (
        <Pressable
          accessibilityLabel={back ? `Show front of ${name}` : `Show back of ${name}`}
          onPress={(event: GestureResponderEvent) => {
            event.stopPropagation();
            setBack(value => !value);
          }}
          style={styles.flip}
        >
          <Text style={styles.flipIcon}>↻</Text>
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  flip: {
    alignItems: 'center',
    backgroundColor: 'rgba(8, 13, 22, 0.88)',
    borderColor: 'rgba(255,255,255,0.32)',
    borderRadius: 18,
    borderWidth: 1,
    bottom: 8,
    height: 36,
    justifyContent: 'center',
    position: 'absolute',
    right: 8,
    width: 36,
  },
  flipIcon: { color: '#FFFFFF', fontSize: 23, fontWeight: '800', lineHeight: 25 },
  frame: { overflow: 'hidden' },
  image: { height: '100%', width: '100%' },
  sharpLayer: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
});
