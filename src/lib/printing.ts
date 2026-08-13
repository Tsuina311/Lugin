// Which printing of a card the user says they own.
//
// Lives here rather than beside its store because it's part of the portable
// data model — it travels between devices, so it can't be declared in a module
// that only exists inside a Chrome content script.

/** The exact printing the user picked, with enough to render its image. */
export interface CardImageOverride {
  collectorNumber?: string;
  imageUrl?: string;
  scryfallId?: string;
  setCode?: string;
  setName?: string;
}
