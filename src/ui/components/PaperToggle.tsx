// Marks a list as a deck that exists in paper, exactly as written.
// The box stays quiet until every non-basic copy is free to sleeve.

export const PaperToggle = ({
  canMark,
  checked,
  onChange,
  title,
}: {
  canMark: boolean;
  checked: boolean;
  onChange: (frozen: boolean) => void;
  title: string;
}) => (
  <span className="inline-flex flex-none" title={title}>
    <label
      className={`inline-flex items-center gap-1 text-2xs ${
        canMark ? 'text-ink-muted' : 'cursor-not-allowed text-ink-faint'
      }`}
    >
      <input
        checked={checked}
        className={`h-3.5 w-3.5 accent-[color:var(--lugin-accent)] ${canMark ? '' : 'pointer-events-none'}`}
        disabled={!canMark}
        onChange={event => onChange(event.target.checked)}
        type="checkbox"
      />
      Paper
    </label>
  </span>
);
