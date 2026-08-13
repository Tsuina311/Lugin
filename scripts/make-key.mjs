// Give this extension a fixed identity of our own, so it can be handed round as a
// zip before the Chrome Web Store is involved at all.
//
// The problem it solves: Lugin's Google sign-in redirect is
// `https://<extension-id>.chromiumapp.org/`, Google matches it exactly, and an
// unpacked extension is assigned a *random* id every time it is loaded fresh. So
// one registered redirect URI cannot serve several testers — each of their
// installs would have a different id, and each would get redirect_uri_mismatch.
//
// Chrome derives the id from the manifest's `key` when one is present, and `key`
// is only a *public* key — nothing here is a credential Chrome checks for an
// unpacked load. The private key is kept anyway: it is what would let us sign a
// .crx later, and regenerating a lost one changes the id and breaks every install.
//
// Note this id is ours, not the store's. The store re-signs with its own key and
// assigns its own permanent id, so a published item has a *different* id — see
// docs/DISTRIBUTION.md for how the two coexist (register both redirect URIs, then
// converge on the store's key).

import { createHash, generateKeyPairSync, createPublicKey } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const KEY_FILE = join(ROOT, '.extension-key.pem');
const ENV_FILE = join(ROOT, '.env.local');
const VAR = 'LUGIN_EXTENSION_KEY';

const force = process.argv.includes('--force');

/**
 * The id is a base-16 hash rewritten in the first sixteen letters: Chrome takes
 * the SHA-256 of the DER public key, keeps the first 16 bytes, and maps each hex
 * digit 0–f onto a–p. (Extension ids predate any of this being documented; the
 * mapping exists so an id is always alphabetic.)
 */
const extensionId = (der) => {
  const digest = createHash('sha256').update(der).digest('hex').slice(0, 32);
  return [...digest].map(c => 'abcdefghijklmnop'[parseInt(c, 16)]).join('');
};

let privatePem;
if (existsSync(KEY_FILE) && !force) {
  privatePem = readFileSync(KEY_FILE, 'utf8');
  console.log(`reusing ${relative(ROOT, KEY_FILE)} (--force to replace it, changing the id)`);
} else {
  if (existsSync(KEY_FILE)) {
    console.warn('! replacing the existing key: the extension id changes, and every');
    console.warn('  install of the old one becomes a different extension.');
  }
  // RSA because that is what Chrome accepts here, 2048 because that is what it
  // signs its own items with.
  const pair = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  });
  privatePem = pair.privateKey;
  writeFileSync(KEY_FILE, privatePem);
  // Not a secret Chrome enforces, but it is still a private key on a shared disk.
  chmodSync(KEY_FILE, 0o600);
  console.log(`wrote ${relative(ROOT, KEY_FILE)} (gitignored — back it up somewhere)`);
}

// `key` in the manifest is exactly the base64 body of an SPKI PEM, which is also
// what the store's "View public key" shows, so both paths produce the same shape.
const der = createPublicKey(privatePem).export({ format: 'der', type: 'spki' });
const base64 = der.toString('base64');
const id = extensionId(der);

console.log(`\nextension id: ${id}`);
console.log(`redirect URI: https://${id}.chromiumapp.org/`);

// Only ever fills in a blank: a key that is already set is load-bearing for
// whoever installed the last build, and silently swapping it would strand them.
let wrote = false;
if (existsSync(ENV_FILE)) {
  const env = readFileSync(ENV_FILE, 'utf8');
  const line = new RegExp(`^${VAR}=(.*)$`, 'm');
  const current = env.match(line)?.[1]?.trim();
  if (current && current !== base64) {
    console.warn(`\n! .env.local already sets ${VAR} to something else — left alone.`);
    console.warn('  That build has a different id; reconcile them before shipping.');
  } else if (current !== base64) {
    writeFileSync(
      ENV_FILE,
      line.test(env) ? env.replace(line, `${VAR}=${base64}`) : `${env.replace(/\n*$/, '\n')}${VAR}=${base64}\n`,
    );
    wrote = true;
    console.log(`\nset ${VAR} in .env.local`);
  } else {
    console.log(`\n${VAR} in .env.local already matches`);
  }
}

if (!wrote && !existsSync(ENV_FILE)) {
  console.log(`\nno .env.local — copy .env.example to it, then add:\n\n${VAR}=${base64}`);
}

console.log('\nnext: yarn package:testers  → a zip whose id is the one above');
