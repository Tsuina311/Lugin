import type { ButtonHTMLAttributes } from 'react';

import type { LucideIcon } from './icons';

// A square, label-less button for toolbars and row affordances. `label` is
// mandatory: it becomes both the accessible name and the tooltip, since an icon
// on its own never explains itself.

export type IconButtonSize = 'xs' | 'sm' | 'md';
export type IconButtonTone = 'default' | 'accent' | 'danger';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  /** Selected/pressed state; also sets `aria-pressed`. */
  active?: boolean;
  icon: LucideIcon;
  label: string;
  size?: IconButtonSize;
  tone?: IconButtonTone;
}

const SIZE_CLASSES: Record<IconButtonSize, string> = {
  md: 'h-7 w-7',
  sm: 'h-6 w-6',
  xs: 'h-5 w-5',
};

const ICON_SIZE: Record<IconButtonSize, number> = { md: 15, sm: 14, xs: 12 };

const TONE_CLASSES: Record<IconButtonTone, string> = {
  accent: 'text-accent hover:bg-accent-soft',
  danger: 'text-ink-faint hover:bg-neg-soft hover:text-neg',
  default: 'text-ink-muted hover:bg-tint hover:text-ink',
};

export const IconButton = ({
  active = false,
  className = '',
  icon: Icon,
  label,
  size = 'sm',
  tone = 'default',
  type,
  ...rest
}: IconButtonProps) => (
  <button
    aria-label={label}
    aria-pressed={active || undefined}
    className={`lugin-btn flex-none rounded border-transparent ${SIZE_CLASSES[size]} ${
      active ? 'bg-accent-soft text-accent' : TONE_CLASSES[tone]
    } ${className}`}
    title={label}
    type={type ?? 'button'}
    {...rest}
  >
    <Icon aria-hidden size={ICON_SIZE[size]} strokeWidth={2} />
  </button>
);
