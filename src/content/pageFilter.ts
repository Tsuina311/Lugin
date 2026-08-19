// Hides/shows card rows directly on the Cardmarket page. Runs in the content
// script, which shares the page DOM, so the overlay can filter the real list in
// place rather than only mirroring it in a panel of its own.
//
// Filters are *registered* rather than applied, because more than one panel wants
// to hide rows and the panels are all mounted at once (see the note in `App.tsx`).
// With a single apply/clear pair the last effect to run took the whole page, and a
// re-render of an idle panel cleared the filter out from under the active one.
// Registering by owner also means an unmounting panel withdraws its own filter
// instead of wiping everybody's.
//
// Two active filters intersect. That is the only reading that keeps both
// statements true: hiding what either one hides shows rows the other rejected.

const HIDDEN_ATTR = 'data-lugin-hidden';
const norm = (s: string) => s.trim().toLowerCase();

/** Normalized names each owner is willing to show. */
const filters = new Map<string, Set<string>>();

/** Best-effort: find the list-row element that contains a product link. */
const rowFor = (anchor: Element): HTMLElement | null => {
  // Prefer a semantic row; fall back to Cardmarket's Bootstrap grid rows.
  const row =
    anchor.closest(
      'tr, .article-row, [class*="article-row"], .table-body .row, .row.g-0, li, article',
    ) ?? anchor.parentElement;
  return row instanceof HTMLElement ? row : null;
};

/** Restore every row we previously hid, without touching the registry. */
const revealAll = (): void => {
  document.querySelectorAll<HTMLElement>(`[${HIDDEN_ATTR}]`).forEach(el => {
    el.style.removeProperty('display');
    el.removeAttribute(HIDDEN_ATTR);
  });
};

/** Hide every product row whose name no active filter admits. */
const render = (): void => {
  revealAll();
  if (filters.size === 0) return;

  const sets = [...filters.values()];
  const allowed = (name: string) => sets.every(set => set.has(name));

  const handledRows = new Set<HTMLElement>();
  document.querySelectorAll<HTMLAnchorElement>('a[href*="/Products/Singles/"]').forEach(a => {
    const name = a.textContent?.trim();
    if (!name) return;
    const row = rowFor(a);
    if (!row || handledRows.has(row)) return;
    handledRows.add(row);

    if (!allowed(norm(name))) {
      row.style.setProperty('display', 'none', 'important');
      row.setAttribute(HIDDEN_ATTR, '1');
    }
  });
};

/**
 * Declare which rows one panel wants visible, or pass `null` to stop filtering.
 *
 * Names are normalized here so callers can pass them as they read them off the
 * page. An empty set is a filter that admits nothing — which is a legitimate
 * thing to say, and why callers must pass `null` rather than an empty set when
 * they mean "never mind".
 */
export const setPageFilter = (owner: string, names: Iterable<string> | null): void => {
  if (names === null) filters.delete(owner);
  else filters.set(owner, new Set([...names].map(norm)));
  render();
};
