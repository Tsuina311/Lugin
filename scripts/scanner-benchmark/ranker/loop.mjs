#!/usr/bin/env node
/**
 * Export the candidate dataset from the trusted corpus, then train challengers.
 * Does not promote a model and does not touch Android.
 *
 *   yarn scanner:ranker:loop
 */

import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const run = script => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [join(here, script)], { stdio: 'inherit' });
  child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`))));
});

await run('export-dataset.mjs');
await run('train.mjs');
