/**
 * Locked before any phone-identity scores.
 * The frozen unseen-card holdout decides the recommendation.
 * Dev scores may choose linear versus residual MLP. They cannot move this rule.
 */

export const recommend = ({ holdoutTop1, baselineTop1, fixes, regressions }) => {
  if (holdoutTop1 > baselineTop1 && regressions === 0 && fixes > 0) return 'RECOGNITION_ADAPTER_STRONG_WIN';
  if (holdoutTop1 > baselineTop1 && fixes > regressions) return 'RECOGNITION_ADAPTER_PROMISING';
  return 'KEEP_B1';
};

/** One class per miss. Earlier lines win. */
export const failureClass = row => {
  if (row.top1) return null;
  if (!row.inGallery) return 'GALLERY_MISMATCH';
  if (row.badCapture) return 'BAD_CAPTURE';
  if (row.glareOrFoil) return 'GLARE_OR_FOIL';
  if (row.rank != null && row.rank <= 10) return 'VISUALLY_SIMILAR';
  if (row.alternateArt) return 'ALTERNATE_ART';
  if (row.rank == null || row.rank > 10) return 'EMBEDDING_FAILURE';
  return 'UNKNOWN';
};
