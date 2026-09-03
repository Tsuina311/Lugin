// Encode a `ScanImage` as a PNG data URI, in pure JS.
//
// This exists for one diagnostic: showing the *exact* buffer handed to
// `detectCardQuad`, not the camera preview. A wrong channel order, a stride
// shear, a bad rotation, a mirrored frame or an all-black buffer are all
// instantly recognisable by eye and nearly indistinguishable from each other
// in numbers, so the thumbnail is the highest-value signal in the debug panel.
//
// Why encode by hand rather than use a native image module: PNG is the one
// format React Native's `<Image>` is guaranteed to decode on both platforms,
// and a pure function can be verified offline against Node's `zlib` (see
// `mobile/scripts/png-preview-smoke.mjs`). A native path could only be
// verified on a device, which is exactly the loop we are trying to shorten.
//
// Compression is deliberately omitted — deflate "stored" blocks. The output is
// a debug thumbnail of a few hundred pixels updated once or twice a second, so
// bytes are free and a real deflate implementation would be a liability.

import type { ScanImage } from '../sharedCore';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Deflate stored blocks carry a 16-bit length. */
const MAX_BLOCK = 0xffff;

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const adler32 = (bytes: Uint8Array): number => {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
};

const base64 = (bytes: Uint8Array): string => {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63] + B64[(n >>> 6) & 63] + B64[n & 63];
  }
  const left = bytes.length - i;
  if (left === 1) {
    const n = bytes[i] << 16;
    out += `${B64[(n >>> 18) & 63]}${B64[(n >>> 12) & 63]}==`;
  } else if (left === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += `${B64[(n >>> 18) & 63]}${B64[(n >>> 12) & 63]}${B64[(n >>> 6) & 63]}=`;
  }
  return out;
};

/** Nearest-neighbour downscale; keeps artefacts visible instead of blurring them away. */
const shrink = (image: ScanImage, maxWidth: number): ScanImage => {
  if (image.width <= maxWidth) return image;
  const scale = maxWidth / image.width;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(image.height - 1, Math.floor((y * image.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(image.width - 1, Math.floor((x * image.width) / width));
      const from = (sy * image.width + sx) * 4;
      const to = (y * width + x) * 4;
      data[to] = image.data[from];
      data[to + 1] = image.data[from + 1];
      data[to + 2] = image.data[from + 2];
      data[to + 3] = 255;
    }
  }
  return { data, height, width };
};

const chunk = (type: string, body: Uint8Array): Uint8Array => {
  const out = new Uint8Array(body.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(out.length - 4, crc32(out.subarray(4, out.length - 4)));
  return out;
};

/** zlib stream wrapping uncompressed deflate blocks. */
const storedZlib = (raw: Uint8Array): Uint8Array => {
  const blocks = Math.max(1, Math.ceil(raw.length / MAX_BLOCK));
  const out = new Uint8Array(2 + blocks * 5 + raw.length + 4);
  let at = 0;
  out[at++] = 0x78; // CM=8 (deflate), CINFO=7 (32K window)
  out[at++] = 0x01; // no dictionary; (0x78<<8 | 0x01) % 31 === 0
  for (let offset = 0; offset < raw.length || offset === 0; offset += MAX_BLOCK) {
    const len = Math.min(MAX_BLOCK, raw.length - offset);
    const final = offset + len >= raw.length ? 1 : 0;
    out[at++] = final; // BFINAL, BTYPE=00 (stored)
    out[at++] = len & 0xff;
    out[at++] = (len >>> 8) & 0xff;
    out[at++] = ~len & 0xff;
    out[at++] = (~len >>> 8) & 0xff;
    out.set(raw.subarray(offset, offset + len), at);
    at += len;
    if (final) break;
  }
  const adler = adler32(raw);
  out[at++] = (adler >>> 24) & 0xff;
  out[at++] = (adler >>> 16) & 0xff;
  out[at++] = (adler >>> 8) & 0xff;
  out[at++] = adler & 0xff;
  return out.subarray(0, at);
};

/**
 * `data:image/png;base64,…` for `image`, downscaled to `maxWidth`.
 *
 * Pixels are copied verbatim apart from the downscale, so whatever is wrong
 * with the detector's input is visibly wrong in the result.
 */
export const scanImageToPngDataUri = (image: ScanImage, maxWidth = 120): string => {
  const small = shrink(image, maxWidth);

  // PNG scanlines: one filter byte (0 = none) per row, then RGBA.
  const stride = small.width * 4;
  const raw = new Uint8Array((stride + 1) * small.height);
  for (let y = 0; y < small.height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(small.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  const header = new DataView(ihdr.buffer);
  header.setUint32(0, small.width);
  header.setUint32(4, small.height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: truecolour with alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const parts = [
    new Uint8Array(PNG_SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', storedZlib(raw)),
    chunk('IEND', new Uint8Array(0)),
  ];

  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    png.set(part, at);
    at += part.length;
  }

  return `data:image/png;base64,${base64(png)}`;
};
