import { useEffect, useMemo, useRef, useState } from 'react';

import { usePageData } from '../usePageData';

import { Button } from './Button';
import { EditionFilter } from './EditionFilter';
import { COLOR_PIPS } from './colorPips';

import { setPageFilter } from '@/content/pageFilter';
import { cardKey } from '@/lib/cardName';
import { requestScryfall } from '@/lib/messaging';
import type { CardMetadata } from '@/lib/mtg';
import { editionIdOf, groupEditionsByYear, tallyEditions } from '@/lib/sets';
import { useSetIndex } from '@/ui/useSetIndex';
import { useStickySet, useStickyValue } from '@/ui/useStickyState';

const norm = (s: string) => s.trim().toLowerCase();

/** Identifies this panel's page filter, so the Search tab's is independent. */
const FILTER_OWNER = 'metadata';

interface Row {
  meta?: CardMetadata;
  name: string;
  setName?: string;
}

export const MetadataFilter = () => {
  const pageData = usePageData();
  // Rows rather than bare names, because the expansion each row belongs to is
  // what the edition filter works on. A search page lists one row per printing,
  // so the same card can legitimately appear several times here.
  const pageRows = useMemo<Row[]>(() => {
    const seen = new Map<string, Row>();
    const add = (name?: string, setName?: string) => {
      if (!name) return;
      const key = `${name.toLowerCase()}|${setName?.toLowerCase() ?? ''}`;
      if (!seen.has(key)) seen.set(key, { name, ...(setName ? { setName } : {}) });
    };
    for (const l of pageData?.listings ?? []) add(l.name, l.setName);
    add(pageData?.listing?.name, pageData?.listing?.setName);
    return [...seen.values()];
  }, [pageData]);

  const [source, setSource] = useState<'page' | 'manual'>('page');
  const [manual, setManual] = useState('');
  const [metaByName, setMetaByName] = useState<Record<string, CardMetadata>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters, remembered across page loads — Cardmarket navigations remount this
  // panel, and re-picking five colours on every card page is the whole complaint.
  const [search, setSearch] = useStickyValue('lugin:filter:search', '');
  const [colors, setColors] = useStickySet<string>('lugin:filter:colors');
  const [types, setTypes] = useStickySet<string>('lugin:filter:types');
  const [subtype, setSubtype] = useStickyValue('lugin:filter:subtype', '');
  const [cmcMin, setCmcMin] = useStickyValue('lugin:filter:cmcMin', '');
  const [cmcMax, setCmcMax] = useStickyValue('lugin:filter:cmcMax', '');
  const [editions, setEditions] = useStickySet<string>('lugin:filter:editions');
  const [applyToPage, setApplyToPage] = useStickyValue('lugin:filter:applyToPage', false);

  /**
   * Filters that cross-reference Scryfall, so they mean nothing until metadata
   * has landed. The edition filter is deliberately not one of them: the page
   * already says which expansion each row belongs to.
   */
  const needsMeta =
    search.trim() !== '' ||
    colors.size > 0 ||
    types.size > 0 ||
    subtype !== '' ||
    cmcMin !== '' ||
    cmcMax !== '';

  const active = needsMeta || editions.size > 0;

  const clearFilters = () => {
    setSearch('');
    setColors(new Set());
    setTypes(new Set());
    setSubtype('');
    setCmcMin('');
    setCmcMax('');
    setEditions(new Set());
  };

  const sourceRows = useMemo<Row[]>(
    () =>
      source === 'page'
        ? pageRows
        : Array.from(
            new Set(
              manual
                .split('\n')
                .map(s => s.trim())
                .filter(Boolean),
            ),
          ).map(name => ({ name })),
    [source, pageRows, manual],
  );

  /** Distinct names, which is what Scryfall is asked about. */
  const names = useMemo(
    () => Array.from(new Set(sourceRows.map(r => r.name))),
    [sourceRows],
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
    () => sourceRows.map(row => ({ ...row, meta: metaByName[cardKey(row.name)] })),
    [sourceRows, metaByName],
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

  // Options come from every row on the page, not the surviving ones — otherwise
  // picking a set would erase the choices beside it.
  const { index: setIndex, status: setStatus } = useSetIndex();
  const editionYears = useMemo(
    () => groupEditionsByYear(tallyEditions(rows, setIndex)),
    [rows, setIndex],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const min = cmcMin === '' ? null : Number(cmcMin);
    const max = cmcMax === '' ? null : Number(cmcMax);

    return rows.filter(({ name, meta, setName }) => {
      if (editions.size > 0) {
        const key = editionIdOf(setIndex, { setName });
        if (key == null || !editions.has(key)) return false;
      }
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
  }, [rows, search, colors, types, subtype, cmcMin, cmcMax, editions, setIndex]);

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
  //
  // Held back until metadata arrives, and that guard is load-bearing now that the
  // filter is remembered: on a fresh page nothing has been looked up yet, so every
  // row looks colourless and typeless. A restored "red only" filter would match
  // nothing and blank the entire page — a spectacular way to look broken.
  //
  // Only the Scryfall-backed filters need that protection, hence `needsMeta`
  // rather than a blanket wait: an edition filter can be honoured immediately,
  // since the page itself said which expansion each row is from.
  useEffect(() => {
    if (!applyToPage || (needsMeta && !loaded)) {
      setPageFilter(FILTER_OWNER, null);
      return;
    }
    setPageFilter(FILTER_OWNER, matchKey ? matchKey.split('|') : []);
  }, [applyToPage, needsMeta, loaded, matchKey]);

  // Withdraw only this panel's filter when it unmounts; the Search tab may have
  // one of its own.
  useEffect(() => () => setPageFilter(FILTER_OWNER, null), []);

  // Fetch metadata unprompted when a remembered filter is waiting for it.
  //
  // Without this, a surviving filter is only surviving checkboxes: every new page
  // would need a manual "Load metadata" before it did anything. Lookups are
  // batched and cached in the worker for 30 days, so on a browse through one
  // expansion this is nearly always a cache hit.
  const attempted = useRef('');
  const fingerprint = useMemo(() => names.join('|'), [names]);
  useEffect(() => {
    if (!needsMeta || loaded || loading || !fingerprint) return;
    // One attempt per set of names, so a page of cards Scryfall has never heard of
    // is asked about once rather than on every render.
    if (attempted.current === fingerprint) return;
    attempted.current = fingerprint;
    void load();
    // `load` is rebuilt every render; the ref above is what stops repeats.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsMeta, loaded, loading, fingerprint]);

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
            Page ({pageRows.length})
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

      {/* A remembered filter is still a filter. Say so before the metadata lands,
          because until it does the controls below are hidden and the only visible
          symptom would be a short list. */}
      {active && (
        <div className="flex items-center gap-2 border-b border-slate-800 bg-sky-500/10 px-2 py-1 text-[10px] text-sky-200">
          <span>
            Filter active{needsMeta && !loaded && (loading ? ' · loading metadata…' : ' · waiting')}
          </span>
          <Button className="ml-auto" onClick={clearFilters} size="xs" variant="subtle">
            Clear
          </Button>
        </div>
      )}

      {/* Outside the `loaded` gate below: the page names each row's expansion,
          so this one works before anything has been looked up on Scryfall. */}
      {editionYears.length > 0 && (
        <div className="border-b border-slate-800 p-2 text-[11px]">
          <EditionFilter
            onClear={() => setEditions(new Set())}
            onToggle={key => toggle(editions, key, setEditions)}
            selected={editions}
            status={setStatus}
            years={editionYears}
          />
        </div>
      )}

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
              {filtered.map(({ name, meta, setName }, i) => (
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
                    {/* The set is worth naming here: a search page lists the
                        same card once per printing, and without it those rows
                        would be indistinguishable. */}
                    {(meta?.typeLine ?? setName) && (
                      <div className="truncate text-[10px] text-slate-500">
                        {[meta?.typeLine, setName].filter(Boolean).join(' · ')}
                      </div>
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
