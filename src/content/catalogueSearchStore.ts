// Cross-panel request to run a Cardmarket catalogue search.
//
// Want lists (and anything else) can ask for a card by name; App switches to the
// Search tab and WantsPanel runs the same Search 2.0 fetch as typing in the box.

export interface CatalogueSearchRequest {
  /** Prefer printings of this card identity only (drop near-name noise). */
  exact: boolean;
  id: number;
  term: string;
}

let pending: CatalogueSearchRequest | null = null;
let seq = 0;
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const l of listeners) l();
};

export const catalogueSearchStore = {
  getSnapshot(): CatalogueSearchRequest | null {
    return pending;
  },

  /** Ask Search to look up `term`. `exact` keeps only that card's printings. */
  request(term: string, opts: { exact?: boolean } = {}): void {
    const trimmed = term.trim();
    if (!trimmed) return;
    pending = { exact: opts.exact ?? false, id: ++seq, term: trimmed };
    emit();
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** Claim the pending request so it isn't run twice. */
  take(): CatalogueSearchRequest | null {
    const next = pending;
    if (!next) return null;
    pending = null;
    emit();
    return next;
  },
};
