// Turning a scanner result into a collection row.
//
// Recognition stays where it is. This only decides whether a tap may write,
// and how that row joins the collection. A withheld name is never inserted.
// A second tap on the same card session is not a second copy.

import type { CollectionCard } from '@/lib/collection';
import { applyImport } from '@/lib/duplicates';

export type IntakeStatus =
  | 'card-ambiguous'
  | 'identified'
  | 'insufficient-confidence'
  | 'manual'
  | 'none'
  | 'printing-ambiguous';

export interface ScanIntakeRequest {
  card: CollectionCard | null;
  /** Session id already written by a previous tap. */
  committedSessionId: number | null;
  /** Session that owns the camera at the moment of the tap. */
  liveSessionId: number | null;
  /** Session that published the result the user is confirming. */
  ownerSessionId: number | null;
  status: IntakeStatus;
}

export type ScanIntake =
  | { card: CollectionCard; ok: true; sessionId: number | null }
  | { ok: false; reason: 'duplicate-tap' | 'missing' | 'stale' | 'withheld' };

const CONFIDENT: ReadonlySet<IntakeStatus> = new Set([
  'identified',
  'manual',
  'printing-ambiguous',
]);

/** Whether this tap may become a row. Does not touch the recognizer. */
export const decideScanIntake = (request: ScanIntakeRequest): ScanIntake => {
  if (!CONFIDENT.has(request.status)) return { ok: false, reason: 'withheld' };
  const name = request.card?.name.trim() ?? '';
  if (!request.card || name === '') return { ok: false, reason: 'missing' };
  if (
    request.ownerSessionId != null &&
    request.liveSessionId != null &&
    request.ownerSessionId !== request.liveSessionId
  ) {
    return { ok: false, reason: 'stale' };
  }
  const sessionId = request.ownerSessionId ?? request.liveSessionId;
  if (sessionId != null && request.committedSessionId === sessionId) {
    return { ok: false, reason: 'duplicate-tap' };
  }
  const quantity = request.card.quantity > 0 ? request.card.quantity : 1;
  return {
    card: { ...request.card, foil: request.card.foil === true, name, quantity, source: 'import' },
    ok: true,
    sessionId,
  };
};

/**
 * Add one scanned row. An existing import row with the same printing absorbs
 * the quantity. A new printing is appended. Purchase rows are left alone.
 */
export const mergeScanCard = (
  existing: readonly CollectionCard[],
  card: CollectionCard,
): CollectionCard[] => applyImport([...existing], [card], []);

/** A name the user typed, with no printing claimed. */
export const nameOnlyCard = (name: string, quantity = 1): CollectionCard => ({
  foil: false,
  name: name.trim(),
  quantity: quantity > 0 ? quantity : 1,
  source: 'import',
});
