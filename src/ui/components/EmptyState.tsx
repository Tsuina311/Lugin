import type { ReactNode } from 'react';

import type { LucideIcon } from './icons';

// What a list shows when it has nothing to show: what's missing, and the one
// thing to do about it. Used instead of a bare line of grey text.

export const EmptyState = ({
  action,
  hint,
  icon: Icon,
  title,
}: {
  /** A button that resolves the emptiness, when there is one. */
  action?: ReactNode;
  hint?: string;
  icon?: LucideIcon;
  title: string;
}) => (
  <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-8 text-center">
    {Icon && <Icon aria-hidden className="text-ink-faint" size={22} strokeWidth={1.5} />}
    <div className="text-xs font-medium text-ink-muted">{title}</div>
    {hint && <div className="max-w-[36ch] text-2xs leading-relaxed text-ink-faint">{hint}</div>}
    {action && <div className="mt-1">{action}</div>}
  </div>
);
