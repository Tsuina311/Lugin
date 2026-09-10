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
 * Encode `image` as an uncompressed PNG byte buffer (optionally downscaled).
 *
 * Pass the image width (or larger) to keep full resolution — recognition export
 * must not shrink 744×1039 or title/rules become unreadable.
 */
export const scanImageToPngBytes = (image: ScanImage, maxWidth = 120): Uint8Array => {
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
  return png;
};

/**
 * `data:image/png;base64,…` for `image`, downscaled to `maxWidth` when larger.
 *
 * Pass the image width (or larger) to keep full resolution — recognition export
 * must not shrink 744×1039 or title/rules become unreadable.
 */
export const scanImageToPngDataUri = (image: ScanImage, maxWidth = 120): string =>
  `data:image/png;base64,${base64(scanImageToPngBytes(image, maxWidth))}`;

export const bytesToBase64 = (bytes: Uint8Array): string => base64(bytes);

const fromBase64 = (text: string): Uint8Array => {
  const clean = text.replace(/[^A-Za-z0-9+/=]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  const val = (c: string): number => {
    if (c >= 'A' && c <= 'Z') return c.charCodeAt(0) - 65;
    if (c >= 'a' && c <= 'z') return c.charCodeAt(0) - 71;
    if (c >= '0' && c <= '9') return c.charCodeAt(0) + 4;
    if (c === '+') return 62;
    if (c === '/') return 63;
    return 0;
  };
  for (let i = 0; i + 3 < clean.length; i += 4) {
    const n = (val(clean[i]) << 18) | (val(clean[i + 1]) << 12) | (val(clean[i + 2]) << 6) | val(clean[i + 3]);
    out[o++] = (n >>> 16) & 255;
    if (clean[i + 2] !== '=') out[o++] = (n >>> 8) & 255;
    if (clean[i + 3] !== '=') out[o++] = n & 255;
  }
  return out.subarray(0, o);
};

const inflateStoredZlib = (zlib: Uint8Array): Uint8Array => {
  if (zlib.length < 6) throw new Error('zlib too short');
  let at = 2;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (at + 5 <= zlib.length) {
    const header = zlib[at];
    const final = (header & 1) === 1;
    const btype = (header >>> 1) & 3;
    if (btype !== 0) throw new Error('png inflate: only stored blocks supported');
    at += 1;
    const len = zlib[at] | (zlib[at + 1] << 8);
    at += 4;
    chunks.push(zlib.subarray(at, at + len));
    total += len;
    at += len;
    if (final) break;
  }
  const raw = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    raw.set(c, o);
    o += c.length;
  }
  return raw;
};

/** Decode a PNG written by {@link scanImageToPngBytes} (stored zlib, filter 0, RGBA). */
export const pngBytesToScanImage = (png: Uint8Array): ScanImage => {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (png[i] !== PNG_SIGNATURE[i]) throw new Error('not a PNG');
  }
  let width = 0;
  let height = 0;
  const idats: Uint8Array[] = [];
  let at = 8;
  while (at + 12 <= png.length) {
    const len = (png[at] << 24) | (png[at + 1] << 16) | (png[at + 2] << 8) | png[at + 3];
    const type = String.fromCharCode(png[at + 4], png[at + 5], png[at + 6], png[at + 7]);
    const body = png.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      width = (body[0] << 24) | (body[1] << 16) | (body[2] << 8) | body[3];
      height = (body[4] << 24) | (body[5] << 16) | (body[6] << 8) | body[7];
    } else if (type === 'IDAT') {
      idats.push(body);
    } else if (type === 'IEND') {
      break;
    }
    at += 12 + len;
  }
  const zlib = new Uint8Array(idats.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of idats) {
    zlib.set(c, o);
    o += c.length;
  }
  const raw = inflateStoredZlib(zlib);
  const stride = width * 4;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    if (raw[row] !== 0) throw new Error('png filter not 0');
    data.set(raw.subarray(row + 1, row + 1 + stride), y * stride);
  }
  return { data, height, width };
};

export const pngBase64ToScanImage = (b64: string): ScanImage => pngBytesToScanImage(fromBase64(b64));

