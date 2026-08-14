// Move the part of the version a person decides. (`yarn bump:minor` / `bump:major`)
//
// Only MAJOR and MINOR live in package.json; the third number is the commit count
// and looks after itself (see build/version.ts and docs/VERSIONING.md). So this
// edits one field and stops — no tag, no commit, no publish. The bump belongs in
// the same commit as the change that earned it, which is a thing only the author
// can do.
//
// Yarn Berry keeps `yarn version` behind a plugin this project doesn't install,
// and npm's would want to tag and commit. Twelve lines of node is less machinery
// than either.

import { readFileSync, writeFileSync } from 'node:fs';

const kind = process.argv[2];
if (kind !== 'major' && kind !== 'minor') {
  console.error('usage: node scripts/bump.mjs <major|minor>');
  process.exit(1);
}

const path = new URL('../package.json', import.meta.url);
const raw = readFileSync(path, 'utf8');
const pkg = JSON.parse(raw);

const [major, minor] = pkg.version.split('.').map(Number);
const next = kind === 'major' ? `${major + 1}.0.0` : `${major}.${minor + 1}.0`;

// Rewritten by hand rather than with JSON.stringify so the rest of the file —
// key order, indentation, the yarn hash — comes out byte for byte as it went in.
const patched = raw.replace(`"version": "${pkg.version}"`, `"version": "${next}"`);
if (patched === raw) {
  console.error(`Could not find "version": "${pkg.version}" in package.json`);
  process.exit(1);
}
writeFileSync(path, patched);

const declared = next.split('.').slice(0, 2).join('.');
console.log(`${pkg.version} -> ${next}`);
console.log(`The next build will call itself v${declared}.<commit count>.`);
console.log('Commit this alongside the change it describes.');
