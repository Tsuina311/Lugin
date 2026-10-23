export const VNEXT_PARITY_FIXTURE_WIDTH = 625;
export const VNEXT_PARITY_FIXTURE_HEIGHT = 436;
export const VNEXT_PARITY_FIXTURE_ID = 'vnext-rgba-pattern-v1';

/**
 * Synthetic, deterministic RGBA fixture. It contains no camera/user data and
 * exercises the exact native preprocessing path from prepared 625×436 pixels.
 */
export const createVNextParityFixtureRgba = (): Uint8Array => {
  const out = new Uint8Array(
    VNEXT_PARITY_FIXTURE_WIDTH * VNEXT_PARITY_FIXTURE_HEIGHT * 4,
  );
  let offset = 0;
  for (let y = 0; y < VNEXT_PARITY_FIXTURE_HEIGHT; y++) {
    for (let x = 0; x < VNEXT_PARITY_FIXTURE_WIDTH; x++) {
      out[offset++] = (x * 13 + y * 7 + ((x * y) % 251)) & 0xff;
      out[offset++] = (x * 3 + y * 17 + ((x ^ y) % 239)) & 0xff;
      out[offset++] = (x * 19 + y * 5 + ((x + y) % 233)) & 0xff;
      out[offset++] = 255;
    }
  }
  return out;
};
