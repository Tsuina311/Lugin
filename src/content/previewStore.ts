// Tiny external store (useSyncExternalStore-compatible) for the hover image
// preview. It lives outside React so the preview can be rendered at the very
// top of the overlay tree — outside the `backdrop-blur` container, which would
// otherwise become the containing block for our `position: fixed` popup and
// throw off its coordinates.
//
// For double-faced cards the preview can hold both faces; the currently viewed
// face is `urls[index]`, and `flip()` cycles to the other side.
//
// Which card is shown and where the pointer is are deliberately two different
// channels. The card changes a couple of times per hover and belongs in React;
// the pointer moves every frame, and a subscriber that re-renders a list of
// hundreds of rows at that rate is what made following the cursor feel like
// dragging it through treacle. Position updates therefore notify their own
// listeners, which write to the DOM directly.

export interface PreviewState {
  index: number;
  /** Identifies the hovered card so async face lookups can target it. */
  key: string;
  /** One entry for single-faced cards, two for double-faced. */
  urls: string[];
}

export interface PreviewPosition {
  x: number;
  y: number;
}

let state: PreviewState | null = null;
let position: PreviewPosition = { x: 0, y: 0 };
const listeners = new Set<() => void>();
const positionListeners = new Set<(at: PreviewPosition) => void>();

const emit = () => {
  for (const l of listeners) l();
};

export const previewStore = {
  /** Flip to the next face (no-op unless the card has more than one). */
  flip() {
    if (!state || state.urls.length < 2) return;
    state = { ...state, index: (state.index + 1) % state.urls.length };
    emit();
  },

  getPosition(): PreviewPosition {
    return position;
  },

  getSnapshot(): PreviewState | null {
    return state;
  },

  hide() {
    if (!state) return;
    state = null;
    emit();
  },

  /**
   * Follow the cursor. No React state changes here — only the position
   * listeners, which move the popup on the next animation frame.
   */
  move(x: number, y: number) {
    if (!state) return;
    position = { x, y };
    for (const l of positionListeners) l(position);
  },

  /**
   * Upgrade the currently shown card to its full set of face images once an
   * async lookup resolves — only if the same card is still being previewed.
   *
   * We KEEP the edition-specific front image already on screen (it comes from
   * the Cardmarket offer row, so it matches the exact printing) and only borrow
   * the extra face(s) — e.g. the back of a double-faced card — from Scryfall,
   * whose art is the default printing. This way flipping works without losing
   * the correct edition art on the front.
   */
  setFaces(key: string, faces: string[]) {
    if (!state || state.key !== key || faces.length < 2) return;
    const urls = [state.urls[0], ...faces.slice(1)];
    state = { ...state, index: Math.min(state.index, urls.length - 1), urls };
    emit();
  },

  /** Start previewing a card at the pointer. */
  show(next: PreviewState, x: number, y: number) {
    state = next;
    position = { x, y };
    emit();
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  subscribePosition(listener: (at: PreviewPosition) => void): () => void {
    positionListeners.add(listener);
    return () => positionListeners.delete(listener);
  },
};
