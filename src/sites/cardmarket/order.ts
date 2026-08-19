// Order-level facts: who sold it, and when they handled it.
//
// The purchase sync already opens every order page to read the articles, the
// shipping and the paid date, and then threw away the one thing an order page is
// mostly *about* — the seller. So there was no seller entity anywhere in Lugin,
// and no way to answer "who do I actually buy from" despite having fetched the
// evidence and paid the request budget for it.
//
// Its own module rather than more of `wants.ts`, which is past 2,400 lines: these
// are order-page selectors, and the point of keeping selectors together is that
// markup changes become a one-file fix.

/** Seller slug from a profile href, e.g. `/en/Magic/Users/FKTRD` → `FKTRD`. */
export const sellerSlugFromHref = (href: string | null | undefined): string | undefined => {
  const m = href?.match(/\/Users\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]) : undefined;
};

export interface OrderSeller {
  /** Display name as shown on the order. Usually the slug, but not guaranteed. */
  name: string;
  /** Stable identity across locales — the profile path carries `/en/`, `/fr/`, … */
  slug: string;
  /** Profile path as found, for linking. */
  url?: string;
}

/**
 * A seller from a profile link. Pure, so the identity rules are testable.
 *
 * Falls back to the slug when the link text is empty or a single character (an
 * icon-only link), because a seller rendered as "" or ">" is not a seller.
 */
export const sellerFrom = (
  href: string | null | undefined,
  text?: string | null,
): OrderSeller | undefined => {
  const slug = sellerSlugFromHref(href);
  if (!slug) return undefined;
  const name = text?.trim();
  return { name: name && name.length > 1 ? name : slug, slug, ...(href ? { url: href } : {}) };
};

/**
 * The seller of a purchase, from its order-detail page.
 *
 * Deliberately more careful than "first `/Users/` link". An order page also links
 * the *buyer* — you — from the account menu, and every article row can link its
 * own seller-ish anchors. Picking the wrong one would attribute your whole
 * purchase history to yourself, which is the kind of wrong that looks like
 * working software.
 */
export const parseOrderSeller = (doc: ParentNode): OrderSeller | undefined => {
  const from = (el: Element | null | undefined): OrderSeller | undefined =>
    el ? sellerFrom(el.getAttribute('href'), el.textContent) : undefined;

  // The established selector, shared with the seller-ranking table and offer rows.
  const named = doc.querySelector<HTMLElement>('.seller-name a[href*="/Users/"]');
  const fromNamed = from(named);
  if (fromNamed) return fromNamed;

  // Otherwise the first profile link that is not chrome and not inside an article
  // row — the same walk `parseCartItems` uses to attribute rows to sellers.
  for (const a of doc.querySelectorAll<HTMLAnchorElement>('a[href*="/Users/"]')) {
    if (a.closest('nav, header, footer, #Nav, .main-nav, .navbar, [data-article-id]')) continue;
    const found = from(a);
    if (found) return found;
  }
  return undefined;
};

// Timeline labels across the locales Cardmarket serves. Matched as labels rather
// than sniffed anywhere in the text, because a date is meaningless without
// knowing which event it belongs to.
//
// The previous paid-date reader matched `/Paid\s*:/i` only and fell back to the
// first date in the timeline, so on any non-English account it silently read
// whatever event happened to come first.
const PAID_RE = /(paid|bezahlt|pay[ée]e?|pagato|pagado|betaald|zaplacono|op[łl]acone)\s*:/i;
const SENT_RE =
  /(sent|shipped|versandt|verschickt|envoy[ée]e?|exp[ée]di[ée]e?|spedito|enviado|verzonden|wys[łl]ano)\s*:/i;

const DATE_RE = /(\d{2})\.(\d{2})\.(\d{4})/;

const timestampOf = (text: string): { date?: string; ts?: number } => {
  const m = text.match(DATE_RE);
  if (!m) return {};
  const [, dd, mm, yyyy] = m;
  return { date: `${dd}.${mm}.${yyyy}`, ts: Date.parse(`${yyyy}-${mm}-${dd}`) || undefined };
};

export interface OrderTimeline {
  /** Display date "DD.MM.YYYY" the order was paid. */
  date?: string;
  /** When the seller dispatched it (ms), when the timeline says. */
  sentTs?: number;
  /** Paid timestamp (ms). */
  ts?: number;
}

/**
 * Paid and sent dates from an order page's status timeline.
 *
 * The gap between them is the seller's own handling time, which is the only part
 * of delivery speed they control — transit is the postal service's doing, and
 * judging a seller on it would mostly rank countries. Measuring it ourselves also
 * beats trusting a badge: it is derived from orders you actually placed.
 */
export const parseOrderTimeline = (doc: ParentNode): OrderTimeline => {
  const boxes = [...doc.querySelectorAll<HTMLElement>('#Timeline .timeline-box, .timeline-box')];
  return timelineFrom(
    boxes.map(b => b.textContent ?? ''),
    doc.querySelector('#Timeline')?.textContent ?? '',
  );
};

/**
 * The timeline logic, over the text of each status box. Pure, so the label
 * vocabulary and the sanity rules can be tested without a document.
 *
 * `wholeTimeline` is the fallback used when no box carries a recognizable "paid"
 * label — the first date anywhere, matching the previous behaviour, so an
 * unfamiliar layout still dates the order instead of dropping it.
 */
export const timelineFrom = (boxTexts: readonly string[], wholeTimeline = ''): OrderTimeline => {
  const textOf = (re: RegExp): string | undefined => boxTexts.find(t => re.test(t));

  const paid = timestampOf(textOf(PAID_RE) ?? wholeTimeline);
  const sentText = textOf(SENT_RE);
  const sent = sentText ? timestampOf(sentText) : {};

  return {
    ...paid,
    // Only trust a dispatch that isn't before payment; a timeline we misread
    // should produce no number rather than a negative handling time.
    ...(sent.ts != null && (paid.ts == null || sent.ts >= paid.ts) ? { sentTs: sent.ts } : {}),
  };
};
