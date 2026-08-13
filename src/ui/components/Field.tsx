import {
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';

import { IconButton } from './IconButton';
import { Minus, Plus, Search, X } from './icons';

// Text entry, at the same 24px height as the buttons it sits next to.

export const Select = ({ className = '', ...rest }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select
    className={`h-6 min-w-0 rounded border border-line-strong bg-raised px-1.5 text-xs text-ink outline-none transition-colors focus:border-accent ${className}`}
    {...rest}
  />
);

export const TextInput = ({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) => (
  <input
    className={`h-6 min-w-0 rounded border border-line-strong bg-raised px-2 text-xs text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent ${className}`}
    {...rest}
  />
);

type StepperSize = 'xs' | 'sm';

const STEPPER: Record<StepperSize, { box: string; icon: number; input: string; step: string }> = {
  sm: { box: 'h-6', icon: 12, input: 'w-9 text-xs', step: 'w-5' },
  xs: { box: 'h-5', icon: 10, input: 'w-8 text-2xs', step: 'w-4' },
};

const STEP_BUTTON =
  'flex h-full flex-none items-center justify-center text-ink-muted transition-colors hover:bg-tint hover:text-ink disabled:cursor-default disabled:text-ink-faint disabled:opacity-40 disabled:hover:bg-transparent';

/**
 * A number field with its own − / + buttons. The browser's spinner is hidden
 * (see index.css): it steals the room the digits need and doesn't match anything
 * else here. Typing is free-form until you leave the field, so a value can be
 * cleared and retyped without every keystroke being clamped.
 */
export const NumberStepper = ({
  className = '',
  label,
  max = Infinity,
  min = 0,
  onChange,
  size = 'sm',
  step = 1,
  title,
  value,
}: {
  className?: string;
  /** Accessible name; the buttons derive theirs from it. */
  label: string;
  max?: number;
  min?: number;
  onChange: (value: number) => void;
  size?: StepperSize;
  step?: number;
  title?: string;
  value: number;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const s = STEPPER[size];
  const clamp = (n: number): number => Math.min(max, Math.max(min, n));
  const nudge = (by: number): void => {
    setDraft(null);
    onChange(clamp(value + by));
  };

  return (
    <span
      className={`inline-flex flex-none items-center overflow-hidden rounded border border-line-strong bg-raised ${s.box} ${className}`}
      title={title}
    >
      <button
        aria-label={`${label}: decrease`}
        className={`${STEP_BUTTON} ${s.step}`}
        disabled={value <= min}
        onClick={() => nudge(-step)}
        type="button"
      >
        <Minus aria-hidden size={s.icon} strokeWidth={2.5} />
      </button>
      <input
        aria-label={label}
        className={`h-full min-w-0 border-x border-line bg-transparent text-center text-ink tabular-nums outline-none focus:bg-tint ${s.input}`}
        max={max}
        min={min}
        onBlur={() => setDraft(null)}
        onChange={e => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== '' && !Number.isNaN(n)) onChange(clamp(n));
        }}
        // A focused number input otherwise counts up and down as the panel is
        // scrolled past it, quietly rewriting whatever it controls.
        onWheel={e => e.currentTarget.matches(':focus') && e.currentTarget.blur()}
        step={step}
        type="number"
        value={draft ?? String(value)}
      />
      <button
        aria-label={`${label}: increase`}
        className={`${STEP_BUTTON} ${s.step}`}
        disabled={value >= max}
        onClick={() => nudge(step)}
        type="button"
      >
        <Plus aria-hidden size={s.icon} strokeWidth={2.5} />
      </button>
    </span>
  );
};

/**
 * The search field used at the top of every list: magnifier inside the box, and
 * a clear button that appears once there's something to clear (so the row of
 * controls beside it doesn't reflow as you type).
 */
export const SearchInput = ({
  className = '',
  onClear,
  trailing,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  onClear?: () => void;
  /** Extra controls pinned inside the right-hand end of the field. */
  trailing?: ReactNode;
}) => (
  <div className={`relative flex min-w-0 flex-1 items-center ${className}`}>
    <Search aria-hidden className="pointer-events-none absolute left-2 text-ink-faint" size={12} />
    <input
      className="h-6 w-full rounded border border-line-strong bg-raised pl-[26px] pr-2 text-xs text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent"
      {...rest}
    />
    {(trailing || (onClear && rest.value)) && (
      <span className="absolute right-0.5 flex items-center gap-0.5">
        {trailing}
        {onClear && rest.value ? (
          <IconButton icon={X} label="Clear search" onClick={onClear} size="xs" />
        ) : null}
      </span>
    )}
  </div>
);
