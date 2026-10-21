/** Whether applying a synced country needs a Chrome storage write. */
export const shouldWriteHomeCountry = (
  stored: number | null | undefined,
  incoming: number | null,
): boolean => (stored ?? null) !== incoming;
