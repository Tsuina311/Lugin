/** The 672×938 scan of a Goldfish card image. Other URLs pass through unchanged. */
export const goldfishZoomUrl = (url: string): string =>
  url.replace(
    /^(https:\/\/cards\.mtggoldfish\.com\/images\/[^/]+\/variants)\/\d+\/\d+\//i,
    '$1/672/938/',
  );
