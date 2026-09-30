import { deckTagById } from '@/lib/deckTags';

import { Select } from './Field';

/**
 * Move a main-deck card into a tag section (or Main / auto). Shared by desktop
 * list+box and phone list+box so reorganization works the same everywhere.
 */
export const DeckCardTagMove = ({
  className = '',
  disabled,
  onChange,
  /** `undefined` = Auto (no override); `""` = force Main; else a tag id. */
  override,
  tagSectionIds,
}: {
  className?: string;
  disabled?: boolean;
  onChange: (tagId: string | null) => void;
  override?: string;
  tagSectionIds: readonly string[];
}) => {
  if (tagSectionIds.length === 0) return null;

  const value =
    override === undefined ? '__auto__' : override === '' ? '__main__' : override;

  return (
    <Select
      className={`max-w-[7.5rem] ${className}`}
      disabled={disabled}
      onChange={e => {
        const v = e.target.value;
        if (v === '__auto__') onChange(null);
        else if (v === '__main__') onChange('');
        else onChange(v);
      }}
      title="Put this card in a tag section"
      value={value}
    >
      <option value="__auto__">Auto</option>
      <option value="__main__">Main</option>
      {tagSectionIds.map(id => (
        <option key={id} value={id}>
          {deckTagById(id)?.label ?? id}
        </option>
      ))}
    </Select>
  );
};
