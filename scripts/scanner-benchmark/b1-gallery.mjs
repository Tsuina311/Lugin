#!/usr/bin/env node
/** yarn scanner:b1-gallery */

import { buildB1Gallery } from './embedding/b1-gallery.mjs';

const force = process.argv.includes('--force');
const meta = buildB1Gallery({
  force,
  log: msg => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`),
});
console.log(`${meta.id} refs ${meta.count} adapter ${meta.adapterSha256.slice(0, 12)} gallery ${meta.gallerySha256.slice(0, 12)}`);
