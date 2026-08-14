import type { LucideIcon } from './icons';
import { LayoutGrid, List } from './icons';

// Segmented list/box switch. Shared so Cards, Collection and Wants all show
// the same control — a joined pair, not two free-floating icon buttons — with
// a filled accent segment for the active view so the choice reads at a glance
// on both themes (the old soft tint was easy to miss on the site theme).

export type ViewShape = 'list' | 'box';

const SEGMENT: { icon: LucideIcon; id: ViewShape; label: string }[] = [
  { icon: List, id: 'list', label: 'Show as rows' },
  { icon: LayoutGrid, id: 'box', label: 'Show as card images' },
];

export const ViewToggle = ({
  onChange,
  value,
}: {
  onChange: (next: ViewShape) => void;
  value: ViewShape;
}) => (
  <div
    className="flex flex-none overflow-hidden rounded border border-line-strong"
    role="group"
    title="Switch between list and box view"
  >
    {SEGMENT.map(({ icon: Icon, id, label }) => {
      const on = value === id;
      return (
        <button
          key={id}
          aria-label={label}
          aria-pressed={on}
          className={`flex h-6 w-7 items-center justify-center transition-colors ${
            on
              ? 'bg-accent text-accent-ink'
              : 'bg-raised text-ink-faint hover:bg-tint hover:text-ink'
          }`}
          onClick={() => onChange(id)}
          title={label}
          type="button"
        >
          <Icon aria-hidden size={13} strokeWidth={2.25} />
        </button>
      );
    })}
  </div>
);
