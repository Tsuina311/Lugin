// Hides/shows card rows directly on the Cardmarket page based on a set of
// matching card names. Runs in the content script, which shares the page DOM,
// so the overlay can filter the real list in place (not just mirror it).

const HIDDEN_ATTR = 'data-lugin-hidden';
const norm = (s: string) => s.trim().toLowerCase();

/** Best-effort: find the list-row element that contains a product link. */
const rowFor = (anchor: Element): HTMLElement | null => {
  // Prefer a semantic row; fall back to Cardmarket's Bootstrap grid rows.
  const row =
    anchor.closest(
      'tr, .article-row, [class*="article-row"], .table-body .row, .row.g-0, li, article',
    ) ?? anchor.parentElement;
  return row instanceof HTMLElement ? row : null;
};

/** Restore every row we previously hid. */
export const clearPageFilter = (): void => {
  document.querySelectorAll<HTMLElement>(`[${HIDDEN_ATTR}]`).forEach(el => {
    el.style.removeProperty('display');
    el.removeAttribute(HIDDEN_ATTR);
  });
};

/**
 * Hide every product row whose card name is NOT in `matchNames`. Pass a set of
 * normalized (lowercased) names. Call clearPageFilter() to undo.
 */
export const applyPageFilter = (matchNames: Set<string>): void => {
  clearPageFilter();
  const anchors = document.querySelectorAll<HTMLAnchorElement>('a[href*="/Products/Singles/"]');
  const handledRows = new Set<HTMLElement>();

  anchors.forEach(a => {
    const name = a.textContent?.trim();
    if (!name) return;
    const row = rowFor(a);
    if (!row || handledRows.has(row)) return;
    handledRows.add(row);

    if (!matchNames.has(norm(name))) {
      row.style.setProperty('display', 'none', 'important');
      row.setAttribute(HIDDEN_ATTR, '1');
    }
  });
};
