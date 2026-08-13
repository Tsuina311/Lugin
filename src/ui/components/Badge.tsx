import type { ReactNode } from 'react';

// A count or short status word. Tones are semantic, not colors, so they follow
// the theme: `pos` for owned/complete, `warn` for pending, `neg` for missing.

export type BadgeTone = 'accent' | 'neutral' | 'pos' | 'warn' | 'neg';

const TONE_CLASSES: Record<BadgeTone, string> = {
  accent: 'bg-accent-soft text-accent',
  neg: 'bg-neg-soft text-neg',
  neutral: 'bg-tint-strong text-ink-muted',
  pos: 'bg-pos-soft text-pos',
  warn: 'bg-warn-soft text-warn',
};

export const Badge = ({
  children,
  className = '',
  title,
  tone = 'neutral',
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  tone?: BadgeTone;
}) => (
  <span
    className={`inline-flex h-4 min-w-4 flex-none items-center justify-center rounded-full px-1 text-2xs font-medium tabular-nums ${TONE_CLASSES[tone]} ${className}`}
    title={title}
  >
    {children}
  </span>
);
