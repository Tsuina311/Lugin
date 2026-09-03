import { Image, StyleSheet, Text, View } from 'react-native';

import { coverLayout, type CardCorners, type Point2D } from './sharedCore';

type Props = {
  corners: CardCorners | null;
  height: number;
  label: string;
  showNumbers: boolean;
  uri: string | null;
  width: number;
};

const LINE = 2;
const THUMB_MAX = 132;

/**
 * "Detector input" — the exact ScanImage handed to detectCardQuad, with that
 * call's raw quad drawn in analysis coordinates before any preview mapping.
 */
export function DetectorInputThumb({ corners, height, label, showNumbers, uri, width }: Props) {
  const box = thumbSize(width, height);
  const mapped = corners && width > 0 ? mapCorners(corners, { height, width }, box) : null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Detector input</Text>
      <View style={[styles.frame, box]}>
        {uri ? (
          <Image resizeMode="stretch" source={{ uri }} style={StyleSheet.absoluteFill} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.empty]}>
            <Text style={styles.dim}>none</Text>
          </View>
        )}
        {mapped ? (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {edges(mapped).map(([a, b], i) => (
              <View key={i} style={[styles.edge, edgeStyle(a, b)]} />
            ))}
            {showNumbers
              ? numbered(mapped).map(({ n, p }) => (
                  <Text key={n} style={[styles.num, { left: p.x - 5, top: p.y - 7 }]}>
                    {n}
                  </Text>
                ))
              : null}
          </View>
        ) : null}
      </View>
      <Text style={styles.caption}>{label}</Text>
    </View>
  );
}

const thumbSize = (width: number, height: number): { height: number; width: number } => {
  if (width <= 0 || height <= 0) return { height: THUMB_MAX, width: 100 };
  const scale = THUMB_MAX / Math.max(width, height);
  return {
    height: Math.max(32, Math.round(height * scale)),
    width: Math.max(32, Math.round(width * scale)),
  };
};

const mapCorners = (
  corners: CardCorners,
  analysis: { height: number; width: number },
  dest: { height: number; width: number },
): CardCorners => {
  const { offsetX, offsetY, scale } = coverLayout(analysis, dest);
  const map = (p: Point2D): Point2D => ({ x: p.x * scale + offsetX, y: p.y * scale + offsetY });
  return {
    bottomLeft: map(corners.bottomLeft),
    bottomRight: map(corners.bottomRight),
    topLeft: map(corners.topLeft),
    topRight: map(corners.topRight),
  };
};

const edges = (c: CardCorners): [Point2D, Point2D][] => [
  [c.topLeft, c.topRight],
  [c.topRight, c.bottomRight],
  [c.bottomRight, c.bottomLeft],
  [c.bottomLeft, c.topLeft],
];

const numbered = (c: CardCorners): { n: string; p: Point2D }[] => [
  { n: '1', p: c.topLeft },
  { n: '2', p: c.topRight },
  { n: '3', p: c.bottomRight },
  { n: '4', p: c.bottomLeft },
];

const edgeStyle = (a: Point2D, b: Point2D) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  return {
    left: a.x + dx / 2 - length / 2,
    top: a.y + dy / 2 - LINE / 2,
    transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
    width: length,
  };
};

const styles = StyleSheet.create({
  caption: {
    color: '#8A97AD',
    fontSize: 10,
    textAlign: 'center',
  },
  dim: {
    color: '#8A97AD',
    fontSize: 10,
  },
  edge: {
    backgroundColor: '#7C9BFF',
    borderRadius: LINE,
    height: LINE,
    position: 'absolute',
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    backgroundColor: '#000',
    borderColor: 'rgba(255,255,255,0.25)',
    borderWidth: 1,
    overflow: 'hidden',
  },
  label: {
    color: '#F5C542',
    fontSize: 10,
    fontWeight: '700',
  },
  num: {
    color: '#7C9BFF',
    fontSize: 10,
    fontWeight: '800',
    position: 'absolute',
    textShadowColor: '#000',
    textShadowRadius: 2,
  },
  wrap: {
    alignItems: 'center',
    gap: 2,
  },
});
