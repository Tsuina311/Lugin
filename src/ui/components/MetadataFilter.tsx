import { useEffect, useMemo, useState } from 'react';

import { usePageData } from '../usePageData';

import { Button } from './Button';
import { COLOR_PIPS } from './colorPips';

import { applyPageFilter, clearPageFilter } from '@/content/pageFilter';
import { cardKey } from '@/lib/cardName';
import { requestScryfall } from '@/lib/messaging';
import type { CardMetadata } from '@/lib/mtg';

const norm = (s: string) => s.trim().toLowerCase();

interface Row {
  meta?: CardMetadata;
  name: string;
}

export const MetadataFilter = () => {
  const pageData = usePageData();
  const pageNames = useMemo(
    () =>
      Array.from(
        new Set(
          [...(pageData?.listings ?? []).map(l => l.name), pageData?.listing?.name].filter(
            (n): n is string => !!n,
          ),
        ),
      ),
    [pageData],
  );

  const [source, setSource] = useState<'page' | 'manual'>('page');
  const [manual, setManual] = useState('');
  const [metaByName, setMetaByName] = useState<Record<string, CardMetadata>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [colors, setColors] = useState<Set<string>>(new Set());
  const [types, setTypes] = useState<Set<string>>(new Set());
  const [subtype, setSubtype] = useState('');
  const [cmcMin, setCmcMin] = useState('');
  const [cmcMax, setCmcMax] = useState('');
  const [applyToPage, setApplyToPage] = useState(false);

  const names = useMemo(
    () =>
      source === 'page'
        ? pageNames
        : Array.from(
            new Set(
              manual
                .split('\n')
                .map(s => s.trim())
                .filter(Boolean),
            ),
          ),
    [source, pageNames, manual],
  );

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const cards = await requestScryfall(names);
      const map: Record<string, CardMetadata> = {};
      for (const c of cards) map[cardKey(c.name)] = c;
      setMetaByName(map);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const rows: Row[] = useMemo(
    () => names.map(name => ({ meta: metaByName[cardKey(name)], name })),
    [names, metaByName],
  );

  const availableTypes = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) r.meta?.types.forEach(t => set.add(t));
    return [...set].sort();
  }, [rows]);

  const availableSubtypes = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) r.meta?.subtypes.forEach(t => set.add(t));
    return [...set].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const min = cmcMin === '' ? null : Number(cmcMin);
    const max = cmcMax === '' ? null : Number(cmcMax);

    return rows.filter(({ name, meta }) => {
      if (q) {
        const hay =
          `${name} ${meta?.typeLine ?? ''} ${meta?.subtypes.join(' ') ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (colors.size > 0) {
        const cardColors = meta?.colors ?? [];
        const isColorless = cardColors.length === 0;
        const match = [...colors].some(c => (c === 'C' ? isColorless : cardColors.includes(c)));
        if (!match) return false;
      }
      if (types.size > 0) {
        if (!meta || !meta.types.some(t => types.has(t))) return false;
      }
      if (subtype) {
        if (!meta || !meta.subtypes.includes(subtype)) return false;
      }
      if (min != null && (meta?.cmc == null || meta.cmc < min)) return false;
      if (max != null && (meta?.cmc == null || meta.cmc > max)) return false;
      return true;
    });
  }, [rows, search, colors, types, subtype, cmcMin, cmcMax]);

  const loaded = Object.keys(metaByName).length > 0;
  const matchedCount = rows.filter(r => r.meta?.found).length;

  // Stable key of the currently-matching names, so the page-filter effect only
  // re-runs when the result set actually changes.
  const matchKey = useMemo(
    () =>
      filtered
        .map(r => norm(r.name))
        .sort()
        .join('|'),
    [filtered],
  );

  // Hide/show the real rows on the Cardmarket page to mirror the filter.
  useEffect(() => {
    if (!applyToPage) {
      clearPageFilter();
      return;
    }
    applyPageFilter(new Set(matchKey ? matchKey.split('|') : []));
  }, [applyToPage, matchKey]);

  // Always restore the page when this panel unmounts.
  useEffect(() => () => clearPageFilter(), []);

  const toggle = (set: Set<string>, value: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setter(next);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Source + load */}
      <div className="border-b border-slate-800 p-2">
        <div className="mb-2 flex items-center gap-2 text-[11px]">
          <label className="flex items-center gap-1">
            <input checked={source === 'page'} onChange={() => setSource('page')} type="radio" />
            Page ({pageNames.length})
          </label>
          <label className="flex items-center gap-1">
            <input
              checked={source === 'manual'}
              onChange={() => setSource('manual')}
              type="radio"
            />
            Manual
          </label>
          <Button
            className="ml-auto"
            disabled={loading || names.length === 0}
            onClick={load}
            size="md"
            variant="primary"
          >
            {loading ? 'Loading…' : `Load metadata (${names.length})`}
          </Button>
        </div>

        {source === 'manual' && (
          <textarea
            className="w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-[11px] text-slate-200 outline-none focus:border-sky-500"
            onChange={e => setManual(e.target.value)}
            placeholder={'One card name per line, e.g.\nLightning Bolt\nLlanowar Elves'}
            rows={4}
            value={manual}
          />
        )}
        {error && <div className="mt-1 text-[11px] text-red-400">{error}</div>}
      </div>

      {/* Filters */}
      {loaded && (
        <div className="space-y-2 border-b border-slate-800 p-2 text-[11px]">
          <input
            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200 outline-none focus:border-sky-500"
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name / type / subtype…"
            value={search}
          />

          <div className="flex flex-wrap items-center gap-1">
            <span className="text-slate-500">Color:</span>
            {COLOR_PIPS.map(c => (
              <button
                key={c.code}
                className={`h-5 w-5 rounded-full text-[10px] font-bold ${c.cls} ${
                  colors.has(c.code) ? 'ring-2 ring-sky-400' : 'opacity-60'
                }`}
                onClick={() => toggle(colors, c.code, setColors)}
                type="button"
              >
                {c.label}
              </button>
            ))}
          </div>

          {availableTypes.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-slate-500">Type:</span>
              {availableTypes.map(t => (
                <Button
                  key={t}
                  active={types.has(t)}
                  onClick={() => toggle(types, t, setTypes)}
                  size="xs"
                  variant="subtle"
                >
                  {t}
                </Button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <select
              className="rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-slate-200 outline-none focus:border-sky-500"
              onChange={e => setSubtype(e.target.value)}
              value={subtype}
            >
              <option value="">Any subtype</option>
              {availableSubtypes.map(s => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <span className="text-slate-500">MV</span>
            <input
              className="w-14 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-slate-200 outline-none focus:border-sky-500"
              onChange={e => setCmcMin(e.target.value)}
              placeholder="min"
              type="number"
              value={cmcMin}
            />
            <input
              className="w-14 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-slate-200 outline-none focus:border-sky-500"
              onChange={e => setCmcMax(e.target.value)}
              placeholder="max"
              type="number"
              value={cmcMax}
            />
          </div>

          <label className="flex items-center gap-1.5 pt-1 text-slate-300">
            <input
              checked={applyToPage}
              onChange={e => setApplyToPage(e.target.checked)}
              type="checkbox"
            />
            Apply to page (hide non-matching rows on Cardmarket)
          </label>
        </div>
      )}

      {/* Results */}
      <div className="min-h-0 flex-1 overflow-auto">
        {!loaded ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-xs text-slate-500">
            {names.length === 0
              ? 'No card names available. Switch to Manual and paste some names, or open a Cardmarket list page.'
              : `Ready to look up ${names.length} card name(s) on Scryfall. Press “Load metadata”.`}
          </div>
        ) : (
          <>
            <div className="sticky top-0 flex items-center gap-2 bg-slate-900 px-2 py-1 text-[10px] text-slate-500">
              <span>
                {filtered.length}/{rows.length} shown
              </span>
              <span className="ml-auto">
                {matchedCount}/{rows.length} matched on Scryfall
              </span>
            </div>
            <ul className="divide-y divide-slate-800/60">
              {filtered.map(({ name, meta }, i) => (
                <li key={i} className="flex items-center gap-2 px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] text-slate-100">
                      {meta?.scryfallUri ? (
                        <a
                          className="hover:text-sky-300 hover:underline"
                          href={meta.scryfallUri}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {name}
                        </a>
                      ) : (
                        name
                      )}
                      {meta && !meta.found && (
                        <span className="ml-1 text-[10px] text-amber-400">(not found)</span>
                      )}
                    </div>
                    {meta?.typeLine && (
                      <div className="truncate text-[10px] text-slate-500">{meta.typeLine}</div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {(meta?.colors.length ? meta.colors : meta?.found ? ['C'] : []).map(c => {
                      const def = COLOR_PIPS.find(x => x.code === c);
                      return (
                        <span
                          key={c}
                          className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold ${
                            def?.cls ?? 'bg-slate-600 text-white'
                          }`}
                        >
                          {c}
                        </span>
                      );
                    })}
                    {meta?.cmc != null && (
                      <span className="ml-1 w-5 text-right text-[10px] tabular-nums text-slate-400">
                        {meta.cmc}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
};
