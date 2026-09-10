import type { CardCorners, Point } from '../types';
import type { MotionClass, MotionSample } from './types';

const center = (q: CardCorners): Point => ({
  x: (q.topLeft.x + q.topRight.x + q.bottomRight.x + q.bottomLeft.x) / 4,
  y: (q.topLeft.y + q.topRight.y + q.bottomRight.y + q.bottomLeft.y) / 4,
});

const area = (q: CardCorners): number =>
  Math.abs(
    (q.topLeft.x * q.topRight.y -
      q.topRight.x * q.topLeft.y +
      q.topRight.x * q.bottomRight.y -
      q.bottomRight.x * q.topRight.y +
      q.bottomRight.x * q.bottomLeft.y -
      q.bottomLeft.x * q.bottomRight.y +
      q.bottomLeft.x * q.topLeft.y -
      q.topLeft.x * q.bottomLeft.y) /
      2,
  );

const heading = (q: CardCorners): number =>
  (Math.atan2(q.topRight.y - q.topLeft.y, q.topRight.x - q.topLeft.x) * 180) / Math.PI;

export const classifyMotion = (centerDeltaPx: number): MotionClass => {
  if (centerDeltaPx < 8) return 'stationary';
  if (centerDeltaPx < 25) return 'minor-motion';
  return 'moving';
};

export const motionFromQuads = (
  previous: CardCorners | null,
  current: CardCorners | null,
): MotionSample | null => {
  if (!previous || !current) return null;
  const a = center(previous);
  const b = center(current);
  const centerDeltaPx = Math.hypot(b.x - a.x, b.y - a.y);
  const prevA = area(previous);
  return {
    areaChange: prevA > 0 ? (area(current) - prevA) / prevA : 0,
    centerDeltaPx,
    classification: classifyMotion(centerDeltaPx),
    rotationDeg: heading(current) - heading(previous),
  };
};
