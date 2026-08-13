// Turn dist/ into the zip the Chrome Web Store will accept, and refuse to
// produce one it would reject.
//
// Two things make this more than `zip -r`:
//
//   1. The manifest's `key` has to come back out. It pins local builds to the
//      published extension id (see src/manifest.config.ts), but the store
//      rejects any upload that declares its own key, and the rejection arrives
//      by email hours later. Stripping it here means dist/ stays loadable as an
//      unpacked extension with the real id while the zip stays uploadable.
//
//   2. The listing limits — name, description — are checked before upload
//      rather than after review.
//
// Dependency-free, like scripts/make-logos.mjs: a zip is a series of local
// headers over deflated bytes plus a central directory, and node has zlib.

import { deflateRawSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const OUT_DIR = join(ROOT, 'release');

// Sourcemaps are ~4x the bundle and no use to a reviewer or a tester; the store
// counts them against the package size limit all the same. The 192/512 icons are
// the phone build's — public/ is shared, the manifest only names 16 through 128.
const SKIP = [
  /\.map$/,
  /(^|\/)\.DS_Store$/,
  /icons\/icon-(192|512)\.png$/,
  /icons\/icon-maskable-/,
];

// Store limits. Exceeding either is a rejection, not a warning.
const MAX_NAME = 75;
const MAX_DESCRIPTION = 132;

// --- zip ---------------------------------------------------------------------

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

const dosTime = d => (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
const dosDate = d => ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

/** `entries` is [{ name, data }]; names use forward slashes, as zip requires. */
const zip = (entries) => {
  const now = new Date();
  const time = dosTime(now);
  const date = dosDate(now);
  const body = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    // Deflate can grow already-compressed bytes (the PNGs); store those raw.
    const useDeflate = deflated.length < data.length;
    const payload = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const crc = CRC(data);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // names are UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    const dir = Buffer.alloc(46 + nameBuf.length);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(time, 12);
    dir.writeUInt16LE(date, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(payload.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(0, 30); // extra + comment lengths
    dir.writeUInt16LE(0, 34); // first disk
    dir.writeUInt16LE(0, 36); // internal attributes
    dir.writeUInt32LE(0o644 << 16, 38); // external attributes: regular file
    dir.writeUInt32LE(offset, 42);
    nameBuf.copy(dir, 46);

    body.push(local, payload);
    central.push(dir);
    offset += local.length + payload.length;
  }

  const dirBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...body, dirBuf, end]);
};

// --- collect -----------------------------------------------------------------

const walk = (dir) => {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
};

const fail = (message) => {
  console.error(`✖ ${message}`);
  process.exitCode = 1;
};

let manifest;
try {
  manifest = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));
} catch {
  console.error('✖ no dist/manifest.json — run `yarn build` first');
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

if (manifest.version !== pkg.version) {
  fail(`dist is stale: manifest ${manifest.version} vs package.json ${pkg.version} — rebuild`);
}
if ((manifest.name ?? '').length > MAX_NAME) {
  fail(`name is ${manifest.name.length} characters, the store allows ${MAX_NAME}`);
}
if (!manifest.description) {
  fail('no description — the store requires one');
} else if (manifest.description.length > MAX_DESCRIPTION) {
  fail(`description is ${manifest.description.length} characters, the store allows ${MAX_DESCRIPTION}`);
}
for (const path of Object.values(manifest.icons ?? {})) {
  try {
    statSync(join(DIST, path));
  } catch {
    fail(`manifest lists ${path}, which isn't in dist/`);
  }
}
if (process.exitCode === 1) process.exit(1);

// Warnings: these produce a valid upload that behaves badly for testers.
const hadKey = 'key' in manifest;
delete manifest.key;
if (!hadKey) {
  console.warn(
    '! no LUGIN_EXTENSION_KEY set, so local builds get a random extension id and\n' +
    '  Google sign-in will fail against the registered redirect URI.\n' +
    '  Fine for a first upload — that is where the key comes from. See docs/DISTRIBUTION.md.',
  );
}
if (!/BETA|DEVELOPMENT BUILD/i.test(manifest.name ?? '')) {
  console.warn('! the store asks test builds to say "BETA" in the name; this one does not');
}

const entries = walk(DIST)
  .map(path => ({ name: relative(DIST, path).split(sep).join('/'), path }))
  .filter(({ name }) => !SKIP.some(re => re.test(name)))
  .sort((a, b) => a.name.localeCompare(b.name))
  .map(({ name, path }) => ({
    // The stripped manifest replaces the built one; everything else is copied.
    data: name === 'manifest.json' ? Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) : readFileSync(path),
    name,
  }));

const archive = zip(entries);
mkdirSync(OUT_DIR, { recursive: true });
const out = join(OUT_DIR, `lugin-${pkg.version}.zip`);
writeFileSync(out, archive);

const kb = n => `${(n / 1024).toFixed(0)} KB`;
console.log(`\n${relative(ROOT, out)}  ${kb(archive.length)}, ${entries.length} files`);
if (hadKey) console.log('manifest key stripped for upload (dist/ keeps it)');
console.log('\nnext: https://chrome.google.com/webstore/devconsole → Add new item');
