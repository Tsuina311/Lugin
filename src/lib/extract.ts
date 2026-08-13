// Generic, site-agnostic extraction helpers. Anything Cardmarket-specific lives
// in src/sites/cardmarket; this file only knows about "HTML documents" in the
// abstract so it can be reused for other Magic sites later.

/** Parse a raw HTML string (e.g. an AJAX fragment) into a detached Document. */
export const parseHtml = (html: string): Document =>
  new DOMParser().parseFromString(html, 'text/html');

/**
 * Collect and JSON.parse every <script type="application/ld+json"> block.
 * These schema.org blobs are the most stable structured data on SSR pages, so
 * we always try them first. Returns the parsed values (objects/arrays); invalid
 * blocks are skipped.
 */
export const collectJsonLd = (doc: ParentNode): unknown[] => {
  const out: unknown[] = [];
  doc.querySelectorAll('script[type="application/ld+json"]').forEach(node => {
    const text = node.textContent?.trim();
    if (!text) return;
    try {
      const parsed = JSON.parse(text);
      // A single block may itself be an array or a @graph container.
      if (Array.isArray(parsed)) out.push(...parsed);
      else if (
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { '@graph'?: unknown[] })['@graph'])
      ) {
        out.push(...(parsed as { '@graph': unknown[] })['@graph']);
      } else {
        out.push(parsed);
      }
    } catch {
      /* ignore malformed JSON-LD */
    }
  });
  return out;
};

/** The `@type` of a JSON-LD node, normalized to a lowercase string. */
export const jsonLdType = (node: unknown): string => {
  if (node && typeof node === 'object') {
    const t = (node as { '@type'?: unknown })['@type'];
    if (typeof t === 'string') return t.toLowerCase();
    if (Array.isArray(t) && typeof t[0] === 'string') return t[0].toLowerCase();
  }
  return '';
};

/** trimmed textContent of the first element matching `selector`, or undefined. */
export const textOf = (root: ParentNode, selector: string): string | undefined => {
  const el = root.querySelector(selector);
  const text = el?.textContent?.trim();
  return text ? text : undefined;
};

/** an attribute value from the first element matching `selector`. */
export const attrOf = (root: ParentNode, selector: string, attr: string): string | undefined => {
  const el = root.querySelector(selector);
  const v = el?.getAttribute(attr) ?? undefined;
  return v ? v : undefined;
};

/**
 * Parse a localized money string like "1.234,56 €" or "$1,234.56" into a number
 * plus a best-guess currency symbol. Handles both comma- and dot-decimal forms.
 */
export const parseMoney = (input?: string): { currency?: string; value?: number } => {
  if (!input) return {};
  const currencyMatch = input.match(/[€$£¥]|\b(?:EUR|USD|GBP)\b/i);
  const currency = currencyMatch?.[0];

  // Strip everything except digits and separators.
  const numeric = input.replace(/[^0-9.,]/g, '');
  if (!numeric) return { currency };

  let normalized = numeric;
  const lastComma = numeric.lastIndexOf(',');
  const lastDot = numeric.lastIndexOf('.');
  if (lastComma > lastDot) {
    // Comma is the decimal separator (European): 1.234,56 -> 1234.56
    normalized = numeric.replace(/\./g, '').replace(',', '.');
  } else {
    // Dot is the decimal separator (US): 1,234.56 -> 1234.56
    normalized = numeric.replace(/,/g, '');
  }

  const value = Number.parseFloat(normalized);
  return { currency, value: Number.isFinite(value) ? value : undefined };
};
