// Whether the copies you own cover every deck that plays this card.
// A green check when they do. A paper deck takes its copies out first, and
// what remains for the other lists is shown as a different mark.

import { Badge } from './Badge';
import { Check } from './icons';

import { coverageView, type DeckCopyUse } from '@/lib/deck';

export const CopyCoverage = ({
  hereFrozen = false,
  owned,
  uses,
}: {
  hereFrozen?: boolean;
  owned: number;
  uses: readonly DeckCopyUse[];
}) => {
  const view = coverageView(owned, uses, hereFrozen);
  if (!view) return null;
  if (view.check) {
    return (
      <Badge title={view.title} tone={view.tone}>
        <Check aria-hidden size={10} strokeWidth={3} />
      </Badge>
    );
  }
  return (
    <Badge title={view.title} tone={view.tone}>
      {view.fraction}
    </Badge>
  );
};
