/** Discover real card warp PNGs for synthetic compositing. */

import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { INBOX_SESSIONS, REPLAY_ROOT, rootDir } from '../paths.mjs';

const IMAGE_RE = /\.(png|jpe?g)$/i;

export const discoverCardWarps = async ({ limit = 40 } = {}) => {
  const found = [];

  if (existsSync(REPLAY_ROOT)) {
    for (const name of await readdir(REPLAY_ROOT)) {
      const warp = join(REPLAY_ROOT, name, 'current-warp.png');
      if (existsSync(warp)) {
        found.push({
          id: `replay:${name}`,
          path: warp.replace(`${rootDir}/`, ''),
          abs: warp,
          source: 'replay',
          label: name,
        });
      }
    }
  }

  if (existsSync(INBOX_SESSIONS)) {
    for (const session of await readdir(INBOX_SESSIONS)) {
      const sessionPath = join(INBOX_SESSIONS, session);
      let entries;
      try {
        entries = await readdir(sessionPath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const dir = join(sessionPath, e.name);
        const warp = join(dir, 'current-warp.png');
        if (existsSync(warp)) {
          found.push({
            id: `inbox:${e.name}`,
            path: warp.replace(`${rootDir}/`, ''),
            abs: warp,
            source: 'inbox',
            label: e.name,
          });
        }
        // Focus-series card warps (prefer t000)
        const t0 = join(dir, 't000-card.png');
        if (existsSync(t0)) {
          found.push({
            id: `focus:${e.name}:t000`,
            path: t0.replace(`${rootDir}/`, ''),
            abs: t0,
            source: 'focus-series',
            label: e.name,
          });
        }
      }
    }
  }

  // Dedupe by abs path
  const seen = new Set();
  const unique = [];
  for (const c of found) {
    if (seen.has(c.abs)) continue;
    seen.add(c.abs);
    unique.push(c);
    if (unique.length >= limit) break;
  }
  return unique;
};

void basename;
void IMAGE_RE;
