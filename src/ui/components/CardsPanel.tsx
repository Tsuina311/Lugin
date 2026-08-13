import { useState } from 'react';

import { usePageData } from '../usePageData';

import { Button } from './Button';

import type { CardListing, CardOffer } from '@/lib/mtg';

const Price = ({ value, text }: { text?: string; value?: number }) => {
  if (value == null && !text) return <span className="text-slate-500">—</span>;
  return <span className="tabular-nums text-emerald-300">{text ?? value?.toFixed(2)}</span>;
};

const OffersTable = ({ offers }: { offers: CardOffer[] }) => {
  return (
    <table className="w-full border-collapse text-[11px]">
      <thead className="sticky top-0 bg-slate-900">
        <tr className="border-b border-slate-700 text-left text-slate-400">
          <th className="px-2 py-1 font-medium">Seller</th>
          <th className="px-2 py-1 font-medium">Cond.</th>
          <th className="px-2 py-1 text-right font-medium">Price</th>
          <th className="px-2 py-1 text-right font-medium">Qty</th>
        </tr>
      </thead>
      <tbody>
        {offers.map((o, i) => (
          <tr key={i} className="border-b border-slate-800/60 hover:bg-slate-800/40">
            <td className="px-2 py-1 text-slate-200">
              {o.seller ?? '—'}
              {o.isFoil && <span className="ml-1 text-amber-300">✦</span>}
            </td>
            <td className="px-2 py-1 text-slate-300">{o.condition ?? '—'}</td>
            <td className="px-2 py-1 text-right">
              <Price text={o.priceText} value={o.price} />
            </td>
            <td className="px-2 py-1 text-right tabular-nums text-slate-400">
              {o.quantity ?? '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const ListingsTable = ({ listings }: { listings: CardListing[] }) => {
  return (
    <table className="w-full border-collapse text-[11px]">
      <thead className="sticky top-0 bg-slate-900">
        <tr className="border-b border-slate-700 text-left text-slate-400">
          <th className="px-2 py-1 font-medium">Card</th>
          <th className="px-2 py-1 text-right font-medium">From</th>
        </tr>
      </thead>
      <tbody>
        {listings.map((l, i) => (
          <tr key={i} className="border-b border-slate-800/60 hover:bg-slate-800/40">
            <td className="px-2 py-1 text-slate-200">{l.name ?? l.href ?? '—'}</td>
            <td className="px-2 py-1 text-right">
              <Price text={l.fromPriceText} value={l.fromPrice} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

/** Copy one representative product row's HTML so selectors can be tuned. */
const copySampleRowHtml = (): string => {
  const anchor = document.querySelector('a[href*="/Products/Singles/"]');
  const row =
    anchor?.closest(
      'tr, .article-row, [class*="article-row"], .table-body .row, .row.g-0, li, article',
    ) ??
    anchor?.parentElement ??
    null;
  return row instanceof HTMLElement ? row.outerHTML : 'No product row found on this page.';
};

const Diagnostics = ({ data }: { data: NonNullable<ReturnType<typeof usePageData>> }) => {
  const [showJson, setShowJson] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="border-t border-slate-800 p-2 text-[10px]">
      <div className="mb-1 flex items-center gap-2">
        <span className="font-semibold uppercase tracking-wider text-slate-500">Diagnostics</span>
        <Button
          className="ml-auto"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(copySampleRowHtml());
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard blocked */
            }
          }}
          size="xs"
          variant="neutral"
        >
          {copied ? 'Copied!' : 'Copy sample row HTML'}
        </Button>
      </div>
      <ul className="space-y-0.5">
        {data.diagnostics.map((d, i) => (
          <li key={i} className={d.level === 'warn' ? 'text-amber-400' : 'text-slate-400'}>
            {d.level === 'warn' ? '⚠ ' : '· '}
            {d.message}
          </li>
        ))}
      </ul>
      {data.jsonLd.length > 0 && (
        <div className="mt-2">
          <Button onClick={() => setShowJson(s => !s)} size="xs" variant="subtle">
            {showJson ? 'Hide' : 'Show'} raw JSON-LD ({data.jsonLd.length})
          </Button>
          {showJson && (
            <pre className="mt-1 max-h-48 overflow-auto rounded border border-slate-700/60 bg-slate-950/60 p-2 font-mono text-[10px] text-slate-300">
              {JSON.stringify(data.jsonLd, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
};

export const CardsPanel = () => {
  const data = usePageData();

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-slate-500">
        No Magic data extracted yet. Open a Cardmarket page (e.g. a card product page) and it will
        appear here.
      </div>
    );
  }

  const { context, listing, offers, listings } = data;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-slate-800 px-2 py-1.5 text-[11px]">
        <span className="rounded bg-slate-700/60 px-1.5 py-0.5 text-[10px] text-slate-200">
          {context.label}
        </span>
        {listing?.name && (
          <span className="truncate font-semibold text-slate-100">{listing.name}</span>
        )}
        {listing?.fromPrice != null && (
          <span className="ml-auto text-emerald-300">
            from {listing.fromPriceText ?? listing.fromPrice}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {offers.length > 0 && <OffersTable offers={offers} />}
        {listings.length > 0 && <ListingsTable listings={listings} />}
        {offers.length === 0 && listings.length === 0 && (
          <div className="p-4 text-center text-[11px] text-slate-500">
            No rows extracted for this page yet — check the diagnostics below and tune the selectors
            in <code>src/sites/cardmarket/selectors.ts</code>.
          </div>
        )}
      </div>

      <Diagnostics data={data} />
    </div>
  );
};
