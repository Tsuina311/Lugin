#!/usr/bin/env node
/**
 * Bake mobile/build-stamp.json from the monorepo git stamp.
 *
 * EAS Build uploads omit `.git/` (.easignore), so app.config.ts cannot count
 * commits on the builder. Write the stamp locally / in CI before `eas build`
 * or `eas update` so the APK and Settings panel show the real version.
 */

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'mobile', 'build-stamp.json');

const raw = execSync(
  `node --experimental-strip-types -e "import { buildVersion } from './build/version.ts'; process.stdout.write(JSON.stringify(buildVersion('./')))"`,
  { cwd: root, encoding: 'utf8' },
);
const stamp = JSON.parse(raw);
writeFileSync(out, `${JSON.stringify(stamp, null, 2)}\n`);
console.log(`Wrote ${out} (${stamp.label})`);
