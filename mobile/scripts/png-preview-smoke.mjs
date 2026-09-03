#!/usr/bin/env node
/**
 * Verify the debug PNG encoder against Node's real zlib + a PNG parser.
 *
 * The "Detector input" thumbnail is the primary diagnostic for the native
 * scanner, so it has to be trustworthy: a thumbnail that renders wrongly would
 * send us hunting a pixel bug that does not exist, and one that fails to decode
 * at all just shows a blank box on the phone with no explanation.
 *
 * So this decodes the produced PNG independently — real inflate, real CRC and
 * Adler checks — and asserts the pixels come back exactly as they went in.
 */

import { inflateSync } from 'node:zlib';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mobileRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(mobileRoot, '..');
const entry = join(mobileRoot, 'src/scan/debug/scanImagePng.ts');

const esbuild = await createRequire(join(repoRoot, 'package.json')).call(null, 'esbuild');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (ok) return;
  failures++;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
};

const bundleDir = await mkdtemp(join(tmpdir(), 'lugin-png-'));
const outfile = join(bundleDir, 'scanImagePng.mjs');

try {
  await esbuild.build({
    bundle: true,
    entryPoints: [entry],
    format: 'esm',
    outfile,
    platform: 'neutral',
    tsconfigRaw: {
      compilerOptions: { baseUrl: mobileRoot, paths: { '@/*': ['../src/*'] } },
    },
  });

  const { scanImageToPngDataUri } = await import(pathToFileURL(outfile).href);

  /** Minimal independent PNG reader: validates chunk CRCs and inflates IDAT. */
  const decodePng = (bytes) => {
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    for (let i = 0; i < sig.length; i++) {
      if (bytes[i] !== sig[i]) throw new Error(`bad signature at ${i}`);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let at = 8;
    let header = null;
    const idat = [];
    let sawEnd = false;

    const table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    const crc = (buf) => {
      let c = 0xffffffff;
      for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };

    while (at < bytes.length) {
      const length = view.getUint32(at);
      const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
      const body = bytes.subarray(at + 8, at + 8 + length);
      const stated = view.getUint32(at + 8 + length);
      const actual = crc(bytes.subarray(at + 4, at + 8 + length));
      if (stated !== actual) throw new Error(`CRC mismatch in ${type}`);

      if (type === 'IHDR') {
        header = {
          width: view.getUint32(at + 8),
          height: view.getUint32(at + 12),
          bitDepth: body[8],
          colorType: body[9],
          interlace: body[12],
        };
      } else if (type === 'IDAT') idat.push(Buffer.from(body));
      else if (type === 'IEND') sawEnd = true;

      at += 12 + length;
    }
    if (!header) throw new Error('no IHDR');
    if (!sawEnd) throw new Error('no IEND');

    // Node's inflate validates the zlib header and the Adler-32 trailer.
    const raw = inflateSync(Buffer.concat(idat));
    const stride = header.width * 4;
    if (raw.length !== (stride + 1) * header.height) {
      throw new Error(`raw is ${raw.length}, expected ${(stride + 1) * header.height}`);
    }
    const pixels = Buffer.alloc(stride * header.height);
    for (let y = 0; y < header.height; y++) {
      const filter = raw[y * (stride + 1)];
      if (filter !== 0) throw new Error(`row ${y} uses filter ${filter}`);
      raw.copy(pixels, y * stride, y * (stride + 1) + 1, (y + 1) * (stride + 1));
    }
    return { ...header, pixels };
  };

  const fromUri = (uri) => {
    const marker = 'data:image/png;base64,';
    if (!uri.startsWith(marker)) throw new Error(`unexpected prefix: ${uri.slice(0, 32)}`);
    return new Uint8Array(Buffer.from(uri.slice(marker.length), 'base64'));
  };

  /** Every pixel encodes its own coordinates, so any reordering is provable. */
  const makeImage = (width, height) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        data[i] = x;
        data[i + 1] = y;
        data[i + 2] = (x * 7 + y * 13) & 0xff;
        data[i + 3] = 255;
      }
    }
    return { data, height, width };
  };

  // 1. Round-trip at native size: decodes, and pixels survive byte-exact.
  {
    const image = makeImage(24, 17); // odd height, non-multiple-of-3 byte count
    const png = decodePng(fromUri(scanImageToPngDataUri(image, 120)));
    check('IHDR geometry', png.width === 24 && png.height === 17, `${png.width}×${png.height}`);
    check('8-bit RGBA, non-interlaced', png.bitDepth === 8 && png.colorType === 6 && png.interlace === 0);

    let mismatch = -1;
    for (let i = 0; i < image.data.length && mismatch < 0; i++) {
      if (png.pixels[i] !== image.data[i]) mismatch = i;
    }
    check('pixels round-trip byte-exact', mismatch < 0, mismatch >= 0 ? `first at byte ${mismatch}` : '');
  }

  // 2. Channel order must not be permuted by the encoder — otherwise the
  //    thumbnail would show a channel bug that is not in the detector input.
  {
    const image = { data: new Uint8ClampedArray([200, 40, 10, 255]), height: 1, width: 1 };
    const png = decodePng(fromUri(scanImageToPngDataUri(image, 120)));
    const [r, g, b] = png.pixels;
    check('R,G,B preserved in order', r === 200 && g === 40 && b === 10, `got ${r},${g},${b}`);
  }

  // 3. Downscale path still produces a valid PNG of the expected size.
  {
    const png = decodePng(fromUri(scanImageToPngDataUri(makeImage(480, 640), 120)));
    check('downscaled geometry', png.width === 120 && png.height === 160, `${png.width}×${png.height}`);
  }

  // 4. Multi-block path: >65535 raw bytes must split into several stored
  //    deflate blocks and still inflate as one stream.
  {
    const image = makeImage(200, 200); // 200*200*4 + 200 = 160200 bytes raw
    const png = decodePng(fromUri(scanImageToPngDataUri(image, 1000)));
    check('multi-block stream inflates', png.width === 200 && png.height === 200, `${png.width}×${png.height}`);
    check('multi-block pixels intact', png.pixels[0] === 0 && png.pixels[(199 * 200 + 199) * 4 + 1] === 199);
  }

  // 5. A 1×1 image must not produce a malformed zero-length block.
  {
    const png = decodePng(fromUri(scanImageToPngDataUri({ data: new Uint8ClampedArray([1, 2, 3, 255]), height: 1, width: 1 })));
    check('1×1 encodes', png.width === 1 && png.height === 1);
  }

  if (failures > 0) {
    console.error(`png-preview smoke: ${failures} check(s) failed`);
    process.exit(1);
  }

  console.log('png-preview smoke ok');
  console.log('  CRC + zlib/adler validated by node:zlib, pixels byte-exact, multi-block split');
} finally {
  await rm(bundleDir, { force: true, recursive: true });
}
