/** Whether a want-list amount is authoritative. */
export type QuantityStatus = 'KNOWN' | 'UNKNOWN';

/**
 * Pure amount resolution from already-extracted fields (preference order matches
 * Cardmarket markup helpers / export scripts).
 */
export const parseWantAmountFields = (fields: {
  dataAmount?: string | null;
  rowDataAmount?: string | null;
  inputValue?: string | null;
  cellText?: string | null;
}): { amount?: number; quantityStatus: QuantityStatus } => {
  const parsePos = (raw: string | null | undefined): number | undefined => {
    if (raw == null) return undefined;
    const n = Number.parseInt(String(raw).replace(/\s+/g, ''), 10);
    return Number.isFinite(n) && n > 0 && n < 10_000 ? n : undefined;
  };

  for (const raw of [fields.dataAmount, fields.rowDataAmount, fields.inputValue]) {
    const n = parsePos(raw);
    if (n != null) return { amount: n, quantityStatus: 'KNOWN' };
  }

  const text = fields.cellText?.replace(/\s+/g, ' ').trim() ?? '';
  const m = text.match(/^(\d{1,4})$/);
  const fromText = m ? parsePos(m[1]) : undefined;
  if (fromText != null) return { amount: fromText, quantityStatus: 'KNOWN' };

  return { quantityStatus: 'UNKNOWN' };
};
