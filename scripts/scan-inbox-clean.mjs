#!/usr/bin/env node
import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const inbox = join(root, '.scan-inbox');

if (!existsSync(inbox)) {
  console.log('Nothing to clean (.scan-inbox missing).');
  process.exit(0);
}

await rm(inbox, { force: true, recursive: true });
console.log('Deleted .scan-inbox/');
