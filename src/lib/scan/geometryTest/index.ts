export * from './types';
export * from './lock';
export * from './timing';
export * from './summarize';
export * from './artifacts';
export * from './captureSafe';
export * from './unsafeReasons';
export * from './physicalRefine';
export * from './sourceSafety';

export const geometryItemStem = (index: number): string =>
  `geom-${String(index).padStart(3, '0')}`;

export const geometryFixtureId = (at = new Date()): string => {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `geometry-test-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-` +
    `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
  );
};
