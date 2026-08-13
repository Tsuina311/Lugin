// Shared styling for the little round mana-color buttons used by the filters.
// `C` stands for colorless and only makes sense where cards are being matched by
// their own colors — identity pickers use WUBRG and treat "nothing selected" as
// colorless (see the deck builder's search box).

export interface ColorPip {
  /** Tailwind classes for the pip's resting look. */
  cls: string;
  code: string;
  label: string;
}

export const COLOR_PIPS: ColorPip[] = [
  { cls: 'bg-amber-100 text-amber-900', code: 'W', label: 'W' },
  { cls: 'bg-sky-500 text-white', code: 'U', label: 'U' },
  { cls: 'bg-slate-700 text-slate-100', code: 'B', label: 'B' },
  { cls: 'bg-red-500 text-white', code: 'R', label: 'R' },
  { cls: 'bg-emerald-600 text-white', code: 'G', label: 'G' },
  { cls: 'bg-slate-400 text-slate-900', code: 'C', label: 'C' },
];
