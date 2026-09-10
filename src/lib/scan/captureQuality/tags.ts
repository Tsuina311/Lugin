import type { CaptureQualityBundle } from './types';

/** Debug labels only. Word-boundary so "unsleeved" is not "sleeved". */
export const tagsFromLabel = (label: string): CaptureQualityBundle['tags'] => {
  const low = label.toLowerCase();
  return {
    borderStyle: /old|classic|weatherlight|6th/.test(low) ? 'classic' : null,
    foil: /foil/.test(low) ? true : /non-?foil/.test(low) ? false : null,
    glare: null,
    language: /french|fr\b|lames|cultiste/.test(low)
      ? 'fr'
      : /italian|it\b|svignarsela/.test(low)
        ? 'it'
        : /english|en\b/.test(low)
          ? 'en'
          : null,
    sleeved: /\bunsleeved\b/.test(low) ? false : /\bsleeved\b|\bsleeve\b/.test(low) ? true : null,
  };
};
