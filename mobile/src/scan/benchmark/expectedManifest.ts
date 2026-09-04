import type { ExpectedCard } from './types';

export type { ExpectedCard };

/** Parse a JSON expected-card manifest (array or { cards: [...] }). */
export const parseExpectedManifest = (raw: unknown): ExpectedCard[] => {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { cards?: unknown }).cards)
      ? (raw as { cards: unknown[] }).cards
      : null;
  if (!list) throw new Error('manifest must be an array or { cards: [] }');
  const out: ExpectedCard[] = [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    const setCode = typeof r.setCode === 'string' ? r.setCode.trim() : '';
    const collectorNumber =
      typeof r.collectorNumber === 'string'
        ? r.collectorNumber.trim()
        : typeof r.collector_number === 'string'
          ? r.collector_number.trim()
          : '';
    if (!name || !setCode || !collectorNumber) continue;
    const finish =
      typeof r.finish === 'string' && r.finish.trim() ? r.finish.trim().toLowerCase() : null;
    out.push({ collectorNumber, finish, name, setCode });
  }
  if (!out.length) throw new Error('manifest has no valid expected cards');
  return out;
};

export const collectorNumbersEqual = (a: string, b: string): boolean => {
  const na = a.trim().toLowerCase().replace(/^0+/, '') || '0';
  const nb = b.trim().toLowerCase().replace(/^0+/, '') || '0';
  return na === nb;
};
