#!/usr/bin/env node
/**
 * Add trusted phone identities, then train and score a challenger.
 * Does not deploy and does not change the geometry detector.
 */

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'run.mjs');
const child = spawn(process.execPath, [script, ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('exit', code => process.exit(code ?? 1));
