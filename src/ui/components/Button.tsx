import type { ButtonHTMLAttributes, ReactNode } from 'react';

import type { LucideIcon } from './icons';

// The one button in the overlay. Colors come from the semantic tokens (see
// index.css / tailwind.config.js), so both themes are covered by one class list
// and nothing here names a raw color.
//
// The variants, in order of how loudly they ask to be pressed:
//   primary  accent fill — the one action a view is about
//   danger   destructive fill
//   success  affirmative fill (imports, "got it all")
//   neutral  raised surface with an edge — the default, a real but quiet button
//   subtle   ghost: no chrome until hovered, for toolbars and dense rows
// `active` overrides all of them with the selected look, for toggles.

export type ButtonVariant = 'primary' | 'success' | 'neutral' | 'subtle' | 'danger';
export type ButtonSize = 'xs' | 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Selected/pressed toggle state; also sets `aria-pressed`. */
  active?: boolean;
  children?: ReactNode;
  /** Leading icon, sized to the button. */
  icon?: LucideIcon;
  /** Fully-rounded (segmented toggles, floating buttons). */
  pill?: boolean;
  size?: ButtonSize;
  variant?: ButtonVariant;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  danger: 'border-neg bg-neg text-white hover:brightness-110',
  neutral: 'border-line-strong bg-raised text-ink hover:bg-tint-strong',
  primary: 'border-accent bg-accent text-accent-ink hover:brightness-110',
  subtle: 'border-transparent text-ink-muted hover:bg-tint hover:text-ink',
  success: 'border-pos bg-pos text-canvas hover:brightness-110',
};

// The selected state of a toggle: an accent tint rather than a fill, so a row of
// them reads as a set with one chosen instead of a wall of blue.
const ACTIVE_CLASSES = 'border-accent bg-accent-soft text-accent';

// Fixed heights keep buttons aligned with the inputs and rows beside them.
const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: 'h-7 gap-1.5 px-2.5 text-sm',
  sm: 'h-6 px-2 text-xs',
  xs: 'h-5 px-1.5 text-2xs',
};

const ICON_SIZE: Record<ButtonSize, number> = { md: 14, sm: 13, xs: 11 };

export const Button = ({
  variant = 'neutral',
  size = 'sm',
  pill = false,
  active = false,
  icon: Icon,
  className = '',
  type,
  children,
  ...rest
}: ButtonProps) => (
  <button
    aria-pressed={active || undefined}
    className={`lugin-btn ${pill ? 'rounded-full' : 'rounded'} ${SIZE_CLASSES[size]} ${
      active ? ACTIVE_CLASSES : VARIANT_CLASSES[variant]
    } ${className}`}
    type={type ?? 'button'}
    {...rest}
  >
    {Icon && <Icon aria-hidden size={ICON_SIZE[size]} strokeWidth={2} />}
    {children}
  </button>
);
