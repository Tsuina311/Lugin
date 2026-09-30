// Cross-panel request: open a seller's singles stock in the Search tab list UI.

export interface SellerBrowseRequest {
  id: number;
  /** When set, pre-fills the stock list text filter to this card name. */
  cardQuery?: string;
  /** Display name (Cardmarket username slug). */
  name: string;
  /** Profile or offers URL when known — otherwise resolved from `name`. */
  url?: string;
  /**
   * When set (Best Sellers / want-list context), browse Singles filtered with
   * Cardmarket’s `?idWantslist=` so only that list’s wants appear.
   */
  wantListId?: string;
}

let pending: SellerBrowseRequest | null = null;
let seq = 0;
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const l of listeners) l();
};

export const sellerBrowseStore = {
  getSnapshot(): SellerBrowseRequest | null {
    return pending;
  },

  request(name: string, url?: string, cardQuery?: string, wantListId?: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    pending = {
      cardQuery: cardQuery?.trim() || undefined,
      id: ++seq,
      name: trimmed,
      ...(url ? { url } : {}),
      ...(wantListId?.trim() ? { wantListId: wantListId.trim() } : {}),
    };
    emit();
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  take(): SellerBrowseRequest | null {
    const next = pending;
    if (!next) return null;
    pending = null;
    emit();
    return next;
  },
};
