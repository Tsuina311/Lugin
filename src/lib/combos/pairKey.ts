/** Unordered identity of two oracle ids. A+B and B+A are the same pair. */
export const comboPairKey = (a: string, b: string): string => {
  if (a === b) return a;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
};
