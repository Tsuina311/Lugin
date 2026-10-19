import jsQR from 'jsqr';

/** Read one QR from RGBA pixels. Returns the payload, or null. */
export const decodePairQr = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
): string | null => {
  if (width < 21 || height < 21 || data.length < width * height * 4) return null;
  const found = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
  const text = found?.data?.trim() ?? '';
  return text || null;
};
