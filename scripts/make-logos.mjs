// Turn the two supplied logo files into the sizes and variants the app needs.
//
// Kept as a script rather than done once by hand so the assets can be
// regenerated when the artwork changes, and so what was done to them is
// written down: both originals arrive as opaque 1024px squares on white, which
// is wrong for a toolbar icon (it shows as a white tile) and wrong for the
// overlay header (the panel is dark).
//
// Deliberately dependency-free. PNG is a container around a zlib stream, and
// node has zlib, so pulling in an image library to crop and scale two files
// would cost more than it saves.

import { deflateSync, inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

// --- PNG ---------------------------------------------------------------------

const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return buf => {
    let c = -1;
    for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

/** Undo one scanline's filter, in place. `bpp` is bytes per pixel. */
const unfilter = (type, line, prev, bpp) => {
  const n = line.length;
  if (type === 1) for (let i = bpp; i < n; i += 1) line[i] = (line[i] + line[i - bpp]) & 0xff;
  else if (type === 2) for (let i = 0; i < n; i += 1) line[i] = (line[i] + prev[i]) & 0xff;
  else if (type === 3) {
    for (let i = 0; i < n; i += 1) {
      const left = i >= bpp ? line[i - bpp] : 0;
      line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xff;
    }
  } else if (type === 4) {
    for (let i = 0; i < n; i += 1) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
    }
  } else if (type !== 0) throw new Error(`unsupported PNG filter ${type}`);
};

/** Read a PNG into straight RGBA. Handles what these files actually are. */
const decode = (path) => {
  const buf = readFileSync(path);
  let at = 8;
  let head;
  const idat = [];

  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const kind = buf.toString('ascii', at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + len);
    if (kind === 'IHDR') {
      head = {
        bitDepth: body[8],
        colorType: body[9],
        height: body.readUInt32BE(4),
        interlace: body[12],
        width: body.readUInt32BE(0),
      };
    } else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
    at += 12 + len;
  }

  if (!head) throw new Error(`${path}: no IHDR`);
  if (head.bitDepth !== 8 || head.interlace !== 0) {
    throw new Error(`${path}: only 8-bit non-interlaced PNGs, got depth ${head.bitDepth}`);
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[head.colorType];
  if (!channels) throw new Error(`${path}: unsupported colour type ${head.colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const { width, height } = head;
  const stride = width * channels;
  const rgba = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);

  for (let y = 0; y < height; y += 1) {
    const start = y * (stride + 1);
    const line = Uint8Array.prototype.slice.call(raw, start + 1, start + 1 + stride);
    unfilter(raw[start], line, prev, channels);
    prev = line;

    for (let x = 0; x < width; x += 1) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      if (channels <= 2) {
        rgba.fill(line[s], d, d + 3);
        rgba[d + 3] = channels === 2 ? line[s + 1] : 255;
      } else {
        rgba[d] = line[s];
        rgba[d + 1] = line[s + 1];
        rgba[d + 2] = line[s + 2];
        rgba[d + 3] = channels === 4 ? line[s + 3] : 255;
      }
    }
  }
  return { data: rgba, height, width };
};

const chunk = (kind, body) => {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  out.write(kind, 4, 'ascii');
  Buffer.from(body).copy(out, 8);
  out.writeUInt32BE(CRC(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
};

const encode = ({ data, height, width }) => {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // no filter: these are small, and zlib copes
    Buffer.from(data.buffer, y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

// --- operations --------------------------------------------------------------

const at = (img, x, y) => (y * img.width + x) * 4;

/**
 * Make the surround transparent without touching the white *inside* the art.
 *
 * A plain "replace all white" would hollow out the card faces and leave black
 * outlines that vanish on a dark toolbar, so this floods inwards from the edges
 * instead and stops at the first dark pixel.
 */
const backgroundToAlpha = (img, tolerance = 26) => {
  const { height, width } = img;
  const seen = new Uint8Array(width * height);
  const stack = [];
  const near = i =>
    img.data[i] >= 255 - tolerance &&
    img.data[i + 1] >= 255 - tolerance &&
    img.data[i + 2] >= 255 - tolerance;

  for (let x = 0; x < width; x += 1) stack.push([x, 0], [x, height - 1]);
  for (let y = 0; y < height; y += 1) stack.push([0, y], [width - 1, y]);

  while (stack.length > 0) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const p = y * width + x;
    if (seen[p]) continue;
    seen[p] = 1;
    const i = at(img, x, y);
    if (!near(i)) continue;
    img.data[i + 3] = 0;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return img;
};

/** Crop to the visible art, then pad by a fraction of the longest side. */
const trim = (img, padRatio = 0) => {
  let top = img.height;
  let left = img.width;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      if (img.data[at(img, x, y) + 3] === 0) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  const pad = Math.round(Math.max(right - left, bottom - top) * padRatio);
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(img.width - 1, right + pad);
  bottom = Math.min(img.height - 1, bottom + pad);

  const width = right - left + 1;
  const height = bottom - top + 1;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const from = ((y + top) * img.width + left) * 4;
    data.set(img.data.subarray(from, from + width * 4), y * width * 4);
  }
  return { data, height, width };
};

/** Centre the art on a transparent square, so every icon size is square. */
const square = (img) => {
  const side = Math.max(img.width, img.height);
  const data = new Uint8Array(side * side * 4);
  const dx = Math.floor((side - img.width) / 2);
  const dy = Math.floor((side - img.height) / 2);
  for (let y = 0; y < img.height; y += 1) {
    data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((y + dy) * side + dx) * 4);
  }
  return { data, height: side, width: side };
};

/**
 * Area-average downscale. Sampling a single pixel would shred 1024px artwork at
 * 16px; averaging the whole source region is what keeps the L legible.
 */
const resize = (img, width, height) => {
  const data = new Uint8Array(width * height * 4);
  const sx = img.width / width;
  const sy = img.height / height;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let j = Math.floor(y * sy); j < Math.min(img.height, Math.ceil((y + 1) * sy)); j += 1) {
        for (let i = Math.floor(x * sx); i < Math.min(img.width, Math.ceil((x + 1) * sx)); i += 1) {
          const s = at(img, i, j);
          const alpha = img.data[s + 3] / 255;
          // Weight colour by alpha, or transparent pixels drag everything
          // towards black and leave a dark fringe.
          r += img.data[s] * alpha;
          g += img.data[s + 1] * alpha;
          b += img.data[s + 2] * alpha;
          a += img.data[s + 3];
          n += 1;
        }
      }
      const d = (y * width + x) * 4;
      const weight = a / 255 || 1;
      data[d] = Math.round(r / weight);
      data[d + 1] = Math.round(g / weight);
      data[d + 2] = Math.round(b / weight);
      data[d + 3] = Math.round(a / n);
    }
  }
  return { data, height, width };
};

/**
 * Flatten the art onto an opaque square, scaled to `fraction` of the side.
 *
 * For Android's maskable icons, which the launcher crops to whatever shape the
 * device uses — a circle, a squircle, a rounded square. Only the inner 80% is
 * guaranteed to survive, so the art is deliberately small and the background
 * reaches every edge. A transparent icon would also disappear entirely against
 * a dark launcher, which is what the flattening is for.
 */
const onBackground = (img, side, [r, g, b], fraction) => {
  const data = new Uint8Array(side * side * 4);
  for (let p = 0; p < data.length; p += 4) {
    data[p] = r;
    data[p + 1] = g;
    data[p + 2] = b;
    data[p + 3] = 255;
  }

  const inner = Math.round(side * fraction);
  const art = resize(img, inner, inner);
  const offset = Math.floor((side - inner) / 2);

  for (let y = 0; y < inner; y += 1) {
    for (let x = 0; x < inner; x += 1) {
      const s = (y * inner + x) * 4;
      const alpha = art.data[s + 3] / 255;
      if (alpha === 0) continue;
      const d = ((y + offset) * side + x + offset) * 4;
      for (let c = 0; c < 3; c += 1) {
        data[d + c] = Math.round(art.data[s + c] * alpha + data[d + c] * (1 - alpha));
      }
    }
  }
  return { data, height: side, width: side };
};

/** Lift the near-black ink to a colour that reads on a dark panel. */
const inkTo = (img, [r, g, b], limit = 110) => {
  const out = { data: Uint8Array.from(img.data), height: img.height, width: img.width };
  for (let p = 0; p < out.data.length; p += 4) {
    if (out.data[p + 3] === 0) continue;
    const lum = 0.2126 * out.data[p] + 0.7152 * out.data[p + 1] + 0.0722 * out.data[p + 2];
    if (lum > limit) continue;
    // Keep the pixel's own darkness as a blend factor so edges stay smooth.
    const k = 1 - lum / limit;
    out.data[p] = Math.round(out.data[p] * (1 - k) + r * k);
    out.data[p + 1] = Math.round(out.data[p + 1] * (1 - k) + g * k);
    out.data[p + 2] = Math.round(out.data[p + 2] * (1 - k) + b * k);
  }
  return out;
};

const write = (rel, img) => {
  const path = join(ROOT, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, encode(img));
  console.log(`  ${rel}  ${img.width}×${img.height}`);
};

// --- the assets --------------------------------------------------------------

const [markSrc, logoSrc] = process.argv.slice(2);
if (!markSrc || !logoSrc) {
  console.error('usage: node scripts/make-logos.mjs <mark.png> <full-logo.png>');
  console.error('inputs must be real 8-bit PNGs: sips -s format png in.jpg --out out.png');
  process.exit(1);
}

console.log('toolbar & app icons:');
const mark = square(trim(backgroundToAlpha(decode(markSrc)), 0.04));
// 16–128 are the extension's; 192 and 512 are what a web app manifest must offer
// before a phone will offer to install it.
for (const size of [16, 32, 48, 128, 192, 512]) {
  write(`public/icons/icon-${size}.png`, resize(mark, size, size));
}

console.log('maskable icon:');
write('public/icons/icon-maskable-512.png', onBackground(mark, 512, [247, 249, 252], 0.6));

console.log('overlay wordmark:');
const logo = trim(backgroundToAlpha(decode(logoSrc)));
const scale = 64 / logo.height; // 4× the 16px it renders at, for sharp text
const small = resize(logo, Math.round(logo.width * scale), 64);
write('public/icons/logo.png', small);
// The navy ink disappears against our own dark panel, so keep a lifted copy.
write('public/icons/logo-dark.png', inkTo(small, [237, 242, 249]));
